import { ClientCertificateCredential } from '@azure/identity';
import { EnvironmentVariable, getEnvironment } from './environment';
import { Client } from '@microsoft/microsoft-graph-client';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let cachedCredential: ClientCertificateCredential | undefined;
let cachedClient: Client | undefined;

export function getCredential(): ClientCertificateCredential {
  if (cachedCredential) {
    return cachedCredential;
  }

  const rawCert = getEnvironment(EnvironmentVariable.AZURE_CLIENT_CERT);
  const tenantId = getEnvironment(EnvironmentVariable.AZURE_TENANT_ID);
  const clientId = getEnvironment(EnvironmentVariable.AZURE_CLIENT_ID);

  const cert = rawCert
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n');

  const tempPath = join(tmpdir(), `azure-cert-${clientId}.pem`);
  writeFileSync(tempPath, cert);

  cachedCredential = new ClientCertificateCredential(tenantId, clientId, tempPath);
  return cachedCredential;
}

export function getClient(): Client {
  if (cachedClient) {
    return cachedClient;
  }

  const credential = getCredential();

  cachedClient = Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const token = await credential.getToken('https://graph.microsoft.com/.default');
        if (!token) {
          throw new Error('Failed to acquire access token');
        }
        return token.token;
      },
    },
  });

  return cachedClient;
}
