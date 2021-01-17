// Attach the policies to the Lambda role
import {lambdaRole} from "./roles";
import * as aws from "@pulumi/aws";
import {lambdaS3Policy} from "./policies";

new aws.iam.RolePolicyAttachment(`post-to-s3-policy-attachment`, {
    policyArn: lambdaS3Policy.arn,
    role: lambdaRole.name
})