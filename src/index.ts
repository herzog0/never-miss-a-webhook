import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";
import {Request, Response} from "@pulumi/awsx/apigateway/api";
import {QueueEvent} from "@pulumi/aws/sqs";
import {createPulumiCallback} from "./pulumi/callbacks";
import {
    allowBucketToSendSQSMessage,
    allowLambdaReceiveDeleteGetSQSMsgGetObjInS3Bucket,
    allowLambdaToPutObjectsInS3Bucket,
    allowLambdaToReceiveDeleteGetSQSMessage,
    allowLambdaToSendSQSMessage
} from "./pulumi/allowances";
import {
    createDeliveryHandlerForDirectIntegration,
    createDeliveryHandlerForS3Intermediate
} from "./pulumi/deliveryHandlers";

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

    private region: string = ""
    private accountId: string = ""

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
     * The flag stating that a queued payload should be delivered to the the specified "deliveryEndpoint"
     * */
    private deliverQueuedPayload: boolean = false

    /**
     * If the chosen method is to directly post the message to SQS,
     * then the Api Gateway acts as a simple proxy, and we don't need
     * a lambda to manage the payload before the posting action.
     * */
    private sqsProxyApi: awsx.apigateway.API | null = null

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
    private s3ProxyApi: awsx.apigateway.API | null = null

    /**
     * The functions that takes the request body incoming from api gateway
     * and saves it as a json file in an S3 bucket
     * */
    private s3ProxyApiLambdaPayloadSaver: aws.lambda.EventHandler<Request, Response> | null = null

    /**
     * The bucket used for saving payloads
     * */
    private s3ProxyApiBucket: aws.s3.Bucket | null = null


    private sqsEventHandlerDeliveryFromSavedPayload: aws.sqs.QueueEventHandler | null = null

    public get s3ApiUrl() {
        return this.s3ProxyApi?.url
    }

    public get sqsApiUrl() {
        return this.sqsProxyApi?.url
    }

    public get sqsQueueUrl() {
        return this.sqsDeliveryQueue?.name.apply(name => `https://sqs.${this.region}.amazonaws.com/${this.accountId}/${name}`)
    }

    private constructor() {
    }

    public static builder() {
        const instance = new NeverMissAWebhook()
        const awsConfig = new pulumi.Config("aws")
        const globals = new pulumi.Config("global")
        const optConfig = new pulumi.Config("opt")

        instance.region = awsConfig.require("region")
        instance.accountId = awsConfig.require("accountId")

        instance.globalPrefix = globals.require("prefix")

        if (optConfig.getBoolean("deliverQueuedPayload")) {
            if (!optConfig.require("deliveryEndpoint")) {
                throw new pulumi.ResourceError("If 'deliverQueuedPayload' is active, then " +
                    "'deliveryEndpoint' must be set to a valid Url.", undefined)
            }
            instance.deliverQueuedPayload = true
        }

        return instance
    }

    public withSQSConfigurationOverride(args: aws.sqs.QueueArgs) {
        this.queueArgs = args
        return this;
    }

    public withDirectSqsIntegration() {
        // The queue which takes the payloads
        this.sqsDeliveryQueue = new aws.sqs.Queue(`${this.globalPrefix}-queue-${STACK}`, this.queueArgs)

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
                    path: "/nmaw",
                    method: "POST",
                    eventHandler: this.sqsProxyApiLambdaPayloadRedirector
                }
            ]
        })

        if (this.deliverQueuedPayload) {
            createDeliveryHandlerForDirectIntegration(this.sqsDeliveryQueue)
        }

        return this
    }

    public withPayloadContentSaverIntermediate() {
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

        // create API
        this.s3ProxyApi = new awsx.apigateway.API(`${this.globalPrefix}-s3-proxy-api-${STACK}`, {
            routes: [
                {
                    path: "/nmaw",
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

        if (this.deliverQueuedPayload) {
            createDeliveryHandlerForS3Intermediate(this.sqsDeliveryQueue, this.s3ProxyApiBucket)
        }

        return this
    }

}
