import { ApiError } from '../../lib/api';
import {
  personenAenderung,
  type PackAuswahl,
  type PackZeile,
} from '../../lib/essensplanungPackliste';
import type { PackZuteilung } from '../../../../api/lib/essen-packliste-model';
import type { PlanungAnsicht } from '../../../../api/lib/essen-planung-model';
import { merkeSpeichern, type PlanKontext } from './planKontext';

/**
 * Saving a row of the packing list, shared by the list (`PackZeile.svelte`), the matrix
 * (`PackMatrix.svelte`) and the choice of who packs (`PackWerDialog.svelte`), so all follow the
 * same versions and conflicts: packing the whole thing goes on the version the row was shown
 * with, a person's own box on the version of their share; persons added and taken off merge.
 */

/** The fields of a row to save: packed, persons added (members, free names) or taken off. */
export interface PackFelder {
  gepackt?: boolean;
  mitglieder?: number[];
  namen?: string[];
  weg?: number[];
}

/** Runs a save of the packing list; a message of the server about a field is named with `was`. */
async function senden(
  kontext: PlanKontext,
  was: string,
  arbeit: () => Promise<PlanungAnsicht>,
  erfolg: string
): Promise<{ ok: boolean; feldFehler: string | null }> {
  /** A message of the server about a field, e.g. a member who has no access any more. */
  let feldFehler: string | null = null;
  // Noted, so a PDF asked for meanwhile waits for it
  const lauf = kontext.aendern(async () => {
    try {
      return await arbeit();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields)
        feldFehler = Object.values(error.fields)[0] ?? null;
      throw error;
    }
  }, erfolg);
  merkeSpeichern(lauf);
  const ok = await lauf;
  if (!ok && feldFehler) kontext.hinweis(`${was}: ${feldFehler}`, 'error');
  return { ok, feldFehler };
}

/**
 * Saves a change of a row: of its stored row, or the first one of a tool. Never throws: a failed
 * save shows its message and says false (with the server's message about a field, if any).
 */
export async function packSenden(
  kontext: PlanKontext,
  zeile: PackZeile,
  felder: PackFelder,
  erfolg: string
): Promise<{ ok: boolean; feldFehler: string | null }> {
  const { eintrag, werkzeug, name } = zeile;
  return senden(
    kontext,
    name,
    () =>
      werkzeug === null
        ? kontext.api.senden('PATCH', `/packliste/${eintrag!.id}`, {
            ...felder,
            etag: eintrag!.etag,
          })
        : kontext.api.senden('PUT', '/packliste/werkzeug', {
            ...felder,
            werkzeug: name,
            etag: eintrag?.etag ?? null,
          }),
    erfolg
  );
}

/** Packs the whole row or opens it again, also the boxes of all its persons. */
export async function packAbhaken(
  kontext: PlanKontext,
  zeile: PackZeile,
  gepackt: boolean
): Promise<boolean> {
  const erfolg = gepackt ? `${zeile.name} ist eingepackt.` : `${zeile.name} ist wieder offen.`;
  return (await packSenden(kontext, zeile, { gepackt }, erfolg)).ok;
}

/** Packs or unpacks one person's share of a row, on the version of that share. */
export async function anteilAbhaken(
  kontext: PlanKontext,
  zeile: PackZeile,
  person: PackZuteilung,
  gepackt: boolean
): Promise<boolean> {
  const erfolg = gepackt
    ? `${person.name} hat ${zeile.name} eingepackt.`
    : `${zeile.name} ist für ${person.name} wieder offen.`;
  const { ok } = await senden(
    kontext,
    zeile.name,
    () =>
      kontext.api.senden('PATCH', `/packliste/zuteilung/${person.id}`, {
        gepackt,
        etag: person.etag,
      }),
    erfolg
  );
  return ok;
}

/** „Kim und Alex packen Kochschürze ein.“, „Sam packt Topf nicht mehr ein.“ */
export function personenErfolg(
  was: string,
  hinzu: string[],
  weg: string[],
  bleiben: number
): string {
  const liste = (namen: string[]) =>
    namen.length > 1 ? `${namen.slice(0, -1).join(', ')} und ${namen.at(-1)}` : namen[0];
  const verb = (namen: string[]) => (namen.length > 1 ? 'packen' : 'packt');
  if (!bleiben && !hinzu.length) return `Für ${was} ist niemand mehr zuständig.`;
  return [
    hinzu.length ? `${liste(hinzu)} ${verb(hinzu)} ${was} ein.` : '',
    weg.length ? `${liste(weg)} ${verb(weg)} ${was} nicht mehr ein.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Saves who packs a row as chosen in the dialog: the difference to `vorher`, the row as the
 * dialog opened with it, so a person someone else added meanwhile stays. `jetzt` is the row as
 * shown now. Says null when saved, else why not.
 */
export async function personenSpeichern(
  kontext: PlanKontext,
  vorher: PackZeile,
  jetzt: PackZeile,
  auswahl: PackAuswahl
): Promise<string | null> {
  const aenderung = personenAenderung(vorher, auswahl);
  if (!aenderung.mitglieder.length && !aenderung.namen.length && !aenderung.weg.length) return null;
  const hinzu = [
    ...aenderung.mitglieder.map(
      (id) => kontext.ansicht.mitglieder.find((m) => m.id === id)?.name ?? ''
    ),
    ...aenderung.namen,
  ];
  const weg = vorher.personen.filter((p) => aenderung.weg.includes(p.id)).map((p) => p.name);
  const erfolg = personenErfolg(
    jetzt.name,
    hinzu,
    weg,
    vorher.personen.length - aenderung.weg.length
  );
  const { ok, feldFehler } = await packSenden(kontext, jetzt, aenderung, erfolg);
  if (ok) return null;
  if (feldFehler) kontext.hinweis(null);
  return feldFehler ?? kontext.fehler ?? `Wer ${jetzt.name} einpackt, ist nicht gespeichert.`;
}
