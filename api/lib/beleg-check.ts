import { CONFIG } from './config';
import { dailyLimit, isDeploymentConfigured, requestStructuredOutput } from './azure-openai';

/**
 * Preliminary check of receipt photos with an image model on Azure OpenAI: is it a receipt,
 * is it fully visible and readable enough for the archive? Also reads shop, date and amount
 * to prefill the form. The result is only a hint; the Kassenteam decides.
 *
 * Optional: with an empty endpoint or deployment in `CONFIG.belege.check` the check is skipped.
 * With `AZURE_OPENAI_API_KEY` the key is used, otherwise the app registration (Entra ID).
 * `maxChecksPerDay` caps the checks per day and Functions instance as a safety net against
 * runaway costs; the hard limit is the deployment's quota.
 */

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ISSUES = 8;
const MAX_ISSUE_LENGTH = 200;
const MAX_RESTRICTED_ITEMS = 20;
const MAX_ITEM_LENGTH = 100;

/** Result of the check as stored with the receipt and sent to the browser. */
export interface BelegCheck {
  /** Receipt, fully visible and readable: fit for the archive. */
  ok: boolean;
  isReceipt: boolean;
  complete: boolean;
  readable: boolean;
  /** Concrete problems in German, e.g. „Der obere Rand ist abgeschnitten.“ */
  issues: string[];
  /**
   * Positions that are not suitable for youth work (alcohol, tobacco, other adult-only items),
   * as printed on the receipt. A hint for the Kasse; it does not affect `ok`.
   */
  restrictedItems: string[];
  shop: string | null;
  /** `YYYY-MM-DD` */
  date: string | null;
  amountCent: number | null;
  checkedAt: string;
}

export class BelegCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BelegCheckError';
  }
}

/** The daily limit of checks is used up; the receipt can still be submitted. */
export class BelegCheckLimitError extends BelegCheckError {
  constructor() {
    super('Daily limit of receipt checks reached');
    this.name = 'BelegCheckLimitError';
  }
}

export function isBelegCheckConfigured(): boolean {
  return isDeploymentConfigured(CONFIG.belege.check);
}

/** Checks of the current day on this instance. */
const takeCheck = dailyLimit(() => CONFIG.belege.check.maxChecksPerDay);

/** Counts a check against the daily limit; throws once the limit is reached. */
export function reserveCheck(now = new Date()): void {
  if (!takeCheck(now)) throw new BelegCheckLimitError();
}

const PROMPT = `Du prüfst Fotos von Kassenbelegen (Kassenbons, Quittungen, Rechnungen) für das Belegarchiv eines Pfadfinderstammes. Das Archiv ist revisionssicher: Ein Foto ist nur geeignet, wenn der ganze Beleg zu sehen und alles Wesentliche gut lesbar ist.

Beurteile:
- isReceipt: Zeigt das Foto einen Beleg? (Nicht: Produktfoto, Bildschirmfoto einer Bestellung ohne Rechnungsdaten, Person, Landschaft.)
- complete: Sind alle Ränder des Belegs zu sehen, nichts abgeschnitten oder verdeckt, nur ein Beleg auf dem Foto?
- readable: Sind Geschäft, Datum, Gesamtbetrag und Positionen scharf und gut lesbar (kein Verwackeln, keine Spiegelung, kein starker Schatten, nicht zu dunkel, nicht stark verzerrt)?
- issues: Konkrete Mängel auf Deutsch, je ein kurzer Satz mit Hinweis zur Abhilfe, z. B. „Der untere Rand mit dem Gesamtbetrag ist abgeschnitten.“ Leer, wenn alles passt.
- shop, date (YYYY-MM-DD), amount (Gesamtbetrag in Euro als Zahl): nur, wenn sicher lesbar, sonst null.
- restrictedItems: Positionen, die in der Jugendarbeit nicht abgerechnet werden dürfen, so wie sie auf dem Beleg stehen (z. B. „Augustiner Hell 0,5l“): alkoholische Getränke (Bier, Radler, Wein, Sekt, Spirituosen, Alkopops, alkoholhaltige Mixgetränke), Lebensmittel mit deutlichem Alkoholgehalt (z. B. Weinbrandbohnen, Rumtopf, Eierlikör), Tabakwaren (Zigaretten, Tabak, Zigarren, Shisha-Tabak, E-Zigaretten, Liquids, Nikotinbeutel) und sonstige nicht jugendfreie Artikel (z. B. Medien ab 18, Erotikartikel). Nicht dazu gehören alkoholfreie Varianten („alkoholfrei“, „0,0 %“), Pfand und Kochzutaten wie Essig. Nur aufnehmen, wenn die Position auf dem Beleg eindeutig erkennbar ist; leer, wenn nichts davon zu sehen ist.

Sei streng bei complete und readable, aber erfinde keine Mängel und keine Positionen.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'isReceipt',
    'complete',
    'readable',
    'issues',
    'restrictedItems',
    'shop',
    'date',
    'amount',
  ],
  properties: {
    isReceipt: { type: 'boolean' },
    complete: { type: 'boolean' },
    readable: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
    restrictedItems: { type: 'array', items: { type: 'string' } },
    shop: { type: ['string', 'null'] },
    date: { type: ['string', 'null'] },
    amount: { type: ['number', 'null'] },
  },
};

function readText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, max) : null;
}

function readTexts(value: unknown, maxLength: number, maxCount: number): string[] {
  return (Array.isArray(value) ? value : [])
    .map((entry) => readText(entry, maxLength))
    .filter((entry): entry is string => entry !== null)
    .slice(0, maxCount);
}

/** Turns the model's answer into a checked result; anything unexpected is dropped. */
export function toBelegCheck(raw: unknown, now = new Date()): BelegCheck {
  if (raw === null || typeof raw !== 'object') {
    throw new BelegCheckError('Unexpected answer of the model');
  }
  const answer = raw as Record<string, unknown>;
  const isReceipt = answer.isReceipt === true;
  const complete = isReceipt && answer.complete === true;
  const readable = isReceipt && answer.readable === true;
  const issues = readTexts(answer.issues, MAX_ISSUE_LENGTH, MAX_ISSUES);
  const restrictedItems = isReceipt
    ? readTexts(answer.restrictedItems, MAX_ITEM_LENGTH, MAX_RESTRICTED_ITEMS)
    : [];

  const date = readText(answer.date, 10);
  const amount = answer.amount;
  const amountCent =
    typeof amount === 'number' && Number.isFinite(amount) && amount > 0 && amount <= 10_000
      ? Math.round(amount * 100)
      : null;

  return {
    ok: isReceipt && complete && readable,
    isReceipt,
    complete,
    readable,
    issues,
    restrictedItems,
    shop: readText(answer.shop, 100),
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    amountCent,
    checkedAt: now.toISOString(),
  };
}

/** Checks a JPEG photo; returns undefined if the check is not configured. */
export async function checkBelegPhoto(jpeg: Uint8Array): Promise<BelegCheck | undefined> {
  if (!isBelegCheckConfigured()) return undefined;
  reserveCheck();

  const answer = await requestStructuredOutput(CONFIG.belege.check, {
    schemaName: 'belegpruefung',
    schema: RESPONSE_SCHEMA,
    maxCompletionTokens: 800,
    timeoutMs: REQUEST_TIMEOUT_MS,
    messages: [
      { role: 'system', content: PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`,
              detail: 'high',
            },
          },
        ],
      },
    ],
  });
  return toBelegCheck(answer);
}

/** Parses a stored check; invalid or missing values yield null. */
export function parseStoredBelegCheck(value: string | undefined): BelegCheck | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<BelegCheck>;
    if (typeof parsed?.ok !== 'boolean' || !Array.isArray(parsed.issues)) return null;
    return {
      ok: parsed.ok,
      isReceipt: parsed.isReceipt === true,
      complete: parsed.complete === true,
      readable: parsed.readable === true,
      issues: parsed.issues.filter((issue): issue is string => typeof issue === 'string'),
      restrictedItems: Array.isArray(parsed.restrictedItems)
        ? parsed.restrictedItems.filter((item): item is string => typeof item === 'string')
        : [],
      shop: typeof parsed.shop === 'string' ? parsed.shop : null,
      date: typeof parsed.date === 'string' ? parsed.date : null,
      amountCent: typeof parsed.amountCent === 'number' ? parsed.amountCent : null,
      checkedAt: typeof parsed.checkedAt === 'string' ? parsed.checkedAt : '',
    };
  } catch {
    return null;
  }
}
