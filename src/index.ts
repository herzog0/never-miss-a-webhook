import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";
import {Input, ResourceError} from "@pulumi/pulumi";
import {Request, Response} from "@pulumi/awsx/apigateway/api";
import {createPulumiCallback} from "./pulumi/callbacks";
import {
    allowBucketToSendSQSMessage,
    allowLambdaToPutObjectsInS3Bucket,
    allowLambdaToSendSQSMessage
} from "./pulumi/allowances";
import {
    createDeliveryHandlerForDirectIntegration,
    createDeliveryHandlerForS3Intermediate,
    createHandlerForDLQ
} from "./pulumi/deliveryHandlers";

const STACK = pulumi.getStack();

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
        visibilityTimeoutSeconds: 30
    }

    /**
     * The Dead Letter Queue of the main queue
     * */
    private sqsDLQ: aws.sqs.Queue | null = null

    /**
     * The maximum amount of times the main queue will receive a message
     * before forwarding it to the DLQ
     * */
    private maxReceiveCount: number | null = null

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

        return instance as Pick<NeverMissAWebhook, "withDeadLetterQueue"|"withoutDeadLetterQueue">
    }

    public withDeadLetterQueue(args: aws.sqs.QueueArgs, maxReceiveCount: number,
                               lambdaFunction?: (event: any) => void,
                               lambdaEnvVars: Input<{[key: string]: Input<string>}> = {}) {
        const isInt = parseInt(String(maxReceiveCount)) === parseFloat(String(maxReceiveCount))
        if (!isInt) {
            throw new ResourceError(`maxReceiveCount is: ${maxReceiveCount} but it should be an integer number`, undefined)
        }

        this.maxReceiveCount = maxReceiveCount

        this.sqsDLQ = new aws.sqs.Queue(`${this.globalPrefix}-dlq-${STACK}`, args)
        if (lambdaFunction) {
            createHandlerForDLQ(this.sqsDLQ, lambdaFunction, lambdaEnvVars)
        }
        return this as Pick<NeverMissAWebhook, "withMainQueueConfigurationOverride"|"withoutSQSConfigurationOverride">
    }

    public withoutDeadLetterQueue() {
        return this as Pick<NeverMissAWebhook, "withMainQueueConfigurationOverride"|"withoutSQSConfigurationOverride">
    }

    public withoutSQSConfigurationOverride() {
        return this as Pick<NeverMissAWebhook, "withDirectSqsIntegration"|"withPayloadContentSaverIntermediate">
    }

    public withMainQueueConfigurationOverride(args: aws.sqs.QueueArgs) {
        this.queueArgs = args
        return this as Pick<NeverMissAWebhook, "withDirectSqsIntegration"|"withPayloadContentSaverIntermediate">
    }

    public withDirectSqsIntegration() {
        // The queue which takes the payloads
        let queueName = `${this.globalPrefix}-queue-${STACK}`
        if (this.queueArgs.fifoQueue) {
            queueName += ".fifo"
        }

        if (this.sqsDLQ) {
            const redrivePolicy = this.sqsDLQ.arn.apply(arn => {
                return JSON.stringify({
                    deadLetterTargetArn: arn,
                    maxReceiveCount: this.maxReceiveCount
                })
            })
            this.queueArgs = {
                name: queueName,
                redrivePolicy: redrivePolicy,
                ...this.queueArgs
            }
        } else {
            this.queueArgs = {
                name: queueName,
                ...this.queueArgs
            }
        }

        this.sqsDeliveryQueue = new aws.sqs.Queue(queueName, this.queueArgs)

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
                const uuid = require("uuid")
                const sqs = new AWS.SQS()

                const payloadBuffer = Buffer.from(event.body, 'base64')
                const payload = payloadBuffer.toString('ascii')

                const isFifo = String(process.env.QUEUE_URL).endsWith(".fifo")
                const isContentBasedDeduplication = process.env.CONTENT_BASED_DEDUPLICATION === "true"
                const messageGroupId =  isFifo ? "nmaw" : undefined
                const messageDeduplicationId = isFifo
                    ? isContentBasedDeduplication
                        ? undefined
                        : uuid.v4()
                    : undefined

                try {
                    await sqs.sendMessage({
                        MessageGroupId: messageGroupId,
                        MessageDeduplicationId: messageDeduplicationId,
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
                QUEUE_URL: sqsURL,
                CONTENT_BASED_DEDUPLICATION: String(this.queueArgs.contentBasedDeduplication)
            }
        )

        // Pulumi will be responsible for creating the allowance to invoke the lambda function
        this.sqsProxyApi = new awsx.apigateway.API(`${this.globalPrefix}-sqs-proxy-api-${STACK}`, {
            routes: [
                {
                    path: "/",
                    method: "POST",
                    eventHandler: this.sqsProxyApiLambdaPayloadRedirector,
                }
            ]
        })

        if (this.deliverQueuedPayload) {
            createDeliveryHandlerForDirectIntegration(this.sqsDeliveryQueue)
        }

        return this as Pick<NeverMissAWebhook, "sqsApiUrl"|"sqsQueueUrl">

    }

    // public withOptional

    public withPayloadContentSaverIntermediate() {

        if (this.queueArgs.fifoQueue) {
            throw new pulumi.ResourceError("FIFO SQS queues are not supported for Bucket notifications!", undefined)
        }

        // The bucket, configured with private ACL. Only the owner can access it.
        this.s3ProxyApiBucket = new aws.s3.Bucket(`${this.globalPrefix}-payload-bucket-${STACK}`, {
            bucket: `${this.globalPrefix}-payload-bucket-${STACK}`
        });

        // The queue which takes the payloads
        const queueName = `${this.globalPrefix}-queue-${STACK}`

        if (this.sqsDLQ) {
            const redrivePolicy = this.sqsDLQ.arn.apply(arn => {
                return JSON.stringify({
                    deadLetterTargetArn: arn,
                    maxReceiveCount: this.maxReceiveCount
                })
            })
            this.queueArgs = {
                redrivePolicy: redrivePolicy,
                ...this.queueArgs
            }
        }

        this.sqsDeliveryQueue = new aws.sqs.Queue(queueName, {
            name: queueName,
            policy: allowBucketToSendSQSMessage(queueName, this.s3ProxyApiBucket.arn),
            ...this.queueArgs,
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

                await s3.putObject(putParams).promise()

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
                    path: "/",
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

        return this as Pick<NeverMissAWebhook, "s3ApiUrl"|"sqsQueueUrl">
    }

}
