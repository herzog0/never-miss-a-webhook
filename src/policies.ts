// Policy for allowing Lambda to interact with S3
import {bucket} from "./buckets";
const aws = require("@pulumi/aws");

const api2 = aws.apigatewayv2.Integration

const lambdaS3Policy = new aws.iam.Policy(`post-to-s3-policy`, {
    description: "IAM policy for Lambda to interact with S3",
    path: "/",
    policy: bucket.arn.apply((bucketArn: any) => `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Action": "s3:PutObject",
      "Resource": "${bucketArn}/*",
      "Effect": "Allow"
    }
  ]}`)
})

export {lambdaS3Policy}