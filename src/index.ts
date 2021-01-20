import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";
import {Request, Response} from "@pulumi/awsx/apigateway/api";
import {QueueEvent} from "@pulumi/aws/sqs";
import {createPulumiCallback} from "./pulumi/callback";
import {
    allowBucketToSendSQSMessage,
    allowLambdaReceiveDeleteGetSQSMsgGetObjInS3Bucket,
    allowLambdaToPutObjectsInS3Bucket,
    allowLambdaToReceiveDeleteGetSQSMessage,
    allowLambdaToSendSQSMessage
} from "./pulumi/allowances";

const STACK = pulumi.getStack();

interface NeverMissAWebhookInterface {
    withDeliveryEndpoint(url: string): NeverMissAWebhook

    withGlobalPrefix(globalPrefix: string): NeverMissAWebhook

    withSQSConfigurationOverride(args: aws.sqs.QueueArgs): NeverMissAWebhook

    withDirectSqsIntegration(path: string): NeverMissAWebhook

    withPayloadContentSaverIntermediate(path: string): NeverMissAWebhook
}

// BucketNotification
export class NeverMissAWebhook {

    private config = new pulumi.Config("aws")
    private region: string = ""
    private accountId: string = ""
    private deletePayloadObj: boolean = false

    /**
     * The endpoint to post to
     * */
    private deliveryEndpoint: string = ""

    /**
     * The queue where requests will be posted to.
     * */
    private sqsDeliveryQueue: aws.sqs.Queue | null = null

    /**
     * The queue args that might be overwritten by the user
     * */
    private queueArgs: aws.sqs.QueueArgs = {
        visibilityTimeoutSeconds: 180
    }

    /**
     * The prefix that's going to be attached to every single service
     * */
    private globalPrefix: string = ""

    /**
     * The flag that indicates if the chosen method was direct integration
     * or the s3 payload saving method
     * */
    private directDelivery: boolean = true

    /**
     * If the chosen method is to directly post the message to SQS,
     * then the Api Gateway acts as a simple proxy, and we don't need
     * a lambda to manage the payload before the posting action.
     * */
    public sqsProxyApi: awsx.apigateway.API | null = null

    /**
     * The lambda function responsible for taking the request body incoming from api gateway
     * and posting it to the queue
     * */
    private sqsProxyApiLambdaPayloadRedirector: aws.lambda.EventHandler<Request, Response> | null = null

    /**
     * If the chosen method is to directly save the message to an S3
     * object and then share it's key to an SQS queue, then we need to provide
     * a simple Lambda function that fulfills our proxy needs.
     * */
    public s3ProxyApi: awsx.apigateway.API | null = null

    /**
     * The functions that takes the request body incoming from api gateway
     * and saves it as a json file in an S3 bucket
     * */
    private s3ProxyApiLambdaPayloadSaver: aws.lambda.EventHandler<Request, Response> | null = null

    /**
     * The bucket used for saving payloads
     * */
    private s3ProxyApiBucket: aws.s3.Bucket | null = null

    /**
     * The lambda that handles SQS messages for a simple delivery attempt.
     * */
    private sqsEventHandlerSimpleDeliveryAttempt: aws.sqs.QueueEventHandler | null = null

    /**
     * The lambda that handles SQS messages for delivery attempts from
     * saved payloads.
     * */
    private sqsEventHandlerDeliveryFromSavedPayload: aws.sqs.QueueEventHandler | null = null

    private constructor() {
    }

    public static builder() {
        const instance = new NeverMissAWebhook()
        instance.region = instance.config.require("region")
        instance.accountId = instance.config.require("accountId")
        instance.globalPrefix = instance.config.require("globalPrefix")
        instance.deliveryEndpoint = instance.config.require("deliveryEndpoint")
        instance.deletePayloadObj = instance.config.getBoolean("deletePayloadObj") || false

        return instance
    }

    public withSQSConfigurationOverride(args: aws.sqs.QueueArgs) {
        this.queueArgs = args
        return this;
    }

    public withDirectSqsIntegration(path: string) {
        this.directDelivery = true

        // The queue which takes the payloads
        this.sqsDeliveryQueue = new aws.sqs.Queue(`${this.globalPrefix}-queue-${STACK}`, this.queueArgs)

        // Role for allowing the lambda function to call "ReceiveMessage" (internally by aws)
        // on the queue
        const lambdaReceiveMessageRole = allowLambdaToReceiveDeleteGetSQSMessage(
            `${this.globalPrefix}-lam-rec-msg-allw-${STACK}`,
            "Allows a lambda function to receive messages from an SQS queue.",
            this.sqsDeliveryQueue.arn
        )

        // Creating the full Callback function to be attached in the queue event system
        this.sqsEventHandlerSimpleDeliveryAttempt = createPulumiCallback(
            `${this.globalPrefix}-simple-dlvry-cb-${STACK}`,
            lambdaReceiveMessageRole,
            async (event: QueueEvent) => {
                const axios = require("axios")
                const body = JSON.parse(event.Records[0].body)
                await axios.post(process.env.DELIVERY_ENDPOINT, body, {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                })
            },
            {
                DELIVERY_ENDPOINT: this.deliveryEndpoint
            }
        )

        // Firing the above callback on queue events
        this.sqsDeliveryQueue.onEvent(
            `${this.globalPrefix}-queue-subscription-${STACK}`,
            this.sqsEventHandlerSimpleDeliveryAttempt
        )

        // Unfortunately, we have to build the queue url ourselves
        // Fortunately, this is easy
        const sqsURL = this.sqsDeliveryQueue.name.apply(name => `https://sqs.${this.region}.amazonaws.com/${this.accountId}/${name}`)

        const lambdaSendSQSMessageRole = allowLambdaToSendSQSMessage(
            `${this.globalPrefix}-lam-send-msg-allw-${STACK}`,
            "Allows a lambda function to send messages to an SQS queue.",
            this.sqsDeliveryQueue.arn
        )

        // Creating the full callback function to be attached in the Api Gateway instance
        this.sqsProxyApiLambdaPayloadRedirector = createPulumiCallback(
            `${this.globalPrefix}-lam-pload-rdir-${STACK}`,
            lambdaSendSQSMessageRole,
            async (event: any) => {
                const AWS = require('aws-sdk')
                const sqs = new AWS.SQS()

                const payloadBuffer = Buffer.from(event.body, 'base64')
                const payload = payloadBuffer.toString('ascii')

                try {
                    await sqs.sendMessage({
                        MessageBody: payload,
                        QueueUrl: process.env.QUEUE_URL
                    }).promise()

                    return {
                        statusCode: 200,
                        body: "Success"
                    }
                } catch (e) {
                    console.error(e)
                    return {
                        statusCode: 500,
                        body: e.message
                    }
                }
            },
            {
                QUEUE_URL: sqsURL
            }
        )

        // Pulumi will be responsible for creating the allowance to invoke the lambda function
        this.sqsProxyApi = new awsx.apigateway.API(`${this.globalPrefix}-sqs-proxy-api-${STACK}`, {
            routes: [
                {
                    path: path,
                    method: "POST",
                    eventHandler: this.sqsProxyApiLambdaPayloadRedirector
                }
            ]
        })
        return this
    }

    public withPayloadContentSaverIntermediate(path: string) {
        this.directDelivery = false

        // The bucket, configured with private ACL. Only the owner can access it.
        this.s3ProxyApiBucket = new aws.s3.Bucket(`${this.globalPrefix}-payload-bucket-${STACK}`, {
            bucket: `${this.globalPrefix}-payload-bucket-${STACK}`
        });

        // The queue which takes the payloads
        const queueName = `${this.globalPrefix}-queue-${STACK}`
        this.sqsDeliveryQueue = new aws.sqs.Queue(queueName, {
            visibilityTimeoutSeconds: 180,
            policy: allowBucketToSendSQSMessage(queueName, this.s3ProxyApiBucket.arn)
        })

        const roleLambdaPutS3 = allowLambdaToPutObjectsInS3Bucket(
            `${this.globalPrefix}-lam-put-s3-allw-${STACK}`,
            "Allows a lambda function to put objects in an S3 bucket",
            this.s3ProxyApiBucket.arn
        )

        const payloadSaver = async (event: any) => {
            try {
                const AWS = require('aws-sdk')
                const s3 = new AWS.S3()
                const payloadBuffer = Buffer.from(event.body, 'base64')
                const payload = payloadBuffer.toString('ascii')
                const putParams = {
                    Bucket: process.env.S3_BUCKET, // We'll read the .env variable
                    Key: `${new Date().getTime()}.json`, // We'll use the timestamp
                    Body: payload
                }

                await new Promise((resolve, reject) => {
                    s3.putObject(putParams, function (err: any, data: any) {
                        if (err) {
                            reject(err)
                        } else {
                            resolve(data)
                        }
                    })
                })

                return {
                    statusCode: 200,
                    body: "Success"
                }
            } catch (e) {
                console.error(e)
                return {
                    statusCode: 500,
                    body: e.message
                }
            }


        }

        this.s3ProxyApiLambdaPayloadSaver = createPulumiCallback(
            `${this.globalPrefix}-pld-svr-cb-${STACK}`,
            roleLambdaPutS3,
            payloadSaver,
            {
                S3_BUCKET: this.s3ProxyApiBucket.id
            }
        )

        const roleLambdaSQSS3Perms = allowLambdaReceiveDeleteGetSQSMsgGetObjInS3Bucket(
            `${this.globalPrefix}-lam-rec-del-sqs-get-del-s3-${STACK}`,
            "Allows a lambda to perform operations on an SQS queue and on an S3 bucket",
            this.deletePayloadObj,
            this.sqsDeliveryQueue.arn,
            this.s3ProxyApiBucket.arn
            )

        const lambdaGetAndPostPayload = async (event: any) => {
            const axios = require("axios")
            const AWS = require('aws-sdk')
            const body = JSON.parse(event.Records[0].body)
            if (body.hasOwnProperty("Event") && body.Event === "s3:TestEvent") {
                console.log("Ignoring automatic test event from aws ...")
                return
            }

            const S3 = new AWS.S3()
            const bucketEvent = body.Records[0]
            const key = bucketEvent.s3.object.key
            const bucket = bucketEvent.s3.bucket.name

            const data = await S3.getObject({
                Bucket: bucket,
                Key: key,
            }).promise()

            const jsonStringData = data.Body.toString('utf-8')
            await axios.post(process.env.DELIVERY_ENDPOINT, JSON.parse(jsonStringData), {
                headers: {
                    'Content-Type': 'application/json'
                }
            })

            // If reached here, check if we have to delete the payload
            const shouldDelete = process.env.DELETE_PAYLOAD_AFTER === "true"
            if (shouldDelete) {
                await S3.deleteObject({
                    Bucket: bucket,
                    Key: key
                }).promise()
            }
        }

        this.sqsEventHandlerDeliveryFromSavedPayload = createPulumiCallback(
            `${this.globalPrefix}-deliver-from-s3-${STACK}`,
            roleLambdaSQSS3Perms,
            lambdaGetAndPostPayload,
            {
                DELIVERY_ENDPOINT: this.deliveryEndpoint,
                DELETE_PAYLOAD_AFTER: String(this.deletePayloadObj)
            }
        )

        this.sqsDeliveryQueue.onEvent(
            `${this.globalPrefix}-queue-subscription-${STACK}`,
            this.sqsEventHandlerDeliveryFromSavedPayload
        )

        // create API
        this.s3ProxyApi = new awsx.apigateway.API(`${this.globalPrefix}-s3-proxy-api-${STACK}`, {
            routes: [
                {
                    path: path,
                    method: "POST",
                    eventHandler: this.s3ProxyApiLambdaPayloadSaver
                }
            ]
        })

        new aws.s3.BucketNotification(`${this.globalPrefix}-bucket-notification-${STACK}`, {
            bucket: this.s3ProxyApiBucket.id,
            queues: [
                {
                    events: ["s3:ObjectCreated:*"],
                    queueArn: this.sqsDeliveryQueue.arn
                }
            ],
        })

        return this
    }

}
