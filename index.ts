const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const awsx = require("@pulumi/awsx");

const STACK = pulumi.getStack();

// Create an AWS resource (S3 Bucket)
const bucket = new aws.s3.Bucket("payloads-bucket", {
    bucket: `nmaw-${STACK}`
});


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

// Policy for allowing Lambda to interact with S3
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

// Attach the policies to the Lambda role
new aws.iam.RolePolicyAttachment(`post-to-s3-policy-attachment`, {
    policyArn: lambdaS3Policy.arn,
    role: lambdaRole.name
})


const lambdaFunction = async (event: any) => {
    const AWS = require('aws-sdk')
    const s3 = new AWS.S3()
    // decode the body of the event
    const payloadBuffer = new Buffer(event.body, 'base64')
    const payload = payloadBuffer.toString('ascii')
    const putParams = {
        Bucket: process.env.S3_BUCKET, // We'll read the .env variable
        Key: `${new Date().getTime()}.json`, // We'll use the timestamp
        Body: payload
    }

    await new Promise((resolve, reject) => {
        s3.putObject(putParams, function (err: any, data: any) {
            if (err) {
                reject(err)
            } else {
                resolve(data)
            }
        })
    })
    return {
        statusCode: 200,
        body: "Success"
    }
}
const lambda = new aws.lambda.CallbackFunction(`payloads-api-meetup-lambda`, {
    name: `payloads-api-meetup-lambda-${STACK}`,
    runtime: "nodejs12.x",
    role: lambdaRole,
    callback: lambdaFunction,
    environment: {
        variables: {
            S3_BUCKET: bucket.id
        }
    },
})

// create API
let apiGateway = new awsx.apigateway.API(`payloads-api-meetup-api-gateway`, {
    routes: [
        {
            path: "/post_to_s3",
            method: "POST",
            eventHandler: lambda
        }
    ]
})


// Export the name of the bucket
exports.bucketName = bucket.id
exports.apiGateway = apiGateway.url