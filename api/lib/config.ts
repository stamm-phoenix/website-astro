/**
 * Non-secret, stable configuration of the API.
 *
 * Secrets and the operational switches stay environment variables (see `environment.ts`).
 * Everything else lives here, so changes are reviewed and take effect with the next deployment.
 * There are no environment overrides: the value in this file is always the one that applies.
 *
 * Changing the host, the site or one of the Nikolaus list IDs (incl. the state list) changes the
 * retention target. Then also update the GitHub variable `NIKOLAUS_RETENTION_TARGET_DIGEST`
 * (`bun scripts/nikolaus-retention-auto.ts --show-target` prints the new value).
 */

export interface SharePointListsConfig {
  leitende: string;
  gruppenstunden: string;
  calendar: string;
  blog: string;
  qa: string;
  nikolaus: string;
  nikolausDispo: string;
  nikolausHelfende: string;
  nikolausEinteilung: string;
  nikolausState: string;
  sammelbestellungen: string;
  sammelbestellungenOrders: string;
  belege: string;
  instagramToken: string;
}

export interface ApiConfig {
  /** App registration the API uses to access SharePoint and send mails. */
  azure: {
    tenantId: string;
    clientId: string;
  };
  sharepoint: {
    site: {
      hostName: string;
      /** Graph site ID (`<site collection>,<web>`). */
      id: string;
      /** URL name of the site, used by the SharePoint REST API. */
      name: string;
    };
    lists: SharePointListsConfig;
    /** Document library of the public downloads. */
    downloadFilesDriveId: string;
  };
  mail: {
    nikolausSender: string;
    sammelbestellungSender: string;
    /** Mailbox for rejected receipts; without it no mail is sent. */
    belegeSender?: string;
  };
  nikolaus: {
    /** Nominatim-compatible search endpoint (https, without query). */
    geocodingUrl: string;
    /** Shared budget of Nikolaus mails per sender; resends may use a fifth of it. */
    mailHourlyLimit: number;
    mailDailyLimit: number;
    retention: {
      /** Static Web App whose environments must all be in maintenance before deleting. */
      azureResourceId: string;
    };
  };
  belege: {
    /** Logins of the Kasse; if empty, every leader may review receipts. */
    reviewers: string[];
    /** Azure OpenAI model for the automatic receipt check (the key is a secret). */
    check: {
      endpoint: string;
      deployment: string;
      /** Checks per day and Function instance. */
      maxChecksPerDay: number;
    };
  };
  /** Our Playwright service that reads CampFlow pages the API does not cover (the key is a secret). */
  playwrightApi: {
    url: string;
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
    /** Proof of work of the ALTCHA widget (PBKDF2 iterations and counter range). */
    altcha: {
      cost: number;
      minCounter: number;
      maxCounter: number;
      expiresMinutes: number;
    };
  };
  abrechnung: {
    /** „Antragsteller (Verband/Verein)“ in the KJR's Teilnahmeliste. */
    antragsteller: string;
    leihgebuehren: LeihgebuehrenConfig;
  };
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

export const CONFIG: ApiConfig = {
  azure: {
    tenantId: '0e650e3e-3da0-4a47-bf6c-df3dd3980caa',
    clientId: '5dd5864b-e2c3-4c21-9ef2-8bb3290cd374',
  },
  sharepoint: {
    site: {
      hostName: 'stammphoenix.sharepoint.com',
      id: '571937bd-77aa-4e71-8d76-86e60015a1b9,6eec5ae9-3bb4-4393-913a-ee9e0fef0be1',
      name: 'leitende',
    },
    lists: {
      leitende: '2b640d3e-d55e-49b0-86cd-4cb0bf37692f',
      gruppenstunden: 'ad66dc9e-35f6-4ca8-ad54-02480eea56ec',
      calendar: '1196c1ac-e827-4635-b448-d423c7d5eda7',
      blog: '084c37a7-e082-4f8f-aabd-a683c09c5213',
      qa: '3c3cfa4e-a979-46cb-a9bb-ac4df2bdead4',
      nikolaus: '50a9a0ac-ad8f-4546-b459-1f2748dfc45b',
      nikolausDispo: '924A2FA8-A352-4C36-8C76-C7ACBF1CDB49',
      nikolausHelfende: '5491B319-4FA8-491A-A7DC-3D481887D485',
      nikolausEinteilung: '0C32AB65-F599-4046-8AC7-15C4CD8B749D',
      nikolausState: '0e1d6c9b-0d49-4428-8564-16b8ccc01929',
      sammelbestellungen: '76DEB54F-349F-4FAE-AA0B-CB28A20DFA09',
      sammelbestellungenOrders: 'E42392B2-B561-4571-8903-C16294A4CDCD',
      belege: '2BE08C2C-A0C7-4013-9B54-C493E94ED5C0',
      instagramToken: '99D2DD9F-287F-450B-BA15-845F7675D285',
    },
    downloadFilesDriveId: 'b!vTcZV6p3cU6NdobmABWhuela7G60O5NDkTrung_vC-GascAkCDm5R6AF6mwrgpyc',
  },
  mail: {
    nikolausSender: 'nikolaus@stamm-phoenix.de',
    sammelbestellungSender: 'bestellungen@stamm-phoenix.de',
  },
  nikolaus: {
    geocodingUrl: 'https://nominatim.openstreetmap.org/search',
    mailHourlyLimit: 100,
    mailDailyLimit: 500,
    retention: {
      azureResourceId:
        '/subscriptions/c2d4a93c-3959-473a-b944-fd5c8297e71a/resourceGroups/website-astro/providers/Microsoft.Web/staticSites/website-astro',
    },
  },
  belege: {
    reviewers: [],
    check: {
      endpoint: 'https://website-astro-openai.openai.azure.com',
      deployment: 'gpt-4.1-mini',
      maxChecksPerDay: 100,
    },
  },
  playwrightApi: {
    url: 'https://website-astro-playwright-api.proudfield-37525178.germanywestcentral.azurecontainerapps.io',
  },
  sammelbestellung: {
    categorySphere: 'business',
  },
  kontakt: {
    mailbox: 'kontakt@stamm-phoenix.de',
    hourlyLimit: 20,
    dailyLimit: 100,
    altcha: {
      // About one second on a laptop, a few on an older phone; the widget starts on focus.
      cost: 2_000,
      minCounter: 2_000,
      maxCounter: 5_000,
      // Long enough to fill in the form after the widget solved the challenge.
      expiresMinutes: 60,
    },
  },
  abrechnung: {
    antragsteller: 'DPSG Stamm Phoenix Feldkirchen-Westerham',
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
