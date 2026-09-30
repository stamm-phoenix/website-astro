import { ValidationError, sanitizeRichTextWithLength } from './pflege-validation';
import { SAMMEL_STATUS } from './sammelbestellung-model';
import type {
  SammelAktion,
  SammelArtikel,
  SammelKatalogArtikel,
  SammelStatus,
} from './sammelbestellung-model';

export interface SammelMessageInput {
  subject: string;
  messageHtml: string;
}

export function validateSammelMessage(body: Record<string, unknown>): SammelMessageInput {
  const subject = text(body.subject, 'subject', 150).replace(/\s+/g, ' ');
  if (typeof body.message !== 'string' || body.message.length > 30_000)
    throw new ValidationError({
      message: 'Bitte schreibe eine Nachricht mit höchstens 5000 Zeichen.',
    });
  const message = sanitizeRichTextWithLength(body.message);
  if (!message.textLength || message.textLength > 5000)
    throw new ValidationError({ message: 'Bitte schreibe eine Nachricht mit 1 bis 5000 Zeichen.' });
  return { subject, messageHtml: message.html };
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError({ form: 'Bitte prüfe die Eingaben.' });
  }
  return value as Record<string, unknown>;
}

export function text(value: unknown, field: string, max: number, optional = false): string {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || value.trim().length > max || (!optional && !value.trim())) {
    throw new ValidationError({
      [field]: `Bitte gib einen Text mit höchstens ${max} Zeichen ein.`,
    });
  }
  return value.trim();
}

export function email(value: unknown): string {
  const result = text(value, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) {
    throw new ValidationError({ email: 'Bitte gib eine gültige E-Mail-Adresse ein.' });
  }
  return result;
}

/** Only shop links or plain article numbers are accepted, never executable URLs. */
export function reference(value: unknown): string {
  const result = text(value, 'reference', 500);
  if (/^[a-z\d._-]{1,80}$/i.test(result)) return result;
  try {
    const url = new URL(result);
    if (
      url.protocol === 'https:' &&
      ['ruesthaus.de', 'www.ruesthaus.de'].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port
    )
      return url.href;
  } catch {
    /* Report the field error below. */
  }
  throw new ValidationError({
    reference: 'Bitte gib eine Artikelnummer oder einen HTTPS-Link zu ruesthaus.de ein.',
  });
}

export function validateSammelItems(value: unknown): SammelArtikel[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 40) {
    throw new ValidationError({ items: 'Bitte gib 1 bis 40 Artikel an.' });
  }
  return value.map((raw) => {
    const row = object(raw);
    if (!Number.isInteger(row.quantity) || Number(row.quantity) < 1 || Number(row.quantity) > 99) {
      throw new ValidationError({ quantity: 'Die Anzahl muss zwischen 1 und 99 liegen.' });
    }
    return {
      name: text(row.name, 'name', 200),
      reference: reference(row.reference),
      variant: text(row.variant, 'variant', 120, true),
      quantity: Number(row.quantity),
    };
  });
}

export function validateSammelCatalog(value: unknown): SammelKatalogArtikel[] {
  if (!Array.isArray(value) || value.length > 30) {
    throw new ValidationError({ catalog: 'Bitte wähle höchstens 30 häufige Artikel aus.' });
  }
  const result = value.map((raw) => {
    const row = object(raw);
    if (!Array.isArray(row.variants) || row.variants.length > 40) {
      throw new ValidationError({ variants: 'Bitte prüfe die Größen und Varianten.' });
    }
    return {
      name: text(row.name, 'name', 200),
      reference: reference(row.reference),
      variants: row.variants.map((v) => text(v, 'variants', 120)),
    };
  });
  if (JSON.stringify(result).length > 60_000) {
    throw new ValidationError({
      catalog: 'Die Artikelauswahl ist zu umfangreich. Bitte kürze die Größen oder Beschreibungen.',
    });
  }
  return result;
}

export function validateSammelCampaign(
  body: Record<string, unknown>
): Omit<SammelAktion, 'id' | 'etag'> {
  const startsAt = text(body.startsAt, 'startsAt', 30);
  const endsAt = text(body.endsAt, 'endsAt', 30);
  for (const [field, value] of [
    ['startsAt', startsAt],
    ['endsAt', endsAt],
  ]) {
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value
    ) {
      throw new ValidationError({ [field]: 'Bitte gib einen gültigen Zeitpunkt ein.' });
    }
  }
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new ValidationError({ endsAt: 'Das Ende muss nach dem Beginn liegen.' });
  }
  return {
    title: text(body.title, 'title', 200),
    description: text(body.description, 'description', 2000, true),
    startsAt,
    endsAt,
    catalog: validateSammelCatalog(body.catalog),
  };
}

export function validateSammelStatus(body: Record<string, unknown>): {
  status: SammelStatus;
  paid: boolean;
  delivered: boolean;
  totalCents: number | null;
} {
  if (!SAMMEL_STATUS.includes(body.status as SammelStatus)) {
    throw new ValidationError({ status: 'Bitte wähle einen gültigen Status.' });
  }
  if (typeof body.paid !== 'boolean' || typeof body.delivered !== 'boolean') {
    throw new ValidationError({ form: 'Bitte prüfe Bezahlstatus und Auslieferung.' });
  }
  if (
    body.totalCents !== null &&
    (!Number.isSafeInteger(body.totalCents) ||
      Number(body.totalCents) < 0 ||
      Number(body.totalCents) > 10_000_000)
  ) {
    throw new ValidationError({ totalCents: 'Bitte gib einen gültigen Betrag an.' });
  }
  if (body.delivered && body.status !== 'Eingetroffen') {
    throw new ValidationError({
      delivered: 'Nur eingetroffene Bestellungen können ausgeliefert werden.',
    });
  }
  return {
    status: body.status as SammelStatus,
    paid: body.paid,
    delivered: body.delivered,
    totalCents: body.totalCents as number | null,
  };
}
