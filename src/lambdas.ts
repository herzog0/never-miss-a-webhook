import {saveInBucketAsJson} from "./aws";

const payloadSaver = async (event: any) => {
    const payloadBuffer = Buffer.from(event.body, 'base64')
    const payload = payloadBuffer.toString('ascii')
    await saveInBucketAsJson(payload)

    return {
        statusCode: 200,
        body: "Success"
    }
}

const deliveryFromSavedPayload = async (event: any) => {

}




export {payloadSaver}