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
  TASK_REMINDERS_ENABLED = 'TASK_REMINDERS_ENABLED',
  LEITENDENRUNDE_REMINDERS_ENABLED = 'LEITENDENRUNDE_REMINDERS_ENABLED',
  ESSENSPLANUNG_AUFBEWAHRUNG_ENABLED = 'ESSENSPLANUNG_AUFBEWAHRUNG_ENABLED',

  NIKOLAUS_STATE_SECRET = 'NIKOLAUS_STATE_SECRET',
  AZURE_MAPS_API_KEY = 'AZURE_MAPS_API_KEY',

  SAMMELBESTELLUNG_LINK_SECRET = 'SAMMELBESTELLUNG_LINK_SECRET',
  CAMPFLOW_API_TOKEN = 'CAMPFLOW_API_TOKEN',
  SAMMELBESTELLUNG_CAMPFLOW_CREATE_ENABLED = 'SAMMELBESTELLUNG_CAMPFLOW_CREATE_ENABLED',
  PLAYWRIGHT_API_KEY = 'PLAYWRIGHT_API_KEY',
  /** Login of the NaMi account (Mitgliedsnummer) the module „Nami-Abgleich“ reads with. */
  NAMI_USERNAME = 'NAMI_USERNAME',
  NAMI_PASSWORD = 'NAMI_PASSWORD',

  AZURE_OPENAI_API_KEY = 'AZURE_OPENAI_API_KEY',
  INSTAGRAM_ACCESS_TOKEN = 'INSTAGRAM_ACCESS_TOKEN',
  GITHUB_REBUILD_TOKEN = 'GITHUB_REBUILD_TOKEN',
  GITHUB_ISSUES_TOKEN = 'GITHUB_ISSUES_TOKEN',

  KONTAKT_ALTCHA_SECRET = 'KONTAKT_ALTCHA_SECRET',

  /**
   * Application Insights for the usage events of the Leitendenbereich (`usage-telemetry.ts`).
   * Deliberately not `APPLICATIONINSIGHTS_CONNECTION_STRING`, which would also connect the
   * Functions host and send its log lines with the names of the acting users.
   */
  USAGE_INSIGHTS_CONNECTION_STRING = 'USAGE_INSIGHTS_CONNECTION_STRING',
  /** Key of the pseudonyms in those events; changing it starts new pseudonyms for everyone. */
  USAGE_PSEUDONYM_SECRET = 'USAGE_PSEUDONYM_SECRET',
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
