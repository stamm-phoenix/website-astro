import type { InvocationContext, HttpResponseInit } from "@azure/functions";

export interface Environment {
  AZURE_TENANT_ID: string;
  AZURE_CLIENT_ID: string;
  AZURE_CLIENT_SECRET: string;
  SHAREPOINT_BASE_URL: string;
  SHAREPOINT_SITE_ID: string;
  SHAREPOINT_LEITUNGSTEAMS_LIST_ID: string;
}

export function getEnvironment(context: InvocationContext): Environment | null {
  const envVars = {
    AZURE_TENANT_ID: process.env.AZURE_TENANT_ID,
    AZURE_CLIENT_ID: process.env.AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET: process.env.AZURE_CLIENT_SECRET,
    SHAREPOINT_BASE_URL: process.env.SHAREPOINT_BASE_URL,
    SHAREPOINT_SITE_ID: process.env.SHAREPOINT_SITE_ID,
    SHAREPOINT_LEITUNGSTEAMS_LIST_ID:
      process.env.SHAREPOINT_LEITUNGSTEAMS_LIST_ID,
  };

  const isMissing = Object.values(envVars).some((value) => !value);

  if (isMissing) {
    return null;
  }

  return envVars as unknown as Environment;
}
