import {NeverMissAWebhook} from "./src";
import * as pulumi from "@pulumi/pulumi"

const STACK = pulumi.getStack()

export let s3ApiUrl: pulumi.Output<string> | undefined;
export let sqsApiUrl: pulumi.Output<string> | undefined;

if (STACK === "dev") {
    const nmaw = NeverMissAWebhook.builder()
        .withDirectSqsIntegration()
    s3ApiUrl = nmaw.s3ProxyApi?.url
    sqsApiUrl = nmaw.sqsProxyApi?.url
} else {
    const nmaw = NeverMissAWebhook.builder()
        .withPayloadContentSaverIntermediate()
    s3ApiUrl = nmaw.s3ProxyApi?.url
    sqsApiUrl = nmaw.sqsProxyApi?.url
}




