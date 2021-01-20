import {Output} from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export function allowLambdaToReceiveDeleteGetSQSMessage(name: string,
                                                        description: string,
                                                        queueArn: Output<string>): aws.iam.Role {
    const config = new pulumi.Config("aws")
    const region = config.require("region")
    const accountId = config.require("accountId")
    const globalPrefix = config.require("globalPrefix")
    const stack = pulumi.getStack()

    // Create role
    const role = new aws.iam.Role(`${name}-role`, {
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
`,})

    // Create policy with logging allowance
    const policy = new aws.iam.Policy(`${name}-plcy`, {
        description: description,
        path: `/never-miss-a-webhook/${globalPrefix}/${stack}/`,
        policy: pulumi.interpolate`{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "sqs:ReceiveMessage",
                "sqs:DeleteMessage",
                "sqs:GetQueueAttributes",
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            ],
            "Resource": [
            "${queueArn}",
            "arn:aws:logs:${region}:${accountId}:*"
            ]
        }
    ]
}`
    })

    // Attach them!
    new aws.iam.RolePolicyAttachment(`${name}-role-plcy-attach`, {
        policyArn: policy.arn,
        role: role.name
    })

    return role
}


export function allowLambdaToSendSQSMessage(name: string,
                                            description: string,
                                            queueArn: Output<string>): aws.iam.Role {
    const config = new pulumi.Config("aws")
    const region = config.require("region")
    const accountId = config.require("accountId")
    const globalPrefix = config.require("globalPrefix")
    const stack = pulumi.getStack()

    // Create role
    const role = new aws.iam.Role(`${name}-role`, {
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
`,})

    // Create policy with logging allowance
    const policy = new aws.iam.Policy(`${name}-plcy`, {
        description: description,
        path: `/never-miss-a-webhook/${globalPrefix}/${stack}/`,
        policy: pulumi.interpolate`{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "sqs:SendMessage",
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            ],
            "Resource": [
            "${queueArn}",
            "arn:aws:logs:${region}:${accountId}:*"
            ]
        }
    ]
}`
    })

    // Attach them!
    new aws.iam.RolePolicyAttachment(`${name}-role-plcy-attach`, {
        policyArn: policy.arn,
        role: role.name
    })

    return role

}