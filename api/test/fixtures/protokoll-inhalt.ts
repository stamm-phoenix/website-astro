import assert from 'node:assert/strict';
import { ValidationError } from '../../lib/validation/errors';
import { validateProtokollInhalt } from '../../lib/validation/protokoll-inhalt';
import type { ProtokollInhalt, ProtokollPunkt } from '../../lib/protokoll-editor-model';

export const PERSON = { login: 'anna@stamm-phoenix.de', name: 'Anna Autorin' };

export function punkt(id: string, overrides: Partial<ProtokollPunkt> = {}): ProtokollPunkt {
  return {
    id,
    titel: 'Begrüßung',
    aktion: null,
    text: 'Zeile 1\nZeile 2',
    aufgaben: [],
    termine: [],
    projekt: null,
    offeneAufgaben: [],
    unterpunkte: [],
    ...overrides,
  };
}

export function inhalt(): ProtokollInhalt {
  return {
    kopf: {
      sitzungsleitung: [PERSON],
      protokollant: [],
      beginn: '19:30',
      ende: '',
      teilnehmende: [{ ...PERSON, status: 'anwesend' }],
      externe: 'Gast\nzwei',
    },
    punkte: [punkt('p-1', { unterpunkte: [punkt('p-1a')] })],
    naechsteSitzung: { datum: '2026-11-04', uhrzeit: '19:30', ort: 'Stammesheim' },
  };
}

/** The message of the one invalid spot; the field is always `inhalt`. */
export function message(change: (value: Record<string, unknown>) => void): string {
  const copy = structuredClone(inhalt()) as unknown as Record<string, unknown>;
  change(copy);
  return reject(copy);
}

export function reject(value: unknown): string {
  try {
    validateProtokollInhalt(value);
  } catch (error) {
    assert.ok(error instanceof ValidationError);
    assert.deepEqual(Object.keys(error.fields), ['inhalt']);
    return error.fields.inhalt;
  }
  return assert.fail('Expected a ValidationError.');
}

export type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const firstPunkt = (v: Record<string, unknown>): Loose => (v.punkte as Loose[])[0];
export const kopf = (v: Record<string, unknown>): Loose => v.kopf as Loose;
