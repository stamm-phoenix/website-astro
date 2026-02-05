import { ClientCertificateCredential } from "@azure/identity";
import { EnvironmentVariable, getEnvironment } from "./environment";
import { Client } from "@microsoft/microsoft-graph-client";
import { get } from "node:http";

export function getCredential(): ClientCertificateCredential {
  const AZURE_CLIENT_SECRET = getEnvironment(
    EnvironmentVariable.AZURE_CLIENT_CERT,
  );

  const fs = require("fs");
  const tempCertPath = "/tmp/key.pem";
  fs.writeFileSync(tempCertPath, AZURE_CLIENT_SECRET);

  const AZURE_TENANT_ID = getEnvironment(EnvironmentVariable.AZURE_TENANT_ID);

  const AZURE_CLIENT_ID = getEnvironment(EnvironmentVariable.AZURE_CLIENT_ID);

  const credential = new ClientCertificateCredential(
    AZURE_TENANT_ID,
    AZURE_CLIENT_ID,
    tempCertPath,
  );

  return credential;
}

export function getClient(): Client {
  const credential = getCredential();

  const client = Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const token = await credential.getToken(
          "https://graph.microsoft.com/.default",
        );
        if (!token) {
          throw new Error("Failed to acquire access token");
        }
        return token.token;
      },
    },
  });

  return client;
}
