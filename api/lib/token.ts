import { ClientCertificateCredential } from "@azure/identity";
import { EnvironmentVariable, getEnvironment } from "./environment";
import { Client } from "@microsoft/microsoft-graph-client";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function getCredential(): ClientCertificateCredential {
  const rawCert = getEnvironment(EnvironmentVariable.AZURE_CLIENT_CERT);
  const tenantId = getEnvironment(EnvironmentVariable.AZURE_TENANT_ID);
  const clientId = getEnvironment(EnvironmentVariable.AZURE_CLIENT_ID);

  const cert = rawCert
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\n/g, "\n");

  const tempPath = join(tmpdir(), `azure-cert-${clientId}.pem`);
  writeFileSync(tempPath, cert);

  return new ClientCertificateCredential(tenantId, clientId, tempPath);
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
