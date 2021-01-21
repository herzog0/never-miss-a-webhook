import {NeverMissAWebhook} from "./src";
import * as pulumi from "@pulumi/pulumi"

const STACK = pulumi.getStack()

export let ApiUrl: pulumi.Output<string> | undefined;
export let QueueUrl: pulumi.Output<string> | undefined;

if (STACK === "dev") {
    const nmaw = NeverMissAWebhook.builder()
        .withSQSConfigurationOverride({
            visibilityTimeoutSeconds: 180,
            receiveWaitTimeSeconds: 5,
        })
        .withDirectSqsIntegration()

    ApiUrl = nmaw.sqsApiUrl
    QueueUrl = nmaw.sqsQueueUrl

} else {

}




