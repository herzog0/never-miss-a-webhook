import * as aws from "@pulumi/aws";
import {Callback} from "@pulumi/aws/lambda";
import {Input} from "@pulumi/pulumi";

export function createPulumiCallback(name: string,
                                     role: aws.iam.Role,
                                     fn: Callback<any, any>,
                                     env: Input<{[key: string]: Input<string>}> = {}) {
    return new aws.lambda.CallbackFunction(name, {
        name: name,
        runtime: "nodejs12.x",
        role: role,
        callback: fn,
        environment: {
            variables: env
        }
    })
}