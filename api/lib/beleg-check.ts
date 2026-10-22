import { createHash } from 'node:crypto';
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

/** A reasoning model takes about 8 s, rarely 15; a minute leaves room for a slow moment. */
const REQUEST_TIMEOUT_MS = 60_000;
/** The answer is short, but the model's thinking counts against this as well. */
const MAX_COMPLETION_TOKENS = 4_000;
/** How long the check of a photo is reused, e.g. when the form submits the photo it checked. */
const REUSE_MS = 60 * 60 * 1000;
const MAX_REUSED = 200;
const MAX_ISSUES = 8;
const MAX_ISSUE_LENGTH = 200;
const MAX_RESTRICTED_ITEMS = 20;
const MAX_ITEM_LENGTH = 100;

/** Result of the check as stored with the receipt and sent to the browser. */
export interface BelegCheck {
  /** Receipt, complete and readable: fit for the archive. */
  ok: boolean;
  isReceipt: boolean;
  complete: boolean;
  readable: boolean;
  /** Concrete problems in German, e.g. „Der Gesamtbetrag ist abgeschnitten.“ */
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

/** Degrees clockwise a photo must be turned for its text to read upright. */
export type BelegRotation = 0 | 90 | 180 | 270;
const ROTATIONS: readonly BelegRotation[] = [0, 90, 180, 270];

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

const PROMPT = `Du prüfst Fotos von Kassenbelegen (Kassenbons, Quittungen, Rechnungen) für das Belegarchiv eines Pfadfinderstammes. Das Archiv ist revisionssicher: Ein Foto ist nur geeignet, wenn der ganze Inhalt des Belegs zu sehen und alles Wesentliche gut lesbar ist.

Die Fotos sind meist schon auf den Beleg zugeschnitten, oft knapp an der Papierkante oder sogar ein wenig ins leere Papier hinein. Das ist gewollt: Die Papierränder und der leere Rand um den Text müssen nicht zu sehen sein. Das Foto kann auch gedreht sein (seitlich oder auf dem Kopf); das wird automatisch korrigiert und ist kein Mangel.

Beurteile:
- isReceipt: Zeigt das Foto einen Beleg? (Nicht: Produktfoto, Bildschirmfoto einer Bestellung ohne Rechnungsdaten, Person, Landschaft.)
- complete: Ist der ganze Inhalt zu sehen, nur ein Beleg auf dem Foto? Unvollständig ist ein Beleg nur, wenn Inhalt fehlt oder verdeckt ist: angeschnittene Zeichen oder Zeilen am Bildrand, ein fehlender Kopf mit dem Geschäft, fehlende Positionen, ein fehlender Gesamtbetrag oder ein fehlendes Datum. Ein knapper Zuschnitt ohne fehlenden Text ist vollständig.
- readable: Sind Geschäft, Datum, Gesamtbetrag und Positionen scharf und gut lesbar (kein Verwackeln, keine Spiegelung, kein starker Schatten, nicht zu dunkel, nicht stark verzerrt)?
- issues: Konkrete Mängel auf Deutsch, je ein kurzer Satz mit Hinweis zur Abhilfe, z. B. „Der Gesamtbetrag am Ende des Belegs fehlt. Bitte den ganzen Beleg fotografieren.“ Nenne nur, was wirklich fehlt oder unlesbar ist, keine fehlenden Papierränder und nicht die Drehung. Leer, wenn alles passt.
- shop, date (YYYY-MM-DD), amount (Gesamtbetrag in Euro als Zahl): nur, wenn sicher lesbar, sonst null.
- restrictedItems: Positionen, die in der Jugendarbeit nicht abgerechnet werden dürfen, so wie sie auf dem Beleg stehen (z. B. „Augustiner Hell 0,5l“): alkoholische Getränke (Bier, Radler, Wein, Sekt, Spirituosen, Alkopops, alkoholhaltige Mixgetränke), Lebensmittel mit deutlichem Alkoholgehalt (z. B. Weinbrandbohnen, Rumtopf, Eierlikör), Tabakwaren (Zigaretten, Tabak, Zigarren, Shisha-Tabak, E-Zigaretten, Liquids, Nikotinbeutel) und sonstige nicht jugendfreie Artikel (z. B. Medien ab 18, Erotikartikel). Nicht dazu gehören alkoholfreie Varianten („alkoholfrei“, „0,0 %“), Pfand und Kochzutaten wie Essig. Nur aufnehmen, wenn die Position auf dem Beleg eindeutig erkennbar ist; leer, wenn nichts davon zu sehen ist.

Sei streng bei readable und bei fehlendem Inhalt, aber erfinde keine Mängel und keine Positionen.`;

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

function readRotation(value: unknown): BelegRotation {
  return ROTATIONS.find((rotation) => rotation === value) ?? 0;
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

/**
 * Checks of the last photos on this instance, by their bytes. The form checks a new photo as
 * soon as it is chosen and submits exactly these bytes, so submitting reuses that check (or
 * waits for it) instead of asking the model a second time.
 */
const recentChecks = new Map<string, { at: number; check: Promise<BelegCheck | undefined> }>();

/** Forgets the reused checks, e.g. between tests. */
export function forgetBelegChecks(): void {
  recentChecks.clear();
}

/** Checks a JPEG photo; returns undefined if the check is not configured. */
export function checkBelegPhoto(
  jpeg: Uint8Array,
  now = Date.now()
): Promise<BelegCheck | undefined> {
  if (!isBelegCheckConfigured()) return Promise.resolve(undefined);
  for (const [key, entry] of recentChecks) {
    if (now - entry.at < REUSE_MS) break;
    recentChecks.delete(key);
  }
  const key = `${CONFIG.belege.check.deployment}:${createHash('sha256').update(jpeg).digest('hex')}`;
  const known = recentChecks.get(key);
  if (known) return known.check;

  const check = askModel(jpeg);
  const entry = { at: now, check };
  recentChecks.set(key, entry);
  if (recentChecks.size > MAX_REUSED) recentChecks.delete(recentChecks.keys().next().value!);
  // A failed check is asked again next time
  check.catch(() => {
    if (recentChecks.get(key) === entry) recentChecks.delete(key);
  });
  return check;
}

async function askModel(jpeg: Uint8Array): Promise<BelegCheck | undefined> {
  reserveCheck();
  const answer = await requestStructuredOutput(CONFIG.belege.check, {
    schemaName: 'belegpruefung',
    schema: RESPONSE_SCHEMA,
    maxCompletionTokens: MAX_COMPLETION_TOKENS,
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

const ROTATION_PROMPT =
  'Das Foto zeigt einen Kassenbeleg, möglicherweise gedreht. Um wie viel Grad im Uhrzeigersinn muss das Foto gedreht werden, damit der Text aufrecht steht und von links nach rechts gelesen werden kann? 0, 90, 180 oder 270. Achte auf die Leserichtung der Buchstaben, z. B. des Gesamtbetrags.';

const ROTATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rotation'],
  properties: { rotation: { type: 'integer', enum: ROTATIONS } },
};

/** Asking only for the direction is quick; a few seconds even for a long receipt lying sideways. */
const ROTATION_TIMEOUT_MS = 30_000;
const ROTATION_MAX_TOKENS = 2_000;

/**
 * Asks only how the photo must be turned, with little thinking. The form turns the photo upright
 * before the real check, which is quicker and more reliable on an upright receipt. Undefined
 * if the check is not configured.
 */
export async function checkBelegRotation(jpeg: Uint8Array): Promise<BelegRotation | undefined> {
  if (!isBelegCheckConfigured()) return undefined;
  reserveCheck();
  const answer = await requestStructuredOutput(
    { ...CONFIG.belege.check, reasoningEffort: 'low' },
    {
      schemaName: 'belegdrehung',
      schema: ROTATION_SCHEMA,
      maxCompletionTokens: ROTATION_MAX_TOKENS,
      timeoutMs: ROTATION_TIMEOUT_MS,
      messages: [
        { role: 'system', content: ROTATION_PROMPT },
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
    }
  );
  if (answer === null || typeof answer !== 'object') {
    throw new BelegCheckError('Unexpected answer of the model');
  }
  return readRotation((answer as Record<string, unknown>).rotation);
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
