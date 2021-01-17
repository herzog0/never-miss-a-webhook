import {STACK} from "./pulumiStack";
import * as aws from "@pulumi/aws"

// Create an AWS resource (S3 Bucket)
const bucket = new aws.s3.Bucket("payloads-bucket", {
    bucket: `nmaw-test-${STACK}`
});

export {bucket}