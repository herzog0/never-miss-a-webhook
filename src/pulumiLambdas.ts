import {bucket} from "./buckets";
import {lambdaRole} from "./roles";
import {STACK} from "./pulumiStack";
import * as aws from "@pulumi/aws";
import {payloadSaver} from "./lambdas";

const lambda = new aws.lambda.CallbackFunction(`payload-saver-lambda`, {
    name: `payload-saver-lambda-${STACK}`,
    runtime: "nodejs12.x",
    role: lambdaRole,
    callback: payloadSaver,
    environment: {
        variables: {
            S3_BUCKET: bucket.id
        }
    },
})

export {lambda}