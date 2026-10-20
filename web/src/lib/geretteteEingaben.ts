/**
 * Unsaved input kept across a new login in the same window, for the iPhone app
 * (`reloginOnlyHere()` in api.ts): the login reloads the page, so the values of the filled-in
 * fields are kept in this tab and shown again afterwards (`GeretteteEingaben.svelte`).
 */

export const RESCUE_KEY = 'phoenix:gerettete-eingaben:v1';
const MAX_AGE_MS = 60 * 60 * 1000;

export interface GeretteteEingabe {
  label: string;
  value: string;
}

interface Rettung {
  savedAt: number;
  fields: GeretteteEingabe[];
}

const FIELDS = [
  'input:not([type="hidden"], [type="password"], [type="file"], [type="checkbox"], [type="radio"], [type="search"], [type="submit"], [type="button"])',
  'textarea',
  'select',
  '[contenteditable="true"]',
].join(', ');

function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function labelOf(field: HTMLElement): string {
  const labelledBy = field
    .getAttribute('aria-labelledby')
    ?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent)
    .join(' ');
  const labels =
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement ||
    field instanceof HTMLSelectElement
      ? field.labels?.[0]?.textContent
      : null;
  return (
    clean(field.getAttribute('aria-label')) ||
    clean(labelledBy) ||
    clean(labels) ||
    clean(field.getAttribute('placeholder')) ||
    'Eingabe'
  );
}

function valueOf(field: HTMLElement): string {
  if (field instanceof HTMLSelectElement) return clean(field.selectedOptions[0]?.textContent);
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    return field.value.trim();
  }
  return field.innerText.trim();
}

/** Keeps the filled-in fields of `root`, e.g. the open dialog, for one hour in this tab. */
export function rescueInputs(root: ParentNode): void {
  const fields = [...root.querySelectorAll<HTMLElement>(FIELDS)]
    .map((field) => ({ label: labelOf(field), value: valueOf(field) }))
    .filter((field) => field.value !== '');
  if (fields.length === 0) return;
  const rettung: Rettung = { savedAt: Date.now(), fields };
  try {
    sessionStorage.setItem(RESCUE_KEY, JSON.stringify(rettung));
  } catch {
    /* Storage unavailable: the hint before the login says to copy the input. */
  }
}

function isRettung(value: unknown): value is Rettung {
  if (typeof value !== 'object' || value === null) return false;
  const { savedAt, fields } = value as Record<string, unknown>;
  return (
    typeof savedAt === 'number' &&
    Array.isArray(fields) &&
    fields.every(
      (field: unknown) =>
        typeof field === 'object' &&
        field !== null &&
        typeof (field as Record<string, unknown>).label === 'string' &&
        typeof (field as Record<string, unknown>).value === 'string'
    )
  );
}

/** The kept input, or `null` when there is none or it is older than one hour (then removed). */
export function readRescue(now: number): GeretteteEingabe[] | null {
  try {
    const raw = sessionStorage.getItem(RESCUE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isRettung(parsed) && now - parsed.savedAt <= MAX_AGE_MS) return parsed.fields;
    sessionStorage.removeItem(RESCUE_KEY);
  } catch {
    /* Storage unavailable or damaged: nothing to show. */
  }
  return null;
}

export function forgetRescue(): void {
  try {
    sessionStorage.removeItem(RESCUE_KEY);
  } catch {
    /* Storage unavailable. */
  }
}
