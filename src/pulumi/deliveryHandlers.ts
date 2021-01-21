import * as pulumi from "@pulumi/pulumi";
import {allowLambdaReceiveDeleteGetSQSMsgGetObjInS3Bucket, allowLambdaToReceiveDeleteGetSQSMessage} from "./allowances";
import {createPulumiCallback} from "./callbacks";
import {QueueEvent} from "@pulumi/aws/sqs";
import * as aws from "@pulumi/aws"

export function createDeliveryHandlerForDirectIntegration(queue: aws.sqs.Queue) {
    const STACK = pulumi.getStack();
    const config = new pulumi.Config("global")
    const optConfigs = new pulumi.Config("opt")
    const prefix = config.require("prefix")
    const deliveryEndpoint = optConfigs.require("deliveryEndpoint")
    
    // Role for allowing the lambda function to call "ReceiveMessage" (internally by aws)
    // on the queue
    const lambdaReceiveMessageRole = allowLambdaToReceiveDeleteGetSQSMessage(
        `${prefix}-lam-rec-msg-allw-${STACK}`,
        "Allows a lambda function to receive messages from an SQS queue.",
        queue.arn
    )

    // Creating the full Callback function to be attached in the queue event system
    const sqsEventHandlerSimpleDeliveryAttempt = createPulumiCallback(
        `${prefix}-simple-dlvry-cb-${STACK}`,
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
            DELIVERY_ENDPOINT: deliveryEndpoint
        }
    )

    // Firing the above callback on queue events
    queue.onEvent(
        `${prefix}-queue-subscription-${STACK}`,
        sqsEventHandlerSimpleDeliveryAttempt
    )
}


/**
 * The integration that handles SQS messages for delivery attempts from
 * saved payloads.
 * */
export function createDeliveryHandlerForS3Intermediate(queue: aws.sqs.Queue, bucket: aws.s3.Bucket) {

    const STACK = pulumi.getStack();
    const config = new pulumi.Config("global")
    const optConfigs = new pulumi.Config("opt")
    const prefix = config.require("prefix")
    const deliveryEndpoint = optConfigs.require("deliveryEndpoint")
    const shouldDeletePayloadAfter = optConfigs.getBoolean("deletePayloadObj") || false

    const roleLambdaSQSS3Perms = allowLambdaReceiveDeleteGetSQSMsgGetObjInS3Bucket(
        `${prefix}-lam-rec-del-sqs-get-del-s3-${STACK}`,
        "Allows a lambda to perform operations on an SQS queue and on an S3 bucket",
        shouldDeletePayloadAfter,
        queue.arn,
        bucket.arn
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

    const sqsEventHandlerDeliveryFromSavedPayload = createPulumiCallback(
        `${prefix}-deliver-from-s3-${STACK}`,
        roleLambdaSQSS3Perms,
        lambdaGetAndPostPayload,
        {
            DELIVERY_ENDPOINT: deliveryEndpoint,
            DELETE_PAYLOAD_AFTER: String(shouldDeletePayloadAfter)
        }
    )

    queue.onEvent(
        `${prefix}-queue-subscription-${STACK}`,
        sqsEventHandlerDeliveryFromSavedPayload
    )
}