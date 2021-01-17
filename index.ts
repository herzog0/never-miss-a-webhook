// Export the name of the bucket
import {bucket} from "./src/buckets";
import {apiGateway} from "./src/apiGateway";

// TODO USE PICK AND OMIT

export const payloadsBucket = bucket.id
export const apiUrl = apiGateway.url