import { PRODUCTION_SITE_URL } from './public-site';
/**
 * Non-secret, stable configuration of the API.
 *
 * Secrets and the operational switches stay environment variables (see `environment.ts`).
 * Everything else lives here, so changes are reviewed and take effect with the next deployment.
 * There are no environment overrides: the value in this file is always the one that applies.
 * The one exception is the database, blob container and Playwright API of PR previews, written
 * into `deployment.ts` at deploy time.
 */
import { PREVIEW_CONTAINER, PREVIEW_DATABASE, PREVIEW_PLAYWRIGHT_API } from './deployment';
import type { ApiConfig } from './config-types';

/** Logical server of the PR preview databases (`CONFIG.database.previewServer`). */
const PREVIEW_SQL_SERVER = 'stamm-phoenix-previews.database.windows.net';

/** Microsoft Team „Leitende“ (`team-leitende`): the people of the Leitendenbereich. */
const TEAM_LEITENDE = '554e9d9c-be77-407b-bd21-37b056947faf';

/**
 * Azure OpenAI resource and the only model deployment of the website, used by every AI feature:
 * Data Zone Standard, so everything sent is processed in the EU only. A reasoning model, so
 * every feature sets `reasoningEffort` (without it `temperature: 0` is sent, which it refuses).
 */
const AZURE_OPENAI = {
  endpoint: 'https://website-astro-openai.openai.azure.com',
  deployment: 'gpt-6.1-sol-datazone',
  reasoningEffort: 'low',
} as const;

export const CONFIG: ApiConfig = {
  azure: {
    tenantId: '0e650e3e-3da0-4a47-bf6c-df3dd3980caa',
    clientId: '5dd5864b-e2c3-4c21-9ef2-8bb3290cd374',
  },
  database: {
    // PR previews have a database of their own on the preview server, written by the deploy
    // workflow
    server: PREVIEW_DATABASE ? PREVIEW_SQL_SERVER : 'stamm-phoenix-website.database.windows.net',
    name: PREVIEW_DATABASE ?? 'website',
    previewServer: PREVIEW_SQL_SERVER,
  },
  storage: {
    // PR previews have a container of their own in a separate account
    account: PREVIEW_CONTAINER ? 'stammphoenixpreviews' : 'stammphoenixwebsite',
    container: PREVIEW_CONTAINER ?? 'website',
  },
  sharepoint: {
    site: {
      hostName: 'stammphoenix.sharepoint.com',
      id: '571937bd-77aa-4e71-8d76-86e60015a1b9,6eec5ae9-3bb4-4393-913a-ee9e0fef0be1',
    },
  },
  mail: {
    nikolausSender: 'nikolaus@stamm-phoenix.de',
    sammelbestellungSender: 'bestellungen@stamm-phoenix.de',
    belegeSender: 'kontakt@stamm-phoenix.de',
  },
  taskDirectory: {
    groupId: TEAM_LEITENDE,
    domain: 'stamm-phoenix.de',
    shortNames: { katharina: ['kathi', 'kati'] },
  },
  taskReminders: {
    sender: 'kontakt@stamm-phoenix.de',
    siteUrl: PRODUCTION_SITE_URL,
    daysBefore: [1, 0],
    startHour: 9,
    batchSize: 2,
    maxBatches: 50,
    retentionDays: 60,
    mailTimeoutMs: 10000,
  },
  leitendenrundeReminders: {
    sender: 'kontakt@stamm-phoenix.de',
    siteUrl: PRODUCTION_SITE_URL,
    daysBefore: [7, 1],
    startHour: 9,
    maxMailsPerRun: 100,
    retentionDays: 120,
    mailTimeoutMs: 10000,
  },
  azureMaps: {
    endpoint: 'https://eu.atlas.microsoft.com',
    clientId: '635b735d-f9c5-4510-b567-c209e65f6830',
    searchApiVersion: '2026-01-01',
    routeApiVersion: '2025-01-01',
    renderApiVersion: '2024-04-01',
  },
  mapTiles: {
    maxZoom: 19,
    areaRadiusKm: 40,
    maxRequestsPerDay: 5000,
  },
  nikolaus: {
    mailHourlyLimit: 100,
    mailDailyLimit: 500,
    geocodingHourlyLimit: 150,
    geocodingDailyLimit: 500,
  },
  belege: {
    check: {
      ...AZURE_OPENAI,
      // Data Zone Standard: the photos are processed in the EU only. In a comparison of
      // receipts with abbreviated alcohol and tobacco, cut-off and blurry photos it found
      // everything with `medium` as with `high`, in about 7 s instead of 12; a long real
      // receipt took 25 s instead of 41 (docs/belege-ki-pruefung.md)
      reasoningEffort: 'medium',
      // Each photo is asked twice: how to turn it, then the check itself
      maxChecksPerDay: 200,
    },
  },
  nami: {
    baseUrl: 'https://nami.dpsg.de/ica/rest',
    // „Feldkirchen-Westerh., Phoenix 131912“
    gruppierungId: 131912,
  },
  playwrightApi: {
    // A PR preview may use the preview of the matching playwright-api PR (scripts/playwright-preview.ts)
    url:
      PREVIEW_PLAYWRIGHT_API ??
      'https://website-astro-playwright-api.proudfield-37525178.germanywestcentral.azurecontainerapps.io',
  },
  sammelbestellung: {
    categorySphere: 'business',
  },
  kontakt: {
    mailbox: 'kontakt@stamm-phoenix.de',
    hourlyLimit: 20,
    dailyLimit: 100,
  },
  schnupper: {
    hourlyLimit: 20,
    dailyLimit: 60,
    retention: { openDays: 180, confirmedDays: 60, cancelledDays: 60 },
  },
  problemmeldung: {
    hourlyLimit: 20,
    dailyLimit: 100,
    ai: {
      ...AZURE_OPENAI,
      maxPerDay: 200,
      // A reasoning model thinks first; the form waits up to a minute for the answer
      timeoutMs: 20_000,
    },
    githubRepository: 'stamm-phoenix/website-astro',
    retention: { discardedDays: 30, sentDays: 90, openDays: 180 },
  },
  altcha: {
    // About one second on a laptop, a few on an older phone; the widget starts on focus.
    cost: 2_000,
    minCounter: 2_000,
    maxCounter: 5_000,
    // Long enough to fill in the form after the widget solved the challenge.
    expiresMinutes: 60,
  },
  protokolle: {
    library: 'Unterlagen',
    folderPath: 'Protokolle/Leitendenrunde',
    templateFileName: 'YYYY-MM-DD_Leitendenrunde.docx',
    defaultTitle: 'Leitendenrunde',
    sender: 'kontakt@stamm-phoenix.de',
    campflowGroups: ['Leiter*in'],
    campflowLabels: ['Protokollempfang'],
    aufgaben: { ...AZURE_OPENAI, maxExtractionsPerDay: 20 },
    korrektur: { ...AZURE_OPENAI, maxExtractionsPerDay: 40 },
    termin: {
      ...AZURE_OPENAI,
      maxExtractionsPerDay: 20,
    },
  },
  fotos: {
    library: 'Fotos',
    sender: 'kontakt@stamm-phoenix.de',
    campflowGroups: ['Leiter*in'],
    campflowLabels: ['Protokollempfang'],
  },
  anwesenheit: {
    retentionMonths: 12,
  },
  essensplanung: {
    sender: 'kontakt@stamm-phoenix.de',
    // The questions are short
    ki: { ...AZURE_OPENAI },
  },
  abstimmungen: {
    sender: 'kontakt@stamm-phoenix.de',
    // Invited with one click, like the recipients of the minutes
    campflowGroups: ['Leiter*in'],
    campflowLabels: ['Protokollempfang'],
  },
  staff: {
    previewOnlyLogins: ['claude-preview@stamm-phoenix.de'],
    teams: {
      // Everyone who may enter the Leitendenbereich, including helpers
      leitende: { groupId: TEAM_LEITENDE, role: 'team_leitende' },
      // Accepts and rejects receipts
      kasse: { groupId: '4e311109-cde1-4201-a132-238ec84c8fd2', role: 'team_kasse' },
      // Sees the Kostenstellen with the Kasse
      vorstand: { groupId: '88f21607-1ee8-45c2-96e4-c9a8303bbe3a', role: 'team_vorstand' },
      // IT-Administratoren: Steuerung der Essensplanung, mit dem Vorstand
      admin: { groupId: '8d15b638-5de2-4960-a4e4-5e1966cafc55', role: 'team_admin' },
      // Förderverein: sein Postfach im Bereich „E-Mail“
      verein: { groupId: 'f1b4dcc5-b2f5-44ca-b75c-d7a211de21de', role: 'team_verein' },
    },
  },
  abrechnung: {
    antragsteller: 'DPSG Stamm Phoenix Feldkirchen-Westerham',
    zeitplanMaxReadsPerDay: 50,
    // When new fees are decided, change the prices and `stand`. Keep the `id` of an item that
    // stays, and give new items a new `id`.
    leihgebuehren: {
      beschlossenVon: 'e.V.-Versammlung',
      stand: '2023-04-02',
      material: [
        { id: 'jurte', name: 'Jurte', priceCentPerDay: 2500 },
        { id: 'ovaljurte', name: 'Ovaljurte', priceCentPerDay: 3500 },
        { id: 'tuareg', name: 'Tuareg', priceCentPerDay: 2000 },
        { id: 'kohte', name: 'Kohte', priceCentPerDay: 1500 },
        { id: 'kueche', name: 'Küchenmaterial', priceCentPerDay: 2000 },
        { id: 'erste-hilfe', name: 'Erste-Hilfe-Material', priceCentPerDay: 1000 },
        { id: 'basteln', name: 'Bastelmaterial', priceCentPerDay: 1000 },
        { id: 'brettspiele', name: 'Brettspielekiste', priceCentPerDay: 1000 },
        { id: 'werkzeug', name: 'Werkzeugkiste', priceCentPerDay: 1000 },
        { id: 'moderation', name: 'Moderationskoffer', priceCentPerDay: 1000 },
        { id: 'outdoor-spiele', name: 'Outdoor-Spielekiste', priceCentPerDay: 1000 },
        { id: 'zeltlampe', name: 'Zeltlampe', priceCentPerDay: 500 },
      ],
    },
  },
};
