import * as aws from "@pulumi/aws";

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

export {lambdaRole}