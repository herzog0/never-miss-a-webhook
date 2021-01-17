import * as awsx from "@pulumi/awsx";
import {lambda} from "./pulumiLambdas";
import * as aws from "@pulumi/aws"
import {bucket} from "./buckets";

const apis3proxy = (bucket: aws.s3.Bucket): awsx.apigateway.IntegrationRoute => {
    return {
        path: "/post_to_s3",
        target: {
            type: "aws_proxy",
            uri: `arn:aws:apigateway:us-east-1:s3:action/PutObject&Bucket={${bucket.bucket}}&Key={${Date.now()}}`
        }
    }
}

// create API
let apiGateway = new awsx.apigateway.API(`payloads-api-meetup-api-gateway`, {
    routes: [
        // {
        //     path: "/post_to_s3",
        //     method: "POST",
        //     eventHandler: lambda
        // }
        apis3proxy(bucket)
    ]
})


export const apiUrl = apiGateway.url