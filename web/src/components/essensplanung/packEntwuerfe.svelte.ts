import { ApiError } from '../../lib/api';
import {
  entwurfNachSpeichern,
  entwurfOffen,
  entwuerfeOhneZeile,
  freiName,
  type PackEntwurf,
  type PackZeile,
} from '../../lib/essensplanungPackliste';
import { meldeVerloren, type PlanKontext } from './planKontext';

/**
 * The free names typed at the rows of the packing list („Anderer Name …“), by row key, and their
 * saves. Kept by the list, not the row: a row hidden by a filter, shown anew or switched to
 * read-only keeps what was typed, and a save that ends late never takes text typed meanwhile.
 */

/** What a row does with its draft. */
export interface EntwurfAktionen {
  oeffnen(text: string, etag: string | null, name: string): void;
  tippen(text: string): void;
  verwerfen(): void;
  /**
   * This page saved another field of the row (the tick) on version `vorher`: a draft typed on
   * that version moves to the one now shown, so saving it again is no conflict with that own
   * change. A draft on an older version keeps it, so changes of others still conflict.
   */
  eigeneAenderung(vorher: string | null): void;
  /**
   * Holds back saves of the name while another field of the row is saved (the tick), so a save
   * started meanwhile goes on the version that change brings. The returned function ends it; with
   * false, waiting saves give up like after a failed save, and the draft stays.
   */
  sperren(): (ok: boolean) => void;
  /**
   * Saves the typed name when it changed, on the version it was typed on; after a conflict only
   * on purpose (`bewusst`, Enter). With a save of the row running, it waits for it and then
   * saves what was typed on meanwhile. Says whether the name is saved: also when nothing changed;
   * not after an error or with a conflict left open.
   */
  speichern(bewusst: boolean): Promise<boolean>;
}

export function packEntwuerfe(kontextVon: () => PlanKontext, zeilen: () => PackZeile[]) {
  let entwuerfe = $state<Record<string, PackEntwurf>>({});
  /** The save running per row key; not shown, so not reactive. */
  const laeufe: Record<string, Promise<boolean> | undefined> = {};

  function setzen(key: string, entwurf: PackEntwurf | null): void {
    if (entwurf === null) {
      entwuerfe = Object.fromEntries(Object.entries(entwuerfe).filter(([k]) => k !== key));
    } else entwuerfe = { ...entwuerfe, [key]: entwurf };
  }

  function aendern(key: string, felder: Partial<PackEntwurf>): void {
    const entwurf = entwuerfe[key];
    if (entwurf) setzen(key, { ...entwurf, ...felder });
  }

  const zeileVon = (key: string) => zeilen().find((zeile) => zeile.key === key);

  /** Sends the draft once, if it differs from what the row has saved. */
  async function senden(key: string, bewusst: boolean): Promise<boolean> {
    const zeile = zeileVon(key);
    // A row gone meanwhile saves nothing; its draft is named to copy instead (`abgleichen`)
    const entwurf = zeile ? entwuerfe[key] : undefined;
    if (!zeile || !entwurf) return true;
    if (entwurf.konflikt && !bewusst) return false;
    const text = freiName(entwurf.text);
    if (!entwurf.konflikt && zeile.zustaendigId === null && text === zeile.zustaendig) {
      setzen(key, null);
      return true;
    }
    const { eintrag, werkzeug, name } = zeile;
    const etag = entwurf.etag;
    const kontext = kontextVon();
    let konflikt = false;
    let feldFehler: string | undefined;
    aendern(key, { gesendet: text });
    const ok = await kontext.aendern(
      async () => {
        const felder = { zustaendigId: null, zustaendigText: text };
        try {
          return werkzeug === null
            ? await kontext.api.senden('PATCH', `/packliste/${eintrag!.id}`, { ...felder, etag })
            : await kontext.api.senden('PUT', '/packliste/werkzeug', {
                ...felder,
                werkzeug: name,
                etag,
              });
        } catch (error: unknown) {
          if (error instanceof ApiError) {
            konflikt = error.status === 409;
            if (error.fields) feldFehler = Object.values(error.fields)[0];
          }
          throw error;
        }
      },
      text ? `${text} packt ${name} ein.` : `Für ${name} ist niemand mehr zuständig.`
    );
    if (!ok && feldFehler) kontext.hinweis(`${name}: ${feldFehler}`, 'error');
    const etagJetzt = zeileVon(key)?.eintrag?.etag ?? null;
    if (ok) {
      // Typed on meanwhile: the draft stays, on the version now saved
      setzen(key, entwurfNachSpeichern(entwuerfe[key], text, etagJetzt));
    } else {
      // Not saved: the field keeps the name; after a conflict the page shows the new state, and
      // Enter saves over it on purpose
      aendern(key, konflikt ? { gesendet: null, konflikt, etag: etagJetzt } : { gesendet: null });
    }
    return ok;
  }

  async function speichern(key: string, bewusst: boolean): Promise<boolean> {
    const laufend = laeufe[key];
    if (laufend) {
      // Then save what was typed on meanwhile, with the version the answer brought
      if (!(await laufend)) return false;
      return speichern(key, bewusst);
    }
    const lauf = senden(key, bewusst);
    laeufe[key] = lauf;
    // Registered before any waiter, so it runs first when the save ends
    void lauf.finally(() => {
      if (laeufe[key] === lauf) delete laeufe[key];
    });
    return lauf;
  }

  return {
    /** The draft of a row, or null. */
    von: (key: string): PackEntwurf | null => entwuerfe[key] ?? null,
    /** Whether a typed name is not saved, also one whose row is gone. */
    offen: (): boolean => entwurfOffen(entwuerfe, zeilen()),
    /** Names drafts whose row went to copy, then drops them. Not tracked: call it in an effect. */
    abgleichen(): void {
      for (const { key, meldung } of entwuerfeOhneZeile(entwuerfe, zeilen())) {
        if (meldung) meldeVerloren(kontextVon(), meldung);
        setzen(key, null);
      }
    },
    aktionen: (key: string): EntwurfAktionen => ({
      oeffnen: (text, etag, name) =>
        setzen(key, { text, name, etag, gesendet: null, konflikt: false }),
      tippen: (text) => aendern(key, { text }),
      verwerfen: () => setzen(key, null),
      sperren: () => {
        let los: (ok: boolean) => void = () => undefined;
        const lauf = new Promise<boolean>((done) => (los = done));
        laeufe[key] = lauf;
        return (ok) => {
          if (laeufe[key] === lauf) delete laeufe[key];
          los(ok);
        };
      },
      eigeneAenderung: (vorher) => {
        const entwurf = entwuerfe[key];
        if (entwurf && !entwurf.konflikt && entwurf.etag === vorher)
          aendern(key, { etag: zeileVon(key)?.eintrag?.etag ?? null });
      },
      speichern: (bewusst) => speichern(key, bewusst),
    }),
  };
}
