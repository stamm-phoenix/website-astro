/**
 * Reads the data of the agenda nodes back from the HTML of the clipboard (`protokollDokument.ts`):
 * only the fields of the model are taken over, anything else is dropped.
 */
import { newElementId } from './protokollEditor';
import type {
  OffeneAufgabe,
  ProtokollAktion,
  ProtokollAufgabe,
  ProtokollPerson,
  ProtokollProjekt,
  ProtokollZeitraum,
  PunktTermin,
} from '../../../api/lib/protokoll-editor-model';

type Felder = Record<string, unknown>;

export function isRecord(value: unknown): value is Felder {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether `value` is an object whose fields `keys` are all strings. */
function hasStrings(value: unknown, keys: string[]): value is Felder {
  return isRecord(value) && keys.every((key) => typeof value[key] === 'string');
}

function isPerson(value: unknown): value is ProtokollPerson {
  return hasStrings(value, ['login', 'name']);
}

/** The valid people of a list, as the task or date stores them. */
function personen(value: unknown): ProtokollPerson[] {
  return Array.isArray(value)
    ? value.filter(isPerson).map((person) => ({ login: person.login, name: person.name }))
    : [];
}

/**
 * Only the fields of the model are taken over, with a fresh ID: a pasted copy must never share an
 * ID with its original, which keeps its own wherever the copy lands.
 */
export function leseAufgabe(value: unknown): ProtokollAufgabe | null {
  if (!hasStrings(value, ['titel', 'faellig'])) return null;
  return {
    id: newElementId(),
    titel: value.titel as string,
    zustaendig: personen(value.zustaendig),
    faellig: value.faellig as string,
  };
}

export function leseTermin(value: unknown): PunktTermin | null {
  if (!hasStrings(value, ['titel', 'datum', 'uhrzeit', 'ort'])) return null;
  return {
    id: newElementId(),
    titel: value.titel as string,
    datum: value.datum as string,
    uhrzeit: value.uhrzeit as string,
    ort: value.ort as string,
    zustaendig: personen(value.zustaendig),
  };
}

function isTaskId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function leseProjekt(value: unknown): ProtokollProjekt | null {
  if (!hasStrings(value, ['titel']) || !isTaskId(value.id)) return null;
  return { id: value.id, titel: value.titel as string };
}

/** An open task keeps its ID: it is the task of the module Aufgaben, not an entry of the minutes. */
export function leseOffeneAufgabe(value: unknown): OffeneAufgabe | null {
  if (!hasStrings(value, ['titel', 'faellig']) || !isTaskId(value.id)) return null;
  return {
    id: value.id,
    titel: value.titel as string,
    zustaendig: personen(value.zustaendig),
    faellig: value.faellig as string,
    erledigt: value.erledigt === true,
  };
}

export function leseAktion(value: unknown): ProtokollAktion | null {
  if (!hasStrings(value, ['id', 'titel', 'start', 'ende'])) return null;
  return {
    id: value.id as string,
    titel: value.titel as string,
    start: value.start as string,
    ende: value.ende as string,
  };
}

export function leseZeitraum(value: unknown): ProtokollZeitraum | null {
  if (!hasStrings(value, ['start', 'ende'])) return null;
  return { start: value.start as string, ende: value.ende as string };
}

/** The valid entries of a list from the clipboard, within the limit of the minutes. */
export function leseListe<T>(value: unknown, lese: (item: unknown) => T | null, max: number): T[] {
  if (!Array.isArray(value)) return [];
  const items: T[] = [];
  for (const item of value) {
    const read = lese(item);
    if (read) items.push(read);
    if (items.length === max) break;
  }
  return items;
}
