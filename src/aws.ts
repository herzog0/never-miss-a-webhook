export const saveInBucketAsJson = async (payload: string) => {
    const AWS = require('aws-sdk')
    const s3 = new AWS.S3()
    // decode the body of the event

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
}