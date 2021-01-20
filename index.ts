import {NeverMissAWebhook} from "./src";

const nmaw = NeverMissAWebhook.builder().withPayloadContentSaverIntermediate("/posting")

export const apiUrl = nmaw.s3ProxyApi?.url