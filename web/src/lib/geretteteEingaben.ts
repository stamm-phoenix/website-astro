/**
 * Unsaved input of an edit dialog kept across a new login in the same window, for the iPhone
 * app (`reloginOnlyHere()` in api.ts): the login reloads the page, so `EditDialog` keeps its
 * fields in this tab and fills them in again when the same dialog opens on the same page.
 */
import { getContext, setContext } from 'svelte';
import type { TextEditorFormat } from './textEditor';

export const RESCUE_KEY = 'phoenix:gerettete-eingaben:v1';
/** Fired on `window` when the kept input was taken or deleted. */
export const RESCUE_EVENT = 'phoenix:gerettete-eingaben';
const MAX_AGE_MS = 60 * 60 * 1000;

/** One field: its label (with a counter for equal labels) and what it held. */
export interface GeretteterWert {
  key: string;
  kind: 'value' | 'checked' | 'editor' | 'custom';
  value: string;
  /** Readable representation of a compound value, without its serialized storage syntax. */
  display?: string;
  /** Editor storage format; native form values always remain plain text. */
  format?: TextEditorFormat;
}

interface Rettung {
  savedAt: number;
  path: string;
  /** The record being edited, from `EditDialog`'s `rescueKey`, e.g. `frage:12`. */
  record: string;
  /** The dialog title when it opened, to name the form in the hint. */
  dialog: string;
  /** The field values when the dialog opened: tells records with the same dialog title apart. */
  opening: string;
  fields: GeretteterWert[];
  dependencies?: RescueDependency[];
}

/** An additional record chosen after opening, such as an adopted calendar entry. */
export interface RescueDependency {
  key: string;
  version: string;
}

/** A compound field that native form elements cannot represent, or a list's row count. */
export interface RescueField {
  key: string;
  get: () => string;
  describe: (value: string) => string;
  set: (value: string) => boolean;
  structure?: boolean;
}

/** Applies list structure before field values; unknown/invalid compound values remain visible. */
export function fillRescueFields(
  values: readonly GeretteterWert[],
  fields: readonly RescueField[],
  structure = false
): GeretteterWert[] {
  return values.filter((kept) => {
    if (kept.kind !== 'custom') return true;
    const field = fields.find((entry) => entry.key === kept.key && !!entry.structure === structure);
    return !field || !field.set(kept.value);
  });
}

/** A formatting editor inside the dialog, which keeps its text outside the form elements. */
export interface RescueEditor {
  format: () => TextEditorFormat;
  label: () => string;
  get: () => string;
  set: (value: string) => void;
}

/** What `EditDialog` offers its content: the login link keeps the input, editors join in. */
export interface RescueContext {
  /** Input outside the saved fields that must be chosen again after the page reload. */
  warning: () => string | null;
  /** Whether this dialog keeps its input: only with a `rescueKey` that names the record. */
  enabled: () => boolean;
  /** Keeps the dialog's input; false if the browser could not store it. */
  rescue: () => boolean;
  /** Adds an editor; returns the function that removes it again. */
  register: (editor: RescueEditor) => () => void;
}

const CONTEXT = Symbol('gerettete-eingaben');

export function setRescueContext(context: RescueContext): void {
  setContext(CONTEXT, context);
}

/** The surrounding edit dialog, or undefined outside one. */
export function getRescueContext(): RescueContext | undefined {
  return getContext<RescueContext | undefined>(CONTEXT);
}

function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** The visible name of a field, as a person reads it next to the field. */
export function fieldLabel(field: Element): string {
  const labelledBy = field
    .getAttribute('aria-labelledby')
    ?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent)
    .join(' ');
  const label =
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement ||
    field instanceof HTMLSelectElement
      ? field.labels?.[0]?.textContent
      : null;
  return (
    clean(field.getAttribute('aria-label')) ||
    clean(labelledBy) ||
    clean(label) ||
    clean(field.getAttribute('name'))
  );
}

type FormField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function isFormField(element: Element): element is FormField {
  if (element instanceof HTMLInputElement) {
    return !['hidden', 'password', 'file', 'submit', 'button', 'reset'].includes(element.type);
  }
  return element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement;
}

/** Each field of `form` with a key that stays the same when the dialog is rendered again. */
function keyedFields(form: HTMLFormElement): { key: string; field: FormField }[] {
  const seen = new Map<string, number>();
  const result: { key: string; field: FormField }[] = [];
  for (const element of form.elements) {
    if (!isFormField(element)) continue;
    const label = fieldLabel(element);
    if (!label) continue;
    const count = seen.get(label) ?? 0;
    seen.set(label, count + 1);
    result.push({ key: `${label}#${count}`, field: element });
  }
  return result;
}

function editorKey(editor: RescueEditor): string {
  return `${editor.label()}#editor`;
}

function readValue(field: FormField): GeretteterWert['value'] {
  if (field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio')) {
    return String(field.checked);
  }
  if (field instanceof HTMLSelectElement) {
    return Array.from(field.selectedOptions, (option) => option.value).join('\n');
  }
  return field.value;
}

/**
 * Keeps the fields of `form` and the text of `editors` for one hour in this tab. Returns false
 * if the browser could not store them, so the caller can keep the page instead of losing them.
 */
export function rescueDialog(
  form: HTMLFormElement,
  record: string,
  dialog: string,
  opening: string,
  editors: readonly RescueEditor[],
  notPlaced: readonly GeretteterWert[] = [],
  custom: readonly RescueField[] = [],
  dependencies: readonly RescueDependency[] = []
): boolean {
  const fields: GeretteterWert[] = [
    ...keyedFields(form).map(({ key, field }) => ({
      key,
      kind:
        field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio')
          ? ('checked' as const)
          : ('value' as const),
      value: readValue(field),
    })),
    ...editors.map((editor) => ({
      key: editorKey(editor),
      kind: 'editor' as const,
      value: editor.get(),
      format: editor.format(),
    })),
    ...custom.map((field) => {
      const value = field.get();
      return { key: field.key, kind: 'custom' as const, value, display: field.describe(value) };
    }),
  ];
  // A field may exist while its selected option is still loading. Until it was placed
  // (or the person explicitly changed the field), its kept value remains authoritative.
  const waiting = new Map(notPlaced.map((kept) => [kept.key, kept]));
  for (let index = 0; index < fields.length; index++) {
    const kept = waiting.get(fields[index].key);
    if (kept) {
      fields[index] = kept;
      waiting.delete(kept.key);
    }
  }
  fields.push(...waiting.values());
  const rettung: Rettung = {
    savedAt: Date.now(),
    path: `${location.pathname}${location.search}`,
    record,
    dialog,
    opening,
    fields,
    dependencies: [...dependencies],
  };
  try {
    sessionStorage.setItem(RESCUE_KEY, JSON.stringify(rettung));
    return true;
  } catch {
    return false;
  }
}

function isRettung(value: unknown): value is Rettung {
  if (typeof value !== 'object' || value === null) return false;
  const { savedAt, path, record, dialog, opening, fields, dependencies } = value as Record<
    string,
    unknown
  >;
  return (
    typeof savedAt === 'number' &&
    typeof path === 'string' &&
    typeof record === 'string' &&
    typeof dialog === 'string' &&
    typeof opening === 'string' &&
    (dependencies === undefined ||
      (Array.isArray(dependencies) &&
        dependencies.every((entry: unknown) => {
          if (typeof entry !== 'object' || entry === null) return false;
          const { key, version } = entry as Record<string, unknown>;
          return typeof key === 'string' && typeof version === 'string';
        }))) &&
    Array.isArray(fields) &&
    fields.every((field: unknown) => {
      if (typeof field !== 'object' || field === null) return false;
      const { key, kind, value: kept, format, display } = field as Record<string, unknown>;
      return (
        typeof key === 'string' &&
        (kind === 'value' || kind === 'checked' || kind === 'editor' || kind === 'custom') &&
        typeof kept === 'string' &&
        (display === undefined || typeof display === 'string') &&
        (format === undefined || format === 'html' || format === 'markdown')
      );
    })
  );
}

function read(now: number): Rettung | null {
  try {
    const raw = sessionStorage.getItem(RESCUE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isRettung(parsed) && now - parsed.savedAt <= MAX_AGE_MS) return parsed;
    sessionStorage.removeItem(RESCUE_KEY);
  } catch {
    /* Storage unavailable or damaged: nothing kept. */
  }
  return null;
}

/** Title of the dialog whose input is kept for this page, for the hint above the content. */
export function rescuedDialog(now: number): string | null {
  const rettung = read(now);
  return rettung && rettung.path === `${location.pathname}${location.search}`
    ? rettung.dialog
    : null;
}

/**
 * The kept input of `record` on this page. The values when the dialog opened must match too,
 * so input never lands on a record someone changed in between. It stays kept until
 * `forgetRescue()`, so input without a field to go into is not lost.
 * With a null opening, read it only for showing a conflicting draft, never to fill fields.
 */
export function findRescue(
  record: string,
  opening: string | null,
  now: number,
  dependencyVersion: (key: string) => string | undefined = () => undefined
): GeretteterWert[] | null {
  const rettung = read(now);
  if (!rettung || rettung.record !== record) return null;
  if (opening !== null && rettung.opening !== opening) return null;
  if (
    opening !== null &&
    rettung.dependencies?.some((entry) => dependencyVersion(entry.key) !== entry.version)
  )
    return null;
  if (rettung.path !== `${location.pathname}${location.search}`) return null;
  return rettung.fields;
}

/** A deliberate edit replaces a waiting value even if its original option never arrived. */
export function withoutEditedField(
  form: HTMLFormElement,
  values: readonly GeretteterWert[],
  target: EventTarget | null
): GeretteterWert[] {
  const key = keyedFields(form).find((entry) => entry.field === target)?.key;
  return values.filter((kept) => kept.key !== key);
}

/** Kept values worth showing: not empty and not an unticked box. */
export function shownValues(values: readonly GeretteterWert[]): GeretteterWert[] {
  return values.filter((kept) => (kept.display ?? kept.value) !== '' && kept.value !== 'false');
}

/** The field name of a kept value, without the counter of its key. */
export function rescuedLabel(kept: GeretteterWert): string {
  return kept.key.replace(/#(\d+|editor|custom)$/, '');
}

/** Removes the kept input; with `record`, only if it belongs to that record. */
export function forgetRescue(record?: string): void {
  if (record !== undefined && read(Date.now())?.record !== record) return;
  try {
    sessionStorage.removeItem(RESCUE_KEY);
  } catch {
    /* Storage unavailable. */
  }
  window.dispatchEvent(new Event(RESCUE_EVENT));
}

/**
 * Fills the kept values into the fields of `form`; returns those it could not place yet, e.g.
 * a field shown only after a choice above it, or an editor that is still loading.
 */
export function fillDialog(
  form: HTMLFormElement,
  editors: readonly RescueEditor[],
  values: readonly GeretteterWert[],
  only: 'choices' | 'all' = 'all'
): GeretteterWert[] {
  const fields = new Map(keyedFields(form).map(({ key, field }) => [key, field]));
  const editorsByKey = new Map(editors.map((editor) => [editorKey(editor), editor]));
  const rest: GeretteterWert[] = [];
  for (const kept of values) {
    if (kept.kind === 'custom') {
      rest.push(kept);
      continue;
    }
    if (kept.kind === 'editor') {
      const editor = only === 'all' ? editorsByKey.get(kept.key) : undefined;
      if (editor) editor.set(kept.value);
      else rest.push(kept);
      continue;
    }
    const field = fields.get(kept.key);
    if (!field) {
      rest.push(kept);
      continue;
    }
    // A choice may change other fields in its handler, e.g. the Stufen of an adopted entry
    const choice =
      field instanceof HTMLSelectElement ||
      (field instanceof HTMLInputElement && field.type === 'radio');
    if (only === 'choices' && !choice) {
      rest.push(kept);
      continue;
    }
    if (kept.kind === 'checked' && field instanceof HTMLInputElement) {
      const checked = kept.value === 'true';
      if (field.checked === checked || (field.type === 'radio' && !checked)) continue;
      field.checked = checked;
      field.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (field instanceof HTMLSelectElement) {
      const chosen = kept.value === '' ? [] : kept.value.split('\n');
      const options = Array.from(field.options, (option) => option.value);
      // Options still loading: wait for them instead of clearing the choice
      if (!chosen.every((value) => options.includes(value))) {
        rest.push(kept);
        continue;
      }
      if (readValue(field) === kept.value) continue;
      for (const option of field.options) option.selected = chosen.includes(option.value);
      field.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (field.value !== kept.value) {
      field.value = kept.value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  return rest;
}
