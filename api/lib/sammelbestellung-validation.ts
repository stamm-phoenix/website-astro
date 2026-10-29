import { z } from 'zod';
import { getSammelStammProdukt, SAMMEL_MAX_KATALOG_ARTIKEL } from './sammelbestellung-stamm';
import { getSammelShop, sammelShopUrl } from './sammelbestellung-shops';
import type { SammelShop } from './sammelbestellung-shops';
import { sanitizeRichTextWithLength } from './validation/rich-text';
import { SAMMEL_STATUS } from './sammelbestellung-model';
import type {
  SammelAktion,
  SammelArtikel,
  SammelKatalogArtikel,
  SammelStatus,
} from './sammelbestellung-model';
import { isRecord, parseWith } from './validation/zod';
import type { FieldOf } from './validation/zod';

export interface SammelMessageInput {
  subject: string;
  messageHtml: string;
}

const FORM_MESSAGE = 'Bitte prüfe die Eingaben.';
const STAMM_MESSAGE = 'Bitte wähle einen Stammesartikel aus dem Katalog.';
const QUANTITY_MESSAGE = 'Die Anzahl muss zwischen 1 und 99 liegen.';

/** Trimmed text of 1 to `max` characters; optional text may be missing or empty. */
function textSchema(max: number, optional = false) {
  const error = `Bitte gib einen Text mit höchstens ${max} Zeichen ein.`;
  return z.preprocess(
    (value) => (optional && value === undefined ? '' : value),
    z
      .string({ error })
      .trim()
      .min(optional ? 0 : 1, { error })
      .max(max, { error })
  );
}

/** Reports `message` from inside a transform, below `path`. */
function invalid(context: z.core.$RefinementCtx, message: string, path: PropertyKey[] = []): never {
  context.issues.push({ code: 'custom', message, path, input: undefined });
  return z.NEVER;
}

/** Reads a detail of a row inside a transform; a fault is reported below `path`. */
function read<S extends z.ZodType>(
  schema: S,
  value: unknown,
  context: z.core.$RefinementCtx,
  path: PropertyKey[]
): z.output<S> {
  const result = schema.safeParse(value);
  return result.success ? result.data : invalid(context, result.error.issues[0].message, path);
}

/** Requires a non-array object before reading submitted fields. */
export function object(value: unknown): Record<string, unknown> {
  const schema = z.custom<Record<string, unknown>>(isRecord, { error: FORM_MESSAGE });
  return parseWith(schema, value, () => 'form');
}

/** Trims and bounds required or optional text, reporting a field validation error. */
export function text(value: unknown, field: string, max: number, optional = false): string {
  return parseWith(z.object({ [field]: textSchema(max, optional) }), { [field]: value })[field];
}

const emailSchema = textSchema(254)
  .transform((value) => value.toLowerCase())
  .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
    error: 'Bitte gib eine gültige E-Mail-Adresse ein.',
  });

/** Normalizes an email address for per-campaign order identity and validates its syntax. */
export function email(value: unknown): string {
  return parseWith(z.object({ email: emailSchema }), { email: value }).email;
}

const referenceSchema = textSchema(500).transform((value, context) => {
  if (value.toLowerCase().startsWith('stamm-') && !getSammelStammProdukt(value))
    return invalid(context, STAMM_MESSAGE);
  if (/^[a-z\d._-]{1,80}$/i.test(value)) return value;
  try {
    return sammelShopUrl(value).href;
  } catch {
    return invalid(
      context,
      'Bitte gib eine Artikelnummer oder einen HTTPS-Link zu Rüsthaus oder Ausrüster Eschwege ein.'
    );
  }
});

/** Only shop links or plain article numbers are accepted, never executable URLs. */
export function reference(value: unknown): string {
  return parseWith(z.object({ reference: referenceSchema }), { reference: value }).reference;
}

const shopSchema = z
  .enum(['ruesthaus', 'eschwege', 'stamm'], {
    error: 'Bitte wähle Rüsthaus oder Ausrüster Eschwege.',
  })
  .optional();

/** The supplier of a row, inferred from its reference; old Ruesthaus rows keep their shape. */
function shopOf(row: { shop?: SammelShop; reference: string }): { shop?: SammelShop } {
  const shop = getSammelShop(row.reference, row.shop);
  return shop !== 'ruesthaus' ? { shop } : {};
}

/**
 * The field of an issue in a row of the order or the catalog: the key in the row, the variants
 * of an article, or the reason of an exclusion; the row itself and `excluded` are the form.
 */
const rowField: FieldOf = ([, key, detail]) => {
  if (key === 'excluded') return typeof detail === 'string' ? detail : 'form';
  return typeof key === 'string' ? key : 'form';
};

const itemSchema = z
  .object(
    {
      quantity: z
        .number({ error: QUANTITY_MESSAGE })
        .refine(Number.isInteger, { error: QUANTITY_MESSAGE })
        .min(1, { error: QUANTITY_MESSAGE })
        .max(99, { error: QUANTITY_MESSAGE }),
      shop: shopSchema,
      reference: referenceSchema,
      excluded: z.object({ reason: textSchema(1000, true) }, { error: FORM_MESSAGE }).optional(),
      name: z.unknown().optional(),
      variant: z.unknown().optional(),
    },
    { error: FORM_MESSAGE }
  )
  .transform((row, context): SammelArtikel => {
    const stock = getSammelStammProdukt(row.reference);
    if (row.shop === 'stamm' && !stock) return invalid(context, STAMM_MESSAGE, ['reference']);
    // A stock article brings its own name and has no variants
    return {
      ...shopOf(row),
      ...(row.excluded ? { excluded: { reason: row.excluded.reason } } : {}),
      name: stock?.name ?? read(textSchema(200), row.name, context, ['name']),
      reference: row.reference,
      variant: stock ? '' : read(textSchema(120, true), row.variant, context, ['variant']),
      quantity: row.quantity,
    };
  });

const ITEMS_MESSAGE = 'Bitte gib 1 bis 40 Artikel an.';
const itemsSchema = z
  .array(itemSchema, { error: ITEMS_MESSAGE })
  .min(1, { error: ITEMS_MESSAGE })
  .max(40, { error: ITEMS_MESSAGE });

/** Validates 1 to 40 article rows, allowed references and integral quantities. */
export function validateSammelItems(value: unknown): SammelArtikel[] {
  return parseWith(itemsSchema, value, (path) => (path.length === 0 ? 'items' : rowField(path)));
}

const VARIANTS_MESSAGE = 'Bitte prüfe die Größen und Varianten.';
const CATALOG_MESSAGE = `Bitte wähle höchstens ${SAMMEL_MAX_KATALOG_ARTIKEL} häufige Artikel aus.`;

const catalogArticleSchema = z
  .object(
    {
      reference: referenceSchema,
      shop: shopSchema,
      name: z.unknown().optional(),
      variants: z
        .array(z.unknown(), { error: VARIANTS_MESSAGE })
        .max(40, { error: VARIANTS_MESSAGE }),
    },
    { error: FORM_MESSAGE }
  )
  .transform((row, context): SammelKatalogArtikel => {
    const stock = getSammelStammProdukt(row.reference);
    if (row.shop === 'stamm' && !stock) return invalid(context, STAMM_MESSAGE, ['reference']);
    return {
      name: stock?.name ?? read(textSchema(200), row.name, context, ['name']),
      reference: row.reference,
      variants: stock
        ? []
        : row.variants.map((variant) => read(textSchema(120), variant, context, ['variants'])),
      ...shopOf(row),
    };
  });

const catalogSchema = z
  .array(catalogArticleSchema, { error: CATALOG_MESSAGE })
  .max(SAMMEL_MAX_KATALOG_ARTIKEL, { error: CATALOG_MESSAGE })
  .refine((catalog) => JSON.stringify(catalog).length <= 60_000, {
    error: 'Die Artikelauswahl ist zu umfangreich. Bitte kürze die Größen oder Beschreibungen.',
  });

/** Validates catalog variants and bounds the total size, so the order form stays manageable. */
export function validateSammelCatalog(value: unknown): SammelKatalogArtikel[] {
  return parseWith(catalogSchema, value, (path) =>
    path.length === 0 ? 'catalog' : rowField(path)
  );
}

/** Rules across fields apply only once every field is valid; zod skips them after aborting faults only. */
const whenValid = (payload: { issues: unknown[] }): boolean => payload.issues.length === 0;

/** UTC timestamp as `new Date().toISOString()` writes it. */
const instantSchema = textSchema(30).refine(
  (value) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value,
  { error: 'Bitte gib einen gültigen Zeitpunkt ein.' }
);

const campaignSchema = z
  .object({
    startsAt: instantSchema,
    endsAt: instantSchema,
    title: textSchema(200),
    description: textSchema(2000, true),
  })
  .refine((campaign) => Date.parse(campaign.endsAt) > Date.parse(campaign.startsAt), {
    error: 'Das Ende muss nach dem Beginn liegen.',
    path: ['endsAt'],
    when: whenValid,
  });

/** Validates UTC timestamps, their ordering and the initial campaign catalog. */
export function validateSammelCampaign(
  body: Record<string, unknown>
): Omit<SammelAktion, 'id' | 'etag'> {
  const { title, description, startsAt, endsAt } = parseWith(campaignSchema, body);
  return {
    title,
    description,
    startsAt,
    endsAt,
    catalog: validateSammelCatalog(body.catalog),
    archived: false,
  };
}

const messageSchema = z.object({
  subject: textSchema(150).transform((subject) => subject.replace(/\s+/g, ' ')),
  message: z
    .string({ error: 'Bitte schreibe eine Nachricht mit höchstens 5000 Zeichen.' })
    .max(30_000, { error: 'Bitte schreibe eine Nachricht mit höchstens 5000 Zeichen.' })
    .transform((message, context) => {
      const sanitized = sanitizeRichTextWithLength(message);
      if (!sanitized.textLength || sanitized.textLength > 5000)
        return invalid(context, 'Bitte schreibe eine Nachricht mit 1 bis 5000 Zeichen.');
      return sanitized.html;
    }),
});

/** Bounds the subject and visible message length, then removes unsupported HTML. */
export function validateSammelMessage(body: Record<string, unknown>): SammelMessageInput {
  const { subject, message } = parseWith(messageSchema, body);
  return { subject, messageHtml: message };
}

const PAID_MESSAGE = 'Bitte prüfe Bezahlstatus und Auslieferung.';
const TOTAL_MESSAGE = 'Bitte gib einen gültigen Betrag an.';

const statusSchema = z
  .object({
    status: z.enum(SAMMEL_STATUS, { error: 'Bitte wähle einen gültigen Status.' }),
    paid: z.boolean({ error: PAID_MESSAGE }),
    delivered: z.boolean({ error: PAID_MESSAGE }),
    totalCents: z
      .number({ error: TOTAL_MESSAGE })
      .refine(Number.isSafeInteger, { error: TOTAL_MESSAGE })
      .min(0, { error: TOTAL_MESSAGE })
      .max(10_000_000, { error: TOTAL_MESSAGE })
      .nullable(),
  })
  .refine((order) => !order.delivered || order.status === 'Eingetroffen', {
    error: 'Nur eingetroffene Bestellungen können ausgeliefert werden.',
    path: ['deliveredStatus'],
    when: whenValid,
  });

/** The fields of the status: a fault of paid or delivered shows at the form, the rule at delivered. */
const statusField: FieldOf = ([first]) => {
  if (first === 'paid' || first === 'delivered') return 'form';
  return first === 'deliveredStatus' ? 'delivered' : typeof first === 'string' ? first : 'form';
};

/** Validates staff-only payment, price and delivery changes against the processing status. */
export function validateSammelStatus(body: Record<string, unknown>): {
  status: SammelStatus;
  paid: boolean;
  delivered: boolean;
  totalCents: number | null;
} {
  return parseWith(statusSchema, body, statusField);
}
