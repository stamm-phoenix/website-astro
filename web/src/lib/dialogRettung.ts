/**
 * How `EditDialog` keeps and fills in the input of one opened dialog across a new login in the
 * iPhone app: what identifies the opened record, the order in which kept values go back into the
 * form, and the notice about it. The storage itself is in `geretteteEingaben.ts`.
 */
import {
  fillDialog,
  fillRescueFields,
  findRescue,
  rescueDialog,
  rescuedLabel,
  shownValues,
  type GeretteterWert,
  type RescueDependency,
  type RescueEditor,
  type RescueField,
} from './geretteteEingaben';

/** The record of an opened dialog and what it looked like when it opened. */
export interface Eroeffnung {
  /** `EditDialog`'s `rescueKey` when it opened; undefined keeps nothing. */
  record: string | undefined;
  /** The dialog title when it opened, to name the form in the hint even after a rename. */
  title: string;
  version: string;
  /** Visible starting values, compared only for a record without a version. */
  values: string[];
  /** What a kept input must match to be filled in again. */
  signature: string;
}

/**
 * A persisted record's version identifies its original data. Displayed defaults can depend on
 * separately loaded prices or names and must not create false conflicts. New records have no
 * version, so their visible starting fields are compared instead.
 */
function signatureOf(version: string, values: readonly string[]): string {
  return JSON.stringify([version, version ? [] : values]);
}

export function openedDialog(
  record: string | undefined,
  title: string,
  version: string,
  values: readonly string[]
): Eroeffnung {
  return { record, title, version, values: [...values], signature: signatureOf(version, values) };
}

/** A confirmed partial write (a photo) advances only the version, never unsaved fields. */
export function acceptVersion(opening: Eroeffnung, previous: string, saved: string): Eroeffnung {
  if (opening.version !== previous) return opening;
  return { ...opening, version: saved, signature: signatureOf(saved, opening.values) };
}

/** Keeps the dialog's input under its opening; false if nothing could be stored. */
export function keepDialogInput(
  form: HTMLFormElement,
  opening: Eroeffnung,
  editors: readonly RescueEditor[],
  pending: readonly GeretteterWert[],
  fields: readonly RescueField[],
  dependencies: readonly RescueDependency[]
): boolean {
  if (opening.record === undefined) return false;
  return rescueDialog(
    form,
    opening.record,
    opening.title,
    opening.signature,
    editors,
    pending,
    fields,
    dependencies
  );
}

/**
 * The kept input for an opened dialog. It is filled in only if the record is unchanged
 * (`conflict: false`); input kept for a version someone changed since is only shown.
 */
export function keptOnOpening(
  opening: Eroeffnung,
  now: number,
  dependencyVersion?: (key: string) => string | undefined
): { values: GeretteterWert[]; conflict: boolean } | null {
  if (opening.record === undefined) return null;
  const kept = findRescue(opening.record, opening.signature, now, dependencyVersion);
  if (kept) return { values: kept, conflict: false };
  const conflicting = findRescue(opening.record, null, now);
  return conflicting ? { values: conflicting, conflict: true } : null;
}

/**
 * Fills kept values into the form and returns those still without a field. Rows come first,
 * then compound values, then choices (their handlers may change other fields), then the rest,
 * and once more for fields that appear only after a choice above them.
 */
export async function restoreKept(
  form: HTMLFormElement,
  editors: readonly RescueEditor[],
  kept: readonly GeretteterWert[],
  fields: readonly RescueField[],
  tick: () => Promise<void>
): Promise<GeretteterWert[]> {
  let pending = fillRescueFields(kept, fields, true);
  if (pending.length !== kept.length) await tick();
  pending = fillRescueFields(pending, fields);
  pending = fillDialog(form, editors, pending, 'choices');
  await tick();
  pending = fillDialog(form, editors, pending);
  await tick();
  if (pending.length > 0) pending = fillDialog(form, editors, pending);
  return pending;
}

/** A field added later, e.g. a row for kept input, takes its value as soon as it appears. */
export function fillAppeared(
  form: HTMLFormElement,
  editors: readonly RescueEditor[],
  pending: readonly GeretteterWert[],
  fields: readonly RescueField[]
): GeretteterWert[] {
  return fillDialog(form, editors, fillRescueFields(pending, fields));
}

/** The notice above the buttons after kept input was filled in or found in conflict. */
export function rescueNotice(
  conflict: boolean,
  restored: boolean,
  leftOver: number
): string | null {
  if (conflict) {
    return 'Dieser Eintrag wurde inzwischen geändert. Deine früheren Eingaben stehen im Abschnitt „Noch nicht eingesetzt“. Prüfe die aktuelle Fassung, bevor du etwas übernimmst und speicherst.';
  }
  if (!restored) return null;
  return leftOver > 0
    ? 'Ein Teil deiner Eingaben von vor der neuen Anmeldung ist wieder eingesetzt. Den Rest findest du im Abschnitt „Noch nicht eingesetzt“.'
    : 'Deine Eingaben von vor der neuen Anmeldung sind wieder eingesetzt. Prüf sie und speichere.';
}

/**
 * The kept values listed under „Noch nicht eingesetzt“. In a conflict every earlier value is
 * listed, also a cleared field or a removed check mark, because it differs from the newer version.
 */
export function leftOverValues(conflict: boolean, pending: GeretteterWert[]): GeretteterWert[] {
  return conflict ? pending : shownValues(pending);
}

/** Whether a kept compound value can be adopted with „… übernehmen“ instead of being copied. */
export function canAdopt(kept: GeretteterWert, fields: readonly RescueField[]): boolean {
  return fields.some((field) => field.key === kept.key && !field.structure);
}

/**
 * Adopts one kept compound selection, such as the people of a task, into the form; other kept
 * values are never filled in this way. Returns the values still waiting and the notice, or null.
 */
export function adoptKept(
  kept: GeretteterWert,
  pending: readonly GeretteterWert[],
  fields: readonly RescueField[]
): { pending: GeretteterWert[]; notice: string } | null {
  if (kept.kind !== 'custom') return null;
  const field = fields.find((entry) => entry.key === kept.key && !entry.structure);
  if (!field?.set(kept.value)) return null;
  return {
    pending: pending.filter((entry) => entry.key !== kept.key),
    notice: `${rescuedLabel(kept)} übernommen. Prüfe die Auswahl im Formular und speichere.`,
  };
}
