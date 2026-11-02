import { ApiError } from '../../lib/api';
import type { Geschaeft, PlanungZutat } from '../../lib/types';
import type { Vorschlag } from '../../lib/vorschlaege';
import type { PlanKontext } from './planKontext';

/**
 * The shop of an ingredient typed in the dialog of a line of a dish (`GerichtZeileDialog`): one
 * of the Planung's shops or a new name, which adds the shop first. The shop belongs to the
 * ingredient of the Planung, so it applies to every dish with it.
 */

/** A name as the API saves it: trimmed, inner spaces as one. */
export const geschaeftsName = (text: string): string => text.trim().replace(/\s+/g, ' ');

export function geschaeftVorschlaege(geschaefte: readonly Geschaeft[]): Vorschlag[] {
  return geschaefte.map((g) => ({ key: String(g.id), value: g.name }));
}

/** The shop whose name was typed, ignoring case but not umlauts. */
export function getipptesGeschaeft(
  geschaefte: readonly Geschaeft[],
  text: string
): Geschaeft | undefined {
  const name = geschaeftsName(text);
  return geschaefte.find((g) => g.name.localeCompare(name, 'de', { sensitivity: 'accent' }) === 0);
}

/** The name of the shop an ingredient is bought at; empty without one. */
export function geschaeftVon(geschaefte: readonly Geschaeft[], zutat?: PlanungZutat): string {
  return geschaefte.find((g) => g.id === zutat?.geschaeftId)?.name ?? '';
}

/**
 * Adds the typed shop when the Planung has none of that name. Whether it is there now, else the
 * error of the name, if the API named one.
 */
export async function geschaeftAnlegen(
  kontext: PlanKontext,
  text: string
): Promise<{ ok: boolean; feld?: string }> {
  const name = geschaeftsName(text);
  if (!name || getipptesGeschaeft(kontext.ansicht.geschaefte, name)) return { ok: true };
  let feld: string | undefined;
  const ok = await kontext.aendern(async () => {
    try {
      return await kontext.api.senden('POST', '/geschaefte', { name });
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) feld = error.fields.name;
      throw error;
    }
  });
  return { ok, feld };
}

/**
 * Sets the typed shop of an ingredient of the Planung, which must exist; empty text: none.
 * Nothing is sent when it has that shop already. Set on the version `etag` of the ingredient,
 * so the choice of someone else meanwhile is a conflict.
 */
export async function geschaeftSetzen(
  kontext: PlanKontext,
  planungZutatId: number,
  etag: string,
  text: string,
  erfolg?: string
): Promise<{ ok: boolean; konflikt?: boolean }> {
  const name = geschaeftsName(text);
  const geschaeftId = name ? getipptesGeschaeft(kontext.ansicht.geschaefte, name)?.id : null;
  // Renamed or deleted by someone else meanwhile: the page shows the shops of now
  if (geschaeftId === undefined) {
    kontext.hinweis(`Das Geschäft „${name}“ gibt es nicht mehr.`, 'error');
    return { ok: false };
  }
  const zutat = kontext.ansicht.zutaten.find((z) => z.id === planungZutatId);
  if (zutat && (zutat.geschaeftId ?? null) === geschaeftId) return { ok: true };
  let konflikt = false;
  const ok = await kontext.aendern(async () => {
    try {
      return await kontext.api.senden('PUT', `/zutaten/${planungZutatId}/geschaeft`, {
        geschaeftId,
        etag,
      });
    } catch (error: unknown) {
      konflikt = error instanceof ApiError && error.status === 409;
      throw error;
    }
  }, erfolg);
  return { ok, konflikt };
}
