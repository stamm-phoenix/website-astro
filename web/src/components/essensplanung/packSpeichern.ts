import { ApiError } from '../../lib/api';
import type { PackEntwurf, PackZeile } from '../../lib/essensplanungPackliste';
import type { EntwurfAktionen } from './packEntwuerfe.svelte';
import { merkeSpeichern, type PlanKontext } from './planKontext';

/**
 * Saving a row of the packing list, shared by the list (`PackZeile.svelte`) and the matrix
 * (`PackMatrix.svelte`), so both follow the same versions and conflicts.
 */

/** The fields of a row to save: packed, who packs it, or both. */
export interface PackFelder {
  gepackt?: boolean;
  zustaendigId?: number | null;
  zustaendigText?: string;
}

/**
 * Saves a change of a row: of its stored row, or the first one of a tool, on the version the row
 * was shown with. Never throws: a failed save shows its message and says false.
 */
export async function packSenden(
  kontext: PlanKontext,
  zeile: PackZeile,
  felder: PackFelder,
  erfolg: string
): Promise<boolean> {
  const { eintrag, werkzeug, name } = zeile;
  /** A message of the server about a field, e.g. a member who has no access any more. */
  let feldFehler: string | undefined;
  // Noted, so a PDF asked for meanwhile waits for it
  const lauf = kontext.aendern(async () => {
    try {
      return werkzeug === null
        ? await kontext.api.senden('PATCH', `/packliste/${eintrag!.id}`, {
            ...felder,
            etag: eintrag!.etag,
          })
        : await kontext.api.senden('PUT', '/packliste/werkzeug', {
            ...felder,
            werkzeug: name,
            etag: eintrag?.etag ?? null,
          });
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) feldFehler = Object.values(error.fields)[0];
      throw error;
    }
  }, erfolg);
  merkeSpeichern(lauf);
  const ok = await lauf;
  if (!ok && feldFehler) kontext.hinweis(`${name}: ${feldFehler}`, 'error');
  return ok;
}

/**
 * Packs a row or opens it again. A free name typed in the row (`entwurf`) saves first: the tick
 * then goes on the version its answer brought, not into a conflict with it. A failed name keeps
 * its draft and notice; the tick is saved on the version now shown. `zeileJetzt` reads the row
 * as shown after the name's save. Says whether the tick is saved.
 */
export async function packAbhaken(
  kontext: PlanKontext,
  zeileJetzt: () => PackZeile,
  gepackt: boolean,
  entwurf: PackEntwurf | null,
  aktionen: EntwurfAktionen
): Promise<boolean> {
  let nameFehlt: string | null = null;
  if (entwurf !== null) {
    const name = aktionen.speichern(false);
    merkeSpeichern(name);
    if (!(await name)) nameFehlt = entwurf.text.trim() || null;
  }
  const zeile = zeileJetzt();
  const erfolg = gepackt ? `${zeile.name} ist eingepackt.` : `${zeile.name} ist wieder offen.`;
  const vorher = zeile.eintrag?.etag ?? null;
  const freigeben = aktionen.sperren();
  const ok = await packSenden(kontext, zeile, { gepackt }, erfolg);
  if (ok) aktionen.eigeneAenderung(vorher);
  freigeben(nameFehlt === null);
  // The tick's success must not hide that the name typed here is still unsaved
  if (ok && nameFehlt)
    kontext.hinweis(
      `${erfolg} Der Name „${nameFehlt}“ ist aber noch nicht gespeichert; er steht noch in der Zeile, Enter versucht es noch einmal.`,
      'error'
    );
  return ok;
}

/** „Kim packt Topf ein.“ or that nobody does any more. */
export function zustaendigErfolg(wer: string, was: string): string {
  return wer ? `${wer} packt ${was} ein.` : `Für ${was} ist niemand mehr zuständig.`;
}
