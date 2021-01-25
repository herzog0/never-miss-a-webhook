import {NeverMissAWebhook} from "./src";
import * as pulumi from "@pulumi/pulumi"

const STACK = pulumi.getStack()

export let ApiUrl: pulumi.Output<string> | undefined;
export let QueueUrl: pulumi.Output<string> | undefined;

/*
*
* redrive_policy = {
    'deadLetterTargetArn': dead_letter_queue_arn,
    'maxReceiveCount': '10'
}


# Configure queue to send messages to dead letter queue
sqs.set_queue_attributes(
    QueueUrl=queue_url,
    Attributes={
        'RedrivePolicy': json.dumps(redrive_policy)
    }
)
* */

if (STACK === "dev") {
    const nmaw = NeverMissAWebhook.builder()
        .withDeadLetterQueue({
                visibilityTimeoutSeconds: 180
            },
            1,
            (event: any) => {
                console.log(process.env.DLQ_ENV_VAR)
            },
            {
                DLQ_ENV_VAR: "INSIDE DLQ"
            })
        .withMainQueueConfigurationOverride({
            visibilityTimeoutSeconds: 30
        })
        .withPayloadContentSaverIntermediate()

    ApiUrl = nmaw.s3ApiUrl
    QueueUrl = nmaw.sqsQueueUrl

} else {

}




