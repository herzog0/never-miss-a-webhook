import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";
import {Request, Response} from "@pulumi/awsx/apigateway/api";
import {QueueEvent} from "@pulumi/aws/sqs";

const STACK = pulumi.getStack();

const lambdaRole = new aws.iam.Role(`role-payloads-api`, {
    assumeRolePolicy: `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Action": "sts:AssumeRole",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Effect": "Allow"
    }
  ]
}
`,
})

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

    private constructor() {}

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

        new aws.iam.RolePolicyAttachment(`post-to-s3-policy-attachment-new-unique`, {
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

    public withPayloadContentSaverIntermediate(path: string) {
        this.directDelivery = false

        this.s3ProxyApiBucket = new aws.s3.Bucket("payloads-bucket", {
            bucket: `kudlkjsdlkasldk`
        });

        this.sqsDeliveryQueue = new aws.sqs.Queue(`${this.globalPrefix}-queue-${STACK}`, {
            visibilityTimeoutSeconds: 180,
            policy: pulumi.interpolate`{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:*:*:*",
      "Condition": {
        "ArnEquals": { "aws:SourceArn": "${this.s3ProxyApiBucket.arn}" }
      }
    }
  ]
}
`
        })

        // Policy for allowing Lambda to interact with S3
        const lambdaS3Policy = new aws.iam.Policy(`post-to-s3-policy`, {
            description: "IAM policy for Lambda to interact with S3",
            path: "/",
            policy: this.s3ProxyApiBucket.arn.apply(bucketArn => `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Action": "s3:PutObject",
      "Resource": "${bucketArn}/*",
      "Effect": "Allow"
    }
  ]}`)
        })

        // Attach the policies to the Lambda role
        new aws.iam.RolePolicyAttachment(`post-to-s3-policy-attachment-newnenw`, {
            policyArn: lambdaS3Policy.arn,
            role: lambdaRole.name
        })

        const payloadSaver = async (event: any) => {
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
        }

        this.s3ProxyApiLambdaPayloadSaver = new aws.lambda.CallbackFunction(`payloads-api-meetup-lambda`, {
            name: `payloads-api-meetup-lambda-${STACK}`,
            runtime: "nodejs12.x",
            role: lambdaRole,
            callback: payloadSaver,
            environment: {
                variables: {
                    S3_BUCKET: this.s3ProxyApiBucket.id
                }
            },
        })


        const lambdaS3ReadPolicy = new aws.iam.Policy("s3-read-message-policy", {
            description: "IAM policy for lambda to interact with S3",
            path: "/",
            policy: pulumi.interpolate`{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            ],
            "Resource": "arn:aws:logs:*:*:*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "s3:*"
            ],
            "Resource": "${this.s3ProxyApiBucket.arn}/*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "sqs:*"
            ],
            "Resource": "arn:aws:sqs:us-east-1:*:*"
        }
    ]
}`
        })

        new aws.iam.RolePolicyAttachment(`post-to-s3-policy-attachment-uaysdkj`, {
            policyArn: lambdaS3ReadPolicy.arn,
            role: lambdaRole.name
        })

        this.sqsEventHandlerDeliveryFromSavedPayload = new aws.lambda.CallbackFunction(`${this.globalPrefix}-simple-delivery-callback-${STACK}`, {
            name: `${this.globalPrefix}-simple-delivery-lambda-${STACK}`,
            runtime: "nodejs12.x",
            role: lambdaRole,
            callback: async (event: any) => {
                const axios = require("axios")
                const AWS = require('aws-sdk')
                const S3 = new AWS.S3()
                const body = JSON.parse(event.Records[0].body)

                console.log(JSON.stringify(body, null, '  '))

                const bucketEvent = body.Records[0]

                const key = bucketEvent.s3.object.key
                const bucket = bucketEvent.s3.bucket.name

                console.log("REACHED HERE")

                const data = await S3.getObject({
                        Bucket: bucket,
                        Key: key,
                    }).promise()

                console.log("OBTAINED DATA")

                const jsonStringData = data.Body.toString('utf-8')

                console.log(jsonStringData)

                await axios.post(process.env.DELIVERY_ENDPOINT, JSON.parse(jsonStringData), {
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

        this.sqsDeliveryQueue.onEvent(`delivery-queue-eventtt`, this.sqsEventHandlerDeliveryFromSavedPayload)

        // create API
        this.s3ProxyApi = new awsx.apigateway.API(`payloads-api-meetup-api-gateway`, {
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

const bla = NeverMissAWebhook.builder()
    .withDeliveryEndpoint("https://webhook.site/1544609f-de1d-4540-8631-06a1f10bcd83")
    .withGlobalPrefix("NEW-TESTSasdsa")
    .withPayloadContentSaverIntermediate("poster")

export const apiURL = bla.s3ProxyApi?.url


/* BODY
* {
  "Records": [
    {
      "eventVersion": "2.1",
      "eventSource": "aws:s3",
      "awsRegion": "us-east-1",
      "eventTime": "2021-01-19T04:10:59.831Z",
      "eventName": "ObjectCreated:Put",
      "userIdentity": {
        "principalId": "AWS:AROAZ7257FWIWIBSFK2F3:payloads-api-meetup-lambda-dev"
      },
      "requestParameters": {
        "sourceIPAddress": "3.85.245.122"
      },
      "responseElements": {
        "x-amz-request-id": "07BEE13A50C5122C",
        "x-amz-id-2": "rxAB5Bb85Tga4llWZV2pnE5+qZs2c+m9Q9VQFC1cljrYItorFa8IaYeBUoymYzgQRxpImqOKSxUqVC1RjYGiFozXXh6sE2EV"
      },
      "s3": {
        "s3SchemaVersion": "1.0",
        "configurationId": "tf-s3-queue-20210119040950244600000001",
        "bucket": {
          "name": "kudlkjsdlkasldk",
          "ownerIdentity": {
            "principalId": "A2L6U30J7N5YHJ"
          },
          "arn": "arn:aws:s3:::kudlkjsdlkasldk"
        },
        "object": {
          "key": "1611029463907.json",
          "size": 24,
          "eTag": "83b9b93d346960c66aec567cd60faa57",
          "sequencer": "0060065BD88D817FAE"
        }
      }
    }
  ]
}
* */
