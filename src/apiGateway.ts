import * as awsx from "@pulumi/awsx";
import {lambda} from "./pulumiLambdas";

// create API
let apiGateway = new awsx.apigateway.API(`payloads-api-meetup-api-gateway`, {
    routes: [
        {
            path: "/post_to_s3",
            method: "POST",
            eventHandler: lambda
        }
    ]
})

export {apiGateway}