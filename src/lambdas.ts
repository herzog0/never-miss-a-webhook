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

const payloadSaverWithSizeCheck = async (event: any) => {
    // Got from here => https://github.com/miktam/sizeof !!

    const STRING_ECMA_BYTE_SIZE = 2
    const BYTE_TO_KB_256 = 255 * 1024 // 255, just to be sure it won't overflow..

    // decode the body of the event
    const payloadBuffer = Buffer.from(event.body, 'base64')
    const payload = payloadBuffer.toString('ascii')

    if (payload.length * STRING_ECMA_BYTE_SIZE < BYTE_TO_KB_256) {
        // Allowed to get posted
    } else {
        // Must save to S3 and share it's key
        await saveInBucketAsJson(payload)
    }


}

const deliveryFromSavedPayload = async (event: any) => {

}




export {payloadSaver}