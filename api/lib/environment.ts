/**
 * Values read from the environment: secrets and operational switches only. Everything else is
 * non-secret configuration in `config.ts`.
 *
 * Switches can be flipped without a deployment; missing or any value other than "true" is the
 * safe state:
 * - `NIKOLAUS_WRITES_ENABLED` (App Setting): emergency stop for all Nikolaus writes (503).
 * - `NIKOLAUS_RETENTION_ENABLED` (GitHub variable): allows the daily retention job to delete.
 * - `NIKOLAUS_RETENTION_TARGET_DIGEST` (GitHub variable): must match the retention target
 *   computed from `config.ts`, otherwise the retention job aborts.
 *
 * The App Settings `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` are not read here but by the
 * login of the Static Web App (`staticwebapp.config.json`), so they must stay in Azure.
 */
export enum EnvironmentVariable {
  AZURE_CLIENT_CERT = 'AZURE_CLIENT_CERT',

  NIKOLAUS_STATE_SECRET = 'NIKOLAUS_STATE_SECRET',
  NIKOLAUS_WRITES_ENABLED = 'NIKOLAUS_WRITES_ENABLED',
  NIKOLAUS_RETENTION_ENABLED = 'NIKOLAUS_RETENTION_ENABLED',
  NIKOLAUS_RETENTION_TARGET_DIGEST = 'NIKOLAUS_RETENTION_TARGET_DIGEST',
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

export function getEnvironment(variable: EnvironmentVariable): string {
  const value = process.env[variable];
  if (!value) {
    throw new Error(`Missing environment variable: ${variable}`);
  }
  return value;
}
