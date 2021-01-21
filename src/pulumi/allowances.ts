import {Output} from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export function allowLambdaToReceiveDeleteGetSQSMessage(name: string,
                                                        description: string,
                                                        queueArn: Output<string>): aws.iam.Role {
    const awsConfig = new pulumi.Config("aws")
    const region = awsConfig.require("region")
    const accountId = awsConfig.require("accountId")
    const globals = new pulumi.Config("global")
    const globalPrefix = globals.require("prefix")
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
`,
    })

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
    const awsConfig = new pulumi.Config("aws")
    const region = awsConfig.require("region")
    const accountId = awsConfig.require("accountId")
    const globals = new pulumi.Config("global")
    const globalPrefix = globals.require("prefix")
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
`,
    })

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


export function allowBucketToSendSQSMessage(name: string,
                                            bucketArn: Output<string>): Output<string> {
    const awsConfig = new pulumi.Config("aws")
    const region = awsConfig.require("region")
    const accountId = awsConfig.require("accountId")

    // todo too much queues
    return pulumi.interpolate`{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:${region}:${accountId}:*",
      "Condition": {
        "ArnEquals": { "aws:SourceArn": "${bucketArn}" }
      }
    }
  ]
}
`
}


export function allowLambdaToPutObjectsInS3Bucket(name: string,
                                                  description: string,
                                                  bucketArn: Output<string>): aws.iam.Role {
    const awsConfig = new pulumi.Config("aws")
    const region = awsConfig.require("region")
    const accountId = awsConfig.require("accountId")
    const globals = new pulumi.Config("global")
    const globalPrefix = globals.require("prefix")
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
`,
    })

    // Create policy with logging allowance todo s3
    const policy = new aws.iam.Policy(`${name}-plcy`, {
        description: description,
        path: `/never-miss-a-webhook/${globalPrefix}/${stack}/`,
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
            "Resource": "arn:aws:logs:${region}:${accountId}:*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "s3:*"
            ],
            "Resource": "${bucketArn}/*"
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

export function allowLambdaReceiveDeleteGetSQSMsgGetObjInS3Bucket(name: string,
                                                                  description: string,
                                                                  deleteObjPerms: boolean,
                                                                  queueArn: Output<string>,
                                                                  bucketArn: Output<string>): aws.iam.Role {
    const awsConfig = new pulumi.Config("aws")
    const region = awsConfig.require("region")
    const accountId = awsConfig.require("accountId")
    const globals = new pulumi.Config("global")
    const globalPrefix = globals.require("prefix")
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
`,
    })

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
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            ],
            "Resource": "arn:aws:logs:${region}:${accountId}:*"
        },
        {
            "Effect": "Allow",
            "Action": [
                ${deleteObjPerms ? "\"s3:DeleteObject\"," : ""}
                "s3:GetObject"
            ],
            "Resource": "${bucketArn}/*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "sqs:ReceiveMessage",
                "sqs:DeleteMessage",
                "sqs:GetQueueAttributes"
            ],
            "Resource": "${queueArn}"
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