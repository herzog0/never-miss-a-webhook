import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";
import {STACK} from "./pulumiStack";
import {Request, Response} from "@pulumi/awsx/apigateway/api";
import {lambda} from "./pulumiLambdas";
import {lambdaRole} from "./roles";
import {payloadSaver} from "./lambdas";
import {bucket} from "./buckets";
import {lambdaS3Policy} from "./policies";
import {QueueEvent} from "@pulumi/aws/sqs";

const globals = {
    apiURL: "",
}

interface NeverMissAWebhookInterface {
    withDeliveryEndpoint(url: string): NeverMissAWebhook

    withGlobalPrefix(globalPrefix: string): NeverMissAWebhook

    withSQSConfigurationOverride(args: aws.sqs.QueueArgs): NeverMissAWebhook

    withDirectSqsIntegration(path: string): NeverMissAWebhook

    withPayloadContentSaverIntermediate(): NeverMissAWebhook
}

// BucketNotification
export class NeverMissAWebhook implements NeverMissAWebhookInterface {

    private config = new pulumi.Config("aws")
    private region: string = ""
    private accountId: string = ""

    /**
     * The endpoint to post to
     * */
    private deliveryEndpoint: string | null = null

    /**
     * The queue where requests will be posted to.
     * */
    private sqsDeliveryQueue: aws.sqs.Queue | null = null

    /**
     * The queue args that might be overwritten by the user
     * */
    private queueArgs: aws.sqs.QueueArgs = {
        // TODO define best attributes
    }

    /**
     * The prefix that's going to be attached to every single service
     * */
    private globalPrefix: string | null = null

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

        return instance
    }

    public withDeliveryEndpoint(url: string) {
        this.deliveryEndpoint = url
        return this
    }

    public withGlobalPrefix(globalPrefix: string) {
        this.globalPrefix = globalPrefix
        return this
    }

    public withSQSConfigurationOverride(args: aws.sqs.QueueArgs) {
        this.queueArgs = args
        return this;
    }

    public withDirectSqsIntegration(path: string) {
        this.directDelivery = true

        this.sqsDeliveryQueue = new aws.sqs.Queue(`${this.globalPrefix}-queue-${STACK}`, {
            visibilityTimeoutSeconds: 180
        })

        const lambdaSQSPolicy = new aws.iam.Policy("sqs-send-message-policy", {
            description: "IAM policy for lambda to interact with SQS",
            path: "/",
            policy: `{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "sqs:*",
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            ],
            "Resource": [
            "arn:aws:sqs:us-east-1:*:*",
            "arn:aws:logs:*:*:*"
            ]
        }
    ]
}`
        })

        new aws.iam.RolePolicyAttachment(`post-to-s3-policy-attachment`, {
            policyArn: lambdaSQSPolicy.arn,
            role: lambdaRole.name
        })

        this.sqsEventHandlerSimpleDeliveryAttempt = new aws.lambda.CallbackFunction(`${this.globalPrefix}-simple-delivery-callback-${STACK}`, {
            name: `${this.globalPrefix}-simple-delivery-lambda-${STACK}`,
            runtime: "nodejs12.x",
            role: lambdaRole,
            callback: async (event: QueueEvent) => {
                const axios = require("axios")
                const body = JSON.parse(event.Records[0].body)
                await axios.post(process.env.DELIVERY_ENDPOINT, body, {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                })
            },
            environment: {
                variables: {
                    DELIVERY_ENDPOINT: this.deliveryEndpoint!
                }
            }
        })

        this.sqsDeliveryQueue.onEvent(`${this.globalPrefix}-queue-subscription-${STACK}`, this.sqsEventHandlerSimpleDeliveryAttempt)

        const sqsURL = this.sqsDeliveryQueue.name.apply(name => `https://sqs.${this.region}.amazonaws.com/${this.accountId}/${name}`)

        this.sqsProxyApiLambdaPayloadRedirector = new aws.lambda.CallbackFunction(`${this.globalPrefix}-lambda-payload-redirector-${STACK}`, {
            name: `${this.globalPrefix}-lambda-payload-redirector-${STACK}`,
            runtime: "nodejs12.x",
            role: lambdaRole,
            callback: async (event: any) => {
                const AWS = require('aws-sdk')
                const sqs = new AWS.SQS()

                const payloadBuffer = Buffer.from(event.body!, 'base64')
                const payload = payloadBuffer.toString('ascii')
                console.log(payload)

                await new Promise((resolve, reject) => {
                    sqs.sendMessage({
                        MessageBody: payload,
                        QueueUrl: process.env.QUEUE_URL
                    }, function (err: any, data: any) {
                        if (err) {
                            reject(err)
                        } else {
                            resolve(data)
                        }
                    })
                })
                return {
                    statusCode: 200,
                    body: "delivered"
                }
            },
            environment: {
                variables: {
                    QUEUE_URL: sqsURL
                }
            },
        })

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

    public withPayloadContentSaverIntermediate() {
        this.directDelivery = false
        return this
    }

    private builQueue() {

    }

    private createBucketNotificationToSQS() {
        new aws.s3.BucketNotification(`${this.globalPrefix}-bucket-notification-${STACK}`, {
            bucket: this.s3ProxyApiBucket!.bucket,
            queues: [
                {
                    events: ["s3:ObjectCreated:*"],
                    queueArn: this.sqsDeliveryQueue!.arn
                }
            ]
        })
    }
}

const bla = NeverMissAWebhook.builder()
    .withDeliveryEndpoint("https://webhook.site/1544609f-de1d-4540-8631-06a1f10bcd83")
    .withGlobalPrefix("NEW-TESTS")
    .withDirectSqsIntegration("poster")

export const apiURL = bla.sqsProxyApi?.url

