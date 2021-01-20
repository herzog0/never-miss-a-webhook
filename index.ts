import {NeverMissAWebhook} from "./src";

const nmaw = NeverMissAWebhook.builder().withDirectSqsIntegration("/posting")

export const apiUrl = nmaw.sqsProxyApi?.url