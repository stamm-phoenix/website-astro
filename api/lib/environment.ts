/**
 * Values read from the environment: secrets and operational switches only. Everything else is
 * non-secret configuration in `config.ts`; the Nikolausdienst is controlled in the
 * Leitendenbereich (module „Steuerung“, `nikolaus-settings.ts`).
 *
 * Switches can be flipped without a deployment; missing or any value other than "true" is the
 * safe state.
 *
 * The App Settings `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` are not read here but by the
 * login of the Static Web App (`staticwebapp.config.json`), so they must stay in Azure.
 */
export enum EnvironmentVariable {
  AZURE_CLIENT_CERT = 'AZURE_CLIENT_CERT',

  NIKOLAUS_STATE_SECRET = 'NIKOLAUS_STATE_SECRET',
  OPENROUTESERVICE_API_KEY = 'OPENROUTESERVICE_API_KEY',

  SAMMELBESTELLUNG_LINK_SECRET = 'SAMMELBESTELLUNG_LINK_SECRET',
  CAMPFLOW_API_TOKEN = 'CAMPFLOW_API_TOKEN',
  SAMMELBESTELLUNG_CAMPFLOW_CREATE_ENABLED = 'SAMMELBESTELLUNG_CAMPFLOW_CREATE_ENABLED',
  PLAYWRIGHT_API_KEY = 'PLAYWRIGHT_API_KEY',

  AZURE_OPENAI_API_KEY = 'AZURE_OPENAI_API_KEY',
  INSTAGRAM_ACCESS_TOKEN = 'INSTAGRAM_ACCESS_TOKEN',
  GITHUB_REBUILD_TOKEN = 'GITHUB_REBUILD_TOKEN',

  KONTAKT_ALTCHA_SECRET = 'KONTAKT_ALTCHA_SECRET',
}

/** The value of a variable, or `undefined` if it is not set. */
export function findEnvironment(variable: EnvironmentVariable): string | undefined {
  return process.env[variable] || undefined;
}

export function getEnvironment(variable: EnvironmentVariable): string {
  const value = findEnvironment(variable);
  if (!value) {
    throw new Error(`Missing environment variable: ${variable}`);
  }
  return value;
}
