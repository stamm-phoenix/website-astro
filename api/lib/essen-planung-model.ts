import type { Gericht, PlanungZutat } from './essen-gerichte-model';
import type { z } from 'zod';
import type { EinkaufPosten, ZusatzPosten, Geschaeft } from './essen-einkauf-model';
import type { Einkauf } from './essen-einkaeufe-model';
import type { PacklisteEintrag } from './essen-packliste-model';
import type { PlanungBeleg } from './essen-belege-model';
import type { EinplanungStatus, Verbrauch } from './essen-kochen-model';
import type { PlanungGruppe, Teilnehmende } from './essen-teilnehmende-model';
import { FAKTOR_FEHLER, MAX_FAKTOR, faktorGueltig, leseFaktor } from './essen-planung-faktor';
import { MAX_TAGE, addDays, daysBetween, loeschDatum, readDatum } from './essen-planung-datum';
import type {
  anlegenSchema,
  beitrittSchema,
  einladungSchema,
  mahlzeitSchema,
  planungEinstellungenSchema,
} from './essen-planung-schema';

export { MAX_TAGE, addDays, daysBetween, loeschDatum, readDatum };
export { FAKTOR_FEHLER, MAX_FAKTOR, faktorGueltig, leseFaktor };

/**
 * Types, rules and checks of a Planung of the Essensplanung without database access, so the
 * mock API of the website uses the same ones (`docs/essensplanung.md`).
 */

export type PlanungRolle = 'besitzer' | 'bearbeiten';

/** What the link in the request allows: a member's own link or the shared read-only link. */
export type PlanungZugang = PlanungRolle | 'lesen';

/** Also the limit of the template, so a day from the template can always take a replacement. */
export const MAX_MAHLZEITEN_PRO_TAG = 20;
export const MAX_MITGLIEDER = 50;
/** Dishes per meal, e.g. main course, dessert and a replacement. */
export const MAX_EINPLANUNGEN_PRO_MAHLZEIT = 10;

/** Unconfirmed requests to create a Planung expire after this time. */
export const ANFRAGE_GUELTIG_MS = 24 * 60 * 60_000;
/** Per address at most this many requests to create a Planung per hour. */
export const ANFRAGEN_PRO_STUNDE = 3;
/** „Meine Planungen“ and new links: at most one mail per member in this time. */
export const LINK_WARTEZEIT_MS = 10 * 60_000;
/** The owners are warned this many days before a Planung is deleted. */
export const LOESCHWARNUNG_TAGE = 14;

export interface PlanungMitglied {
  id: number;
  etag: string;
  name: string;
  rolle: PlanungRolle;
  /** Only for those who manage the members. */
  email: string | null;
  entzogen: boolean;
  ich: boolean;
}

/** A dish planned at a meal. */
export interface Einplanung {
  id: number;
  etag: string;
  gerichtId: number;
  /** Order within the meal, from 1. */
  position: number;
  /** The amounts of the dish times this, e.g. 0.5 when only half eat the dessert. */
  faktor: number;
  /** A member of the Planung, or null. */
  zustaendigId: number | null;
  /** The shown name of who is responsible: the member's or a free one; empty for nobody. */
  zustaendig: string;
  /** Whether it is still needed, was cooked or left out. */
  status: EinplanungStatus;
  /** What it used when cooked; empty otherwise. */
  verbrauch: Verbrauch[];
}

export interface PlanungMahlzeit {
  id: number;
  etag: string;
  position: number;
  /** Shown ID `<Tag>_<Slot>`, e.g. `3_1`; follows the current order. */
  kennung: string;
  name: string;
  /** `HH:MM` or null. */
  uhrzeit: string | null;
  einplanungen: Einplanung[];
  /** Groups that do not eat at this meal; empty: all eat. */
  ohneGruppen: number[];
}

export interface PlanungTag {
  id: number;
  etag: string;
  /** `YYYY-MM-DD`. */
  datum: string;
  /** Tag 1 is the earliest day. */
  nummer: number;
  mahlzeiten: PlanungMahlzeit[];
}

export interface PlanungAenderung {
  seq: number;
  at: string;
  wer: string;
  aktion: string;
  details: Record<string, unknown>;
}

/** Everything a page of a Planung shows. */
export interface PlanungAnsicht {
  id: number;
  etag: string;
  name: string;
  seq: number;
  /**
   * What the page polls with: the change counter and the version of the Steuerung, so the end of
   * the maintenance mode or a new retention reaches open pages too.
   */
  stand: string;
  zugang: PlanungZugang;
  /** The member whose link is used; null for the read-only link. */
  ichId: number | null;
  /** Whether this link may invite and manage members and the shared links. */
  darfVerwalten: boolean;
  mitgliederVerwalten: boolean;
  /** Shared links (tokens), only for those who manage; null while switched off. */
  links: { beitritt: string | null; lesen: string | null } | null;
  tage: PlanungTag[];
  mitglieder: PlanungMitglied[];
  /** When the Planung will be deleted (`YYYY-MM-DD`), from its last day and the retention. */
  loeschtAm: string | null;
  /** Changes are refused while the Steuerung's maintenance mode is on. */
  wartung: boolean;
  /** The latest changes, newest first. */
  aenderungen: PlanungAenderung[];
  /** Version of the central lists; a new one means the page loads them again. */
  katalogStand: string;
  /** Ingredients used in the Planung, by name. */
  zutaten: PlanungZutat[];
  /** Dishes by name, with their lines in order. */
  gerichte: Gericht[];
  /** Groups in their order. */
  gruppen: PlanungGruppe[];
  /** Rows of participants, by group and diet. */
  teilnehmende: Teilnehmende[];
  /** Shops in their order. */
  geschaefte: Geschaeft[];
  /** What is there before the Aktion. */
  bestand: EinkaufPosten[];
  /** What is needed without a dish. */
  zusatzbedarf: ZusatzPosten[];
  /** Shopping trips in their order, with what was ticked off and the rules set by hand. */
  einkaeufe: Einkauf[];
  /** Stored states of tools and entries of its own of the packing list, in the order added. */
  packliste: PacklisteEintrag[];
  /** Receipts, newest day first (`essen-belege.ts`). */
  belege: PlanungBeleg[];
}

/** Whether `zugang` may change the plan (days, meals, later dishes). */
export function darfBearbeiten(zugang: PlanungZugang): boolean {
  return zugang === 'besitzer' || zugang === 'bearbeiten';
}

/** Whether `zugang` may invite and remove members and manage the shared links. */
export function darfMitgliederVerwalten(
  zugang: PlanungZugang,
  mitgliederVerwalten: boolean
): boolean {
  return zugang === 'besitzer' || (zugang === 'bearbeiten' && mitgliederVerwalten);
}

/** Adds the shown IDs and day numbers to days sorted by date and meals sorted by position. */
export function nummeriereTage(
  tage: Omit<PlanungTag, 'nummer' | 'mahlzeiten'>[],
  mahlzeiten: (Omit<PlanungMahlzeit, 'kennung'> & { tagId: number })[]
): PlanungTag[] {
  return [...tage]
    .sort((a, b) => a.datum.localeCompare(b.datum))
    .map((tag, index) => ({
      ...tag,
      nummer: index + 1,
      mahlzeiten: mahlzeiten
        .filter((mahlzeit) => mahlzeit.tagId === tag.id)
        .sort((a, b) => a.position - b.position || a.id - b.id)
        .map((mahlzeit, slot) => ({
          id: mahlzeit.id,
          etag: mahlzeit.etag,
          name: mahlzeit.name,
          uhrzeit: mahlzeit.uhrzeit,
          position: mahlzeit.position,
          kennung: `${index + 1}_${slot + 1}`,
          einplanungen: [...mahlzeit.einplanungen].sort(
            (a, b) => a.position - b.position || a.id - b.id
          ),
          ohneGruppen: [...mahlzeit.ohneGruppen].sort((a, b) => a - b),
        })),
    }));
}

export type AnlegenInput = z.output<typeof anlegenSchema>;

export type BeitrittInput = z.output<typeof beitrittSchema>;

export type EinladungInput = z.output<typeof einladungSchema>;

/** The fields of the Planung someone changed, each with the value the form started from. */
export type PlanungEinstellungenInput = z.output<typeof planungEinstellungenSchema>;

export type MahlzeitInput = z.output<typeof mahlzeitSchema>;

/**
 * The newest of some versions (rowversions grow with every change). A whole that is deleted
 * with it, e.g. a meal with its dishes, fails after any change of one of its parts.
 */
export function neuesteVersion(etags: string[]): string {
  return etags.reduce((neueste, etag) => (etag > neueste ? etag : neueste), '');
}

/** The version a meal is deleted with: of the meal and the dishes planned at it. */
export function mahlzeitStand(mahlzeit: PlanungMahlzeit): string {
  return neuesteVersion([mahlzeit.etag, ...mahlzeit.einplanungen.map((e) => e.etag)]);
}

/** The version a day is deleted with: of the day, its meals and their dishes. */
export function tagStand(tag: PlanungTag): string {
  return neuesteVersion([tag.etag, ...tag.mahlzeiten.map(mahlzeitStand)]);
}

/** A dish at a meal, or moved or copied to one; `gerichtId` only when it is added. */
export interface EinplanungInput {
  mahlzeitId: number;
  gerichtId: number;
  faktor: number;
  zustaendigId: number | null;
  zustaendigText: string;
}

/** Shown text of a change, e.g. „Mahlzeit 3_1 umbenannt: Frühstück“. */
export const AENDERUNG_TEXTE: Record<string, string> = {
  'planung-angelegt': 'Planung angelegt',
  'planung-geaendert': 'Einstellungen geändert',
  'tag-neu': 'Tag hinzugefügt',
  'tag-geaendert': 'Tag verschoben',
  'tag-geloescht': 'Tag gelöscht',
  'mahlzeit-neu': 'Mahlzeit hinzugefügt',
  'mahlzeit-geaendert': 'Mahlzeit geändert',
  'mahlzeit-geloescht': 'Mahlzeit gelöscht',
  'mitglied-eingeladen': 'Mitglied eingeladen',
  'mitglied-beigetreten': 'Beigetreten',
  'mitglied-geaendert': 'Mitglied geändert',
  'mitglied-entzogen': 'Zugang entzogen',
  'mitglied-link': 'Neuen Link verschickt',
  'link-beitritt': 'Link zum Beitreten geändert',
  'link-lesen': 'Link zum Ansehen geändert',
  'name-geaendert': 'Eigenen Namen geändert',
  'gericht-neu': 'Gericht angelegt',
  'gericht-geaendert': 'Gericht geändert',
  'gericht-geloescht': 'Gericht gelöscht',
  'gericht-zutat-neu': 'Zutat zu Gericht hinzugefügt',
  'gericht-zutat-geaendert': 'Zutat in Gericht geändert',
  'gericht-zutat-geloescht': 'Zutat aus Gericht entfernt',
  'zutat-neu': 'Eigene Zutat angelegt',
  'zutat-geaendert': 'Zutat der Planung geändert',
  'zutat-geloescht': 'Zutat der Planung gelöscht',
  'einplanung-neu': 'Gericht eingeplant',
  'einplanung-geaendert': 'Einplanung geändert',
  'einplanung-abgehakt': 'Einplanung abgehakt',
  'einplanung-geloescht': 'Gericht aus Mahlzeit entfernt',
  'gruppe-neu': 'Gruppe angelegt',
  'gruppe-geaendert': 'Gruppe geändert',
  'gruppe-geloescht': 'Gruppe gelöscht',
  'teilnehmende-neu': 'Teilnehmende hinzugefügt',
  'teilnehmende-geaendert': 'Teilnehmende geändert',
  'teilnehmende-geloescht': 'Teilnehmende entfernt',
  'mahlzeit-gruppen': 'Gruppen einer Mahlzeit geändert',
  'geschaeft-neu': 'Geschäft angelegt',
  'geschaeft-geaendert': 'Geschäft geändert',
  'geschaeft-geloescht': 'Geschäft gelöscht',
  'zutat-geschaeft': 'Geschäft einer Zutat geändert',
  'bestand-neu': 'Bestand eingetragen',
  'bestand-geaendert': 'Bestand geändert',
  'bestand-geloescht': 'Bestand entfernt',
  'zusatzbedarf-neu': 'Zusatzbedarf eingetragen',
  'zusatzbedarf-geaendert': 'Zusatzbedarf geändert',
  'zusatzbedarf-geloescht': 'Zusatzbedarf entfernt',
  'einkauf-neu': 'Einkauf angelegt',
  'einkauf-geaendert': 'Einkauf geändert',
  'einkauf-geloescht': 'Einkauf gelöscht',
  'einkauf-abgehakt': 'Beim Einkaufen abgehakt',
  'einkauf-aufgehoben': 'Häkchen beim Einkaufen aufgehoben',
  'einkauf-regel': 'Posten eines Einkaufs geändert',
  'einkauf-verschoben': 'Posten in anderen Einkauf verschoben',
  'einkauf-zurueckgeholt': 'Posten in Einkauf zurückgeholt',
  'einheiten-vereinheitlicht': 'Einheiten einer Zutat vereinheitlicht',
  'packliste-neu': 'Auf die Packliste gesetzt',
  'packliste-geaendert': 'Packliste geändert',
  'packliste-geloescht': 'Von der Packliste genommen',
  'beleg-neu': 'Beleg eingetragen',
  'beleg-geaendert': 'Beleg geändert',
  'beleg-foto': 'Foto eines Belegs geändert',
  'beleg-geloescht': 'Beleg gelöscht',
};
