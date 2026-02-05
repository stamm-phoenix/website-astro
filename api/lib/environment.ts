export enum EnvironmentVariable {
  AZURE_CLIENT_CERT = "AZURE_CLIENT_CERT",
  AZURE_CLIENT_ID = "AZURE_CLIENT_ID",
  AZURE_CLIENT_SECRET = "AZURE_CLIENT_SECRET",
  AZURE_TENANT_ID = "AZURE_TENANT_ID",
  SHAREPOINT_HOST_NAME = "SHAREPOINT_HOST_NAME",
  SHAREPOINT_SITE_ID = "SHAREPOINT_SITE_ID",
  SHAREPOINT_SITE_NAME = "SHAREPOINT_SITE_NAME",
  SHAREPOINT_TEAMS_LIST_ID = "SHAREPOINT_TEAMS_LIST_ID",
}

export function getEnvironment(variable: EnvironmentVariable): string {
  const value = process.env[variable];
  if (!value) {
    throw new Error(`Missing environment variable: ${variable}`);
  }
  return value;
}
