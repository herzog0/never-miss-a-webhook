import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";


interface NeverMissAWebhookInterface {
    deliveryEndpoint: string

    api: aws.apigatewayv2.Api
    apiIntegration: aws.apigateway.Integration

    postToSQS(message: string): string

}

// BucketNotification
export class NeverMissAWebhook {

    /**
     * If the chosen method is to directly post the message to SQS,
     * then the Api Gateway acts as a simple proxy, and we don't need
     * a lambda to manage the payload before the posting action.
     * */
    private sqsProxyApi: aws.apigatewayv2.Api | null = null
    private sqsProxyApiIntegration: aws.apigatewayv2.Integration | null = null

    /**
     * If the chosen method is to directly save the message to an S3
     * object or to check the payload size before deciding
     * */
    private genericApi: awsx.apigateway.API | null = null

    private lambdaSavePayloadInS3AndSQSPost

}