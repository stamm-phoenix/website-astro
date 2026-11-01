import { confirmAction } from '../../lib/confirm';
import { einplanungBody } from '../../lib/essensplanungEinplanung';
import { geplanterVerbrauch } from '../../lib/essensplanungLager';
import { gerichtNamens, zustaendigAus } from '../../lib/essensplanungPlan';
import type { esserRechner } from '../../lib/essensplanungRechnung';
import type { EinplanungStatus } from '../../../../api/lib/essen-kochen-model';
import type { Einplanung, PlanungAnsicht, PlanungMahlzeit } from '../../lib/types';
import type { PlanKontext } from './planKontext';

/**
 * Changes of the plan that the list, the calendar and dragging share: plan, move, copy, take out,
 * tick off. Each runs through `kontext.aendern`, so the page shows its result or the conflict.
 */

/** A small button of the plan: dense with a mouse, 44 px where a finger taps. */
export const KNOPF =
  'inline-flex items-center justify-center gap-1 rounded-sm border border-neutral-300 bg-surface px-2 py-0.5 text-xs font-semibold text-brand-900 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 any-pointer-coarse:min-h-11 any-pointer-coarse:px-3';

/** An icon button of the plan, e.g. to sort or delete a meal. */
export const SYMBOL =
  'inline-flex size-7 items-center justify-center rounded-sm text-neutral-700 hover:bg-neutral-100 hover:text-brand-900 disabled:cursor-not-allowed disabled:opacity-40 any-pointer-coarse:size-11';

/** The name of a planned dish. */
export function gerichtName(ansicht: PlanungAnsicht, einplanung: Einplanung): string {
  return ansicht.gerichte.find((g) => g.id === einplanung.gerichtId)?.name ?? 'Gericht';
}

/** Plans an existing dish at a meal, at `position` (default: the end). */
export function planeEin(
  kontext: PlanKontext,
  mahlzeit: PlanungMahlzeit,
  gerichtId: number,
  extra: { position?: number; zustaendig?: string; faktor?: number } = {}
): Promise<boolean> {
  const name = kontext.ansicht.gerichte.find((g) => g.id === gerichtId)?.name ?? 'Gericht';
  return kontext.aendern(
    () =>
      kontext.api.senden('POST', '/einplanungen', {
        mahlzeitId: mahlzeit.id,
        gerichtId,
        faktor: extra.faktor ?? 1,
        ...zustaendigAus(extra.zustaendig ?? '', kontext.ansicht.mitglieder),
        ...(extra.position !== undefined ? { position: extra.position } : {}),
      }),
    `${name} bei ${mahlzeit.kennung} eingeplant.`
  );
}

/**
 * A name typed into a meal: an existing dish of that name is planned there, a new one is created
 * there (without people, they come later).
 */
export async function tippeEin(
  kontext: PlanKontext,
  mahlzeit: PlanungMahlzeit,
  name: string,
  zustaendig: string
): Promise<boolean> {
  const neu = name.trim().replace(/\s+/g, ' ');
  const vorhanden = gerichtNamens(kontext.ansicht.gerichte, neu);
  if (vorhanden) return planeEin(kontext, mahlzeit, vorhanden.id, { zustaendig });
  return kontext.aendern(
    () =>
      kontext.api.senden('POST', '/gerichte', {
        name: neu,
        mahlzeitId: mahlzeit.id,
        ...zustaendigAus(zustaendig, kontext.ansicht.mitglieder),
      }),
    `${neu} angelegt und bei ${mahlzeit.kennung} eingeplant.`
  );
}

/** Moves a planned dish to `ziel` at `position`, or copies it there with the same details. */
export function verschiebe(
  kontext: PlanKontext,
  einplanung: Einplanung,
  ziel: PlanungMahlzeit,
  position: number,
  kopieren = false
): Promise<boolean> {
  const name = gerichtName(kontext.ansicht, einplanung);
  const body = { ...einplanungBody(einplanung, ziel.id), position };
  if (kopieren) {
    const { etag: _etag, ...neu } = body;
    void _etag;
    return kontext.aendern(
      () => kontext.api.senden('POST', '/einplanungen', neu),
      `${name} nach ${ziel.kennung} kopiert.`
    );
  }
  return kontext.aendern(
    () => kontext.api.senden('PATCH', `/einplanungen/${einplanung.id}`, body),
    `${name} nach ${ziel.kennung} verschoben.`
  );
}

/** Takes a planned dish out of its meal after asking; the dish stays in the Planung. */
export async function nimmHeraus(
  kontext: PlanKontext,
  mahlzeit: PlanungMahlzeit,
  einplanung: Einplanung
): Promise<boolean> {
  const name = gerichtName(kontext.ansicht, einplanung);
  const { id, etag } = einplanung;
  if (
    !(await confirmAction({
      title: `${name} aus ${mahlzeit.kennung} nehmen?`,
      message: 'Das Gericht bleibt in der Planung und lässt sich wieder einplanen.',
      confirmLabel: 'Entfernen',
    }))
  )
    return false;
  return kontext.aendern(
    () => kontext.api.senden('DELETE', `/einplanungen/${id}`, undefined, etag),
    `${name} aus ${mahlzeit.name} genommen.`
  );
}

const STATUS_MELDUNG: Record<EinplanungStatus, string> = {
  gekocht: 'ist als gekocht abgehakt',
  ausgelassen: 'ist als ausgelassen abgehakt',
  offen: 'ist wieder offen',
};

/**
 * Ticks a planned dish off in one go: cooked with the planned amounts, left out, or open again.
 * Other amounts are typed in its part „Verbrauch“.
 */
export function setzeStatus(
  kontext: PlanKontext,
  mahlzeit: PlanungMahlzeit,
  einplanung: Einplanung,
  status: EinplanungStatus,
  esser: ReturnType<typeof esserRechner>
): Promise<boolean> {
  const gericht = kontext.ansicht.gerichte.find((g) => g.id === einplanung.gerichtId);
  const verbrauch =
    status === 'gekocht' ? geplanterVerbrauch(gericht, mahlzeit, einplanung.faktor, esser) : [];
  return kontext.aendern(
    () =>
      kontext.api.senden('PUT', `/einplanungen/${einplanung.id}/status`, {
        etag: einplanung.etag,
        status,
        verbrauch,
      }),
    `${gericht?.name ?? 'Gericht'} ${STATUS_MELDUNG[status]}.`
  );
}
