import { getCredential } from './token';

/**
 * Preliminary check of receipt photos with an image model on Azure OpenAI: is it a receipt,
 * is it fully visible and readable enough for the archive? Also reads shop, date and amount
 * to prefill the form. The result is only a hint; the Kassenteam decides.
 *
 * Optional: without `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_DEPLOYMENT` the check is skipped.
 * With `AZURE_OPENAI_API_KEY` the key is used, otherwise the app registration (Entra ID).
 * `AZURE_OPENAI_MAX_CHECKS_PER_DAY` (default 100) caps the checks per day and Functions
 * instance as a safety net against runaway costs; the hard limit is the deployment's quota.
 */

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ISSUES = 8;
const MAX_ISSUE_LENGTH = 200;
const DEFAULT_MAX_CHECKS_PER_DAY = 100;

/** Result of the check as stored with the receipt and sent to the browser. */
export interface BelegCheck {
  /** Receipt, fully visible and readable: fit for the archive. */
  ok: boolean;
  isReceipt: boolean;
  complete: boolean;
  readable: boolean;
  /** Concrete problems in German, e.g. „Der obere Rand ist abgeschnitten.“ */
  issues: string[];
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

interface BelegCheckConfig {
  endpoint: string;
  deployment: string;
  apiKey?: string;
}

function getConfig(): BelegCheckConfig | undefined {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim().replace(/\/+$/, '');
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT?.trim();
  if (!endpoint || !deployment) return undefined;
  return { endpoint, deployment, apiKey: process.env.AZURE_OPENAI_API_KEY?.trim() || undefined };
}

export function isBelegCheckConfigured(): boolean {
  return getConfig() !== undefined;
}

function maxChecksPerDay(): number {
  const raw = process.env.AZURE_OPENAI_MAX_CHECKS_PER_DAY?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_MAX_CHECKS_PER_DAY;
}

/** Checks of the current day on this instance. */
const usage = { day: '', count: 0 };

/** Counts a check against the daily limit; throws once the limit is reached. */
export function reserveCheck(now = new Date()): void {
  const day = now.toISOString().slice(0, 10);
  if (usage.day !== day) {
    usage.day = day;
    usage.count = 0;
  }
  if (usage.count >= maxChecksPerDay()) throw new BelegCheckLimitError();
  usage.count++;
}

const PROMPT = `Du prüfst Fotos von Kassenbelegen (Kassenbons, Quittungen, Rechnungen) für das Belegarchiv eines Pfadfinderstammes. Das Archiv ist revisionssicher: Ein Foto ist nur geeignet, wenn der ganze Beleg zu sehen und alles Wesentliche gut lesbar ist.

Beurteile:
- isReceipt: Zeigt das Foto einen Beleg? (Nicht: Produktfoto, Bildschirmfoto einer Bestellung ohne Rechnungsdaten, Person, Landschaft.)
- complete: Sind alle Ränder des Belegs zu sehen, nichts abgeschnitten oder verdeckt, nur ein Beleg auf dem Foto?
- readable: Sind Geschäft, Datum, Gesamtbetrag und Positionen scharf und gut lesbar (kein Verwackeln, keine Spiegelung, kein starker Schatten, nicht zu dunkel, nicht stark verzerrt)?
- issues: Konkrete Mängel auf Deutsch, je ein kurzer Satz mit Hinweis zur Abhilfe, z. B. „Der untere Rand mit dem Gesamtbetrag ist abgeschnitten.“ Leer, wenn alles passt.
- shop, date (YYYY-MM-DD), amount (Gesamtbetrag in Euro als Zahl): nur, wenn sicher lesbar, sonst null.

Sei streng bei complete und readable, aber erfinde keine Mängel.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isReceipt', 'complete', 'readable', 'issues', 'shop', 'date', 'amount'],
  properties: {
    isReceipt: { type: 'boolean' },
    complete: { type: 'boolean' },
    readable: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
    shop: { type: ['string', 'null'] },
    date: { type: ['string', 'null'] },
    amount: { type: ['number', 'null'] },
  },
};

async function authHeaders(config: BelegCheckConfig): Promise<Record<string, string>> {
  if (config.apiKey) return { 'api-key': config.apiKey };
  const token = await getCredential().getToken('https://cognitiveservices.azure.com/.default');
  if (!token) throw new BelegCheckError('Failed to acquire Azure OpenAI access token');
  return { Authorization: `Bearer ${token.token}` };
}

function readText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, max) : null;
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
  const issues = (Array.isArray(answer.issues) ? answer.issues : [])
    .map((issue) => readText(issue, MAX_ISSUE_LENGTH))
    .filter((issue): issue is string => issue !== null)
    .slice(0, MAX_ISSUES);

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
    shop: readText(answer.shop, 100),
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    amountCent,
    checkedAt: now.toISOString(),
  };
}

/** Checks a JPEG photo; returns undefined if the check is not configured. */
export async function checkBelegPhoto(jpeg: Uint8Array): Promise<BelegCheck | undefined> {
  const config = getConfig();
  if (!config) return undefined;
  reserveCheck();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.endpoint}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders(config)) },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.deployment,
        temperature: 0,
        max_completion_tokens: 600,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'belegpruefung', strict: true, schema: RESPONSE_SCHEMA },
        },
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
      }),
    });
    // 429: the quota of the deployment is used up
    if (!response.ok) {
      throw new BelegCheckError(
        `Azure OpenAI request failed: ${response.status} ${response.statusText}`
      );
    }
    const body = (await response.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new BelegCheckError('Empty answer of the model');
    return toBelegCheck(JSON.parse(content));
  } finally {
    clearTimeout(timeout);
  }
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
      shop: typeof parsed.shop === 'string' ? parsed.shop : null,
      date: typeof parsed.date === 'string' ? parsed.date : null,
      amountCent: typeof parsed.amountCent === 'number' ? parsed.amountCent : null,
      checkedAt: typeof parsed.checkedAt === 'string' ? parsed.checkedAt : '',
    };
  } catch {
    return null;
  }
}
