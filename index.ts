import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

const api = new awsx.apigateway.API("hello-world", {
    routes: [{
        path: "/",
        method: "POST",

        eventHandler: async (event) => {
            return {
                statusCode: 200,
                body: "Hello, world!",
            };
        },
    }],
})