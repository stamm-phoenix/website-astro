/** Types of the non-secret configuration; the values are `CONFIG` in `config.ts`. */

/** Teams that grant a role in the Leitendenbereich (`CONFIG.staff.teams`). */
export type StaffTeam = 'leitende' | 'kasse' | 'vorstand' | 'admin' | 'verein';

export interface ApiConfig {
  /** App registration the API uses to access SharePoint, the database, Blob Storage and send mails. */
  azure: {
    tenantId: string;
    clientId: string;
  };
  /** Azure SQL database (Entra authentication only), see `docs/azure-sql.md`. */
  database: {
    /** Host name of the logical server; previews use their own (`previewServer`). */
    server: string;
    name: string;
    /**
     * Server of the PR preview databases, apart from production, so the identity that creates
     * and drops them cannot reach the production database (#228).
     */
    previewServer: string;
  };
  /** Blob Storage for files (blog images), see `docs/azure-sql.md`. */
  storage: {
    /** Storage account; previews use an account of their own. */
    account: string;
    container: string;
  };
  sharepoint: {
    site: {
      hostName: string;
      /** Graph site ID (`<site collection>,<web>`). */
      id: string;
    };
  };
  mail: {
    nikolausSender: string;
    sammelbestellungSender: string;
    /**
     * Mailbox for the receipt mails (rejection to the uploader, new receipt to the Kasse);
     * without it no mail is sent.
     */
    belegeSender?: string;
  };
  taskDirectory: { groupId: string; domain: string; shortNames: Record<string, readonly string[]> };
  taskReminders: {
    sender: string;
    siteUrl: string;
    daysBefore: readonly number[];
    startHour: number;
    batchSize: number;
    maxBatches: number;
    retentionDays: number;
    mailTimeoutMs: number;
  };
  /** Reminder mails for the next Leitendenrunde (`docs/aufgaben-timer.md`). */
  leitendenrundeReminders: {
    sender: string;
    siteUrl: string;
    /** Reminders this many days before the meeting, at `startHour` Berlin time or later. */
    daysBefore: readonly number[];
    startHour: number;
    /** Upper bound of mails per run, so a wrong recipient list stays small. */
    maxMailsPerRun: number;
    retentionDays: number;
    mailTimeoutMs: number;
  };
  /**
   * Azure Maps for the geocoding of the Nikolaus addresses and the driving times and routes of
   * the Dispo (`azure-maps.ts`); the optional key `AZURE_MAPS_API_KEY` is a secret.
   */
  azureMaps: {
    /** Geographic endpoint, so addresses are processed and stored in the EU only. */
    endpoint: string;
    /**
     * Client ID (`uniqueId`) of the Maps account for the Entra login of the app registration;
     * empty without key: no requests, the Dispo estimates and addresses stay unlocated.
     */
    clientId: string;
    searchApiVersion: string;
    routeApiVersion: string;
    renderApiVersion: string;
  };
  /** Map tiles of the Nikolaus maps, served by the API from Azure Maps (`map-tiles.ts`). */
  mapTiles: {
    maxZoom: number;
    /** Half the side of the square around the starting point of the teams that is served. */
    areaRadiusKm: number;
    /** Requests to Azure Maps per day and Function instance, as a safety net for the costs. */
    maxRequestsPerDay: number;
  };
  nikolaus: {
    /** Shared budget of Nikolaus mails per sender; resends may use a fifth of it. */
    mailHourlyLimit: number;
    mailDailyLimit: number;
    /**
     * Shared budget of Azure Maps geocoding requests (each search step counts), because the
     * address search of the booking form is public; cache hits are free.
     */
    geocodingHourlyLimit: number;
    geocodingDailyLimit: number;
  };
  belege: {
    /** Azure OpenAI model for the automatic receipt check (the key is a secret). */
    check: {
      endpoint: string;
      deployment: string;
      /** For reasoning models; see `AzureOpenAiDeployment`. */
      reasoningEffort?: 'low' | 'medium' | 'high';
      /** Checks per day and Function instance. */
      maxChecksPerDay: number;
    };
  };
  /** Our Playwright service that reads CampFlow pages the API does not cover (the key is a secret). */
  playwrightApi: {
    url: string;
  };
  /** NaMi, the member register of the DPSG, read for the module „Nami-Abgleich“ (`docs/nami-abgleich.md`). */
  nami: {
    /** Base of NaMi's REST API, e.g. `https://nami.dpsg.de/ica/rest`. */
    baseUrl: string;
    /** Our Stamm in NaMi; its members are compared with CampFlow. */
    gruppierungId: number;
  };
  sammelbestellung: {
    /** Tax sphere used only when creating a missing Bestellungen category. */
    categorySphere: 'ideal' | 'purpose' | 'assets' | 'business';
  };
  kontakt: {
    /** Mailbox that sends the contact mails and receives the messages (needs Mail.Send). */
    mailbox: string;
    /** Messages per Function instance; each one sends two mails. */
    hourlyLimit: number;
    dailyLimit: number;
  };
  /** Schnupperstunden-Anfragen of /mitmachen (#139); the mails go out from `kontakt.mailbox`. */
  schnupper: {
    /** Requests per hour and day over all Function instances, counted in the database. */
    hourlyLimit: number;
    dailyLimit: number;
    /** Days a request is kept: open ones after arrival, confirmed ones after the date, cancelled ones after the answer. */
    retention: { openDays: number; confirmedDays: number; cancelledDays: number };
  };
  /** „Problem melden“: Meldungen der Besuchenden, KI-Sichtung und GitHub (docs/problemmeldungen.md). */
  problemmeldung: {
    /** Reports per hour and day over all Function instances, counted in the database. */
    hourlyLimit: number;
    dailyLimit: number;
    /** Azure OpenAI model that assesses a report and drafts the issue (key shared with the receipt check). */
    ai: {
      endpoint: string;
      deployment: string;
      /** For reasoning models; see `AzureOpenAiDeployment`. */
      reasoningEffort?: 'low' | 'medium' | 'high';
      /** Assessments per day and Function instance. */
      maxPerDay: number;
      /** A visitor waits for the assessment while the report is sent; it is retried by hand after a timeout. */
      timeoutMs: number;
    };
    /** Repository that receives the issues, as `owner/name` (the token is a secret). */
    githubRepository: string;
    /** Days a report is kept after it was discarded, sent to GitHub or, still open, received. */
    retention: { discardedDays: number; sentDays: number; openDays: number };
  };
  /**
   * Proof of work of the ALTCHA widget (PBKDF2 iterations and counter range) in the public forms:
   * Kontakt, Nikolaus booking and the Sammelbestellung link request.
   */
  altcha: {
    cost: number;
    minCounter: number;
    maxCounter: number;
    expiresMinutes: number;
  };
  protokolle: ProtokolleConfig;
  /** Photos of the Aktionen, shown and uploaded in the module „Fotos“ (`docs/fotos.md`). */
  fotos: {
    /** Document library of the site (name in its URL). */
    library: string;
    /** Mailbox the note about new photos is sent from. */
    sender: string;
    /** CampFlow groups whose members get the note about new photos (prefix, like the minutes). */
    campflowGroups: string[];
    /** CampFlow labels whose members get the note too, like the minutes. */
    campflowLabels: string[];
  };
  /** Attendance in the Gruppenstunden (`docs/anwesenheit.md`). */
  anwesenheit: {
    /**
     * Months after a Gruppenstunde until the CampFlow IDs and guest names of its attendance
     * are removed; the counts stay for the statistics.
     */
    retentionMonths: number;
  };
  /** Essensplanung (`docs/essensplanung.md`). */
  essensplanung: {
    /** Mailbox the confirmations, invitations and links are sent from. */
    sender: string;
    /**
     * Azure OpenAI model for checking dishes, reading recipes and estimating grams (key shared
     * with the receipt check). No daily limit: the quota of the deployment answers with 429,
     * which the page shows as „KI gerade nicht verfügbar“. Empty endpoint or deployment: off.
     */
    ki: {
      endpoint: string;
      deployment: string;
      reasoningEffort?: 'low' | 'medium' | 'high';
    };
  };
  /** Abstimmungen and Terminfindung (`docs/abstimmungen.md`). */
  abstimmungen: {
    /** Mailbox the invitations and reminders are sent from. */
    sender: string;
    /** CampFlow groups whose members are offered for an invitation (prefix, like the minutes). */
    campflowGroups: string[];
    /** CampFlow labels whose members are offered too, like the minutes. */
    campflowLabels: string[];
  };
  staff: {
    /**
     * Logins of test accounts that may enter the Leitendenbereich only on PR previews, e.g. for
     * Claude Code to check pages there (`docs/preview-testkonto.md`). Compared without case.
     */
    previewOnlyLogins: string[];
    /**
     * Microsoft Teams whose members get a role of Static Web Apps at login (`GetRoles`, see
     * `docs/berechtigungen.md`). Role names allow only letters, digits and `_`.
     */
    teams: Record<StaffTeam, { groupId: string; role: string }>;
  };
  abrechnung: {
    /** „Antragsteller (Verband/Verein)“ in the KJR's Teilnahmeliste. */
    antragsteller: string;
    leihgebuehren: LeihgebuehrenConfig;
    /**
     * Reading a Zeitplan for the Kurzbeschreibung from a file, with the model of the receipt
     * check (`belege.check`). Reads per day and Function instance; 0 switches it off.
     */
    zeitplanMaxReadsPerDay: number;
  };
}

/** Minutes of meetings, written in Word and sent to all leaders after a review. */
export interface ProtokolleConfig {
  /** Document library (name in its URL) and folder that hold the minutes; see docs/protokolle.md. */
  library: string;
  folderPath: string;
  /** Word template new minutes are copied from, a file in `folderPath`. */
  templateFileName: string;
  /** Preset title of new minutes. */
  defaultTitle: string;
  /** Mailbox that sends the minutes (needs Mail.Send); without it nothing is sent. */
  sender: string;
  /**
   * CampFlow groups of the member list whose current members receive the minutes. Compared
   * without emoji, gender star and case, by their start: „Leiter*in“ matches „🐦‍🔥 Leiter*in“.
   */
  campflowGroups: string[];
  /**
   * CampFlow labels of the member list whose current members also receive the minutes, e.g.
   * people outside the leader groups. Compared without emoji and case, but as a whole name with digits.
   */
  campflowLabels: string[];
  /**
   * Detection of the next meeting's date in approved minutes with Azure OpenAI (same resource
   * and key as the receipt check). Empty endpoint or deployment: no detection, the date can
   * still be entered by hand. See docs/protokolle.md.
   */
  termin: {
    endpoint: string;
    deployment: string;
    /** For reasoning models; see `AzureOpenAiDeployment`. */
    reasoningEffort?: 'low' | 'medium' | 'high';
    /** Detections per day and Function instance. */
    maxExtractionsPerDay: number;
  };
  /** Manual task proposals from approved minutes; see docs/aufgaben.md. */
  aufgaben: ProtokolleConfig['termin'];
  /** Correction proposals for minutes of the editor on request (#553); see docs/protokoll-editor.md. */
  korrektur: ProtokolleConfig['termin'];
}

/** Fees the Stamm charges an Aktion for its tents and material. */
export interface LeihgebuehrenConfig {
  /** Who decided the current fees; read as „in der …“, e.g. „e.V.-Versammlung“. */
  beschlossenVon: string;
  /** Date of that decision, the last change of the fees (YYYY-MM-DD). */
  stand: string;
  /** In the order of the Leihgebühren sheet; `id` keys what is entered on the page. */
  material: { id: string; name: string; priceCentPerDay: number }[];
}
