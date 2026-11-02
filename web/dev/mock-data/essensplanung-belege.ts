/**
 * The receipts of the Planungen in the mock API, like `api/lib/essen-belege.ts`, with the photos
 * in memory and a demo check of new photos. The demo Planung starts with three receipts.
 */
import type {
  BelegAenderung,
  BelegBezahltVon,
  BelegInput,
  PlanungBeleg,
} from '../../../api/lib/essen-belege-model';
import { MAX_BELEGE } from '../../../api/lib/essen-belege-model';
import type { MockPlanung, MockZugang } from './essensplanung-planung';
import { aendere, feld, konflikt, neueId, neuesEtag, nichtGefunden } from './essensplanung-planung';

interface MockBeleg {
  id: number;
  etag: string;
  datum: string;
  betragCent: number;
  haendler: string;
  notiz: string;
  bezahltVonId: number | null;
  bezahltVonText: string;
  erstattet: boolean;
  erstattetAm: string | null;
  erstattetVonId: number | null;
  angelegtVonId: number | null;
  angelegtAm: string;
}

/** The files of a receipt: the picture, its original, the PDF it shows. */
export interface MockFotos {
  photo: Uint8Array;
  original?: Uint8Array;
  pdf?: Uint8Array;
  svg?: boolean;
}

const belege = new Map<number, MockBeleg[]>();
const fotos = new Map<number, MockFotos>();

function heute(minus = 0): string {
  return new Date(Date.now() - minus * 86_400_000).toISOString().slice(0, 10);
}

/** A drawn receipt for the demo, so the table shows a preview. */
function demoBon(haendler: string, betrag: string): Uint8Array {
  const zeilen = ['Nudeln 5 kg', 'Tomaten passiert 6x', 'Zwiebeln 3 kg', 'Käse gerieben']
    .map((text, index) => `<text x="30" y="${170 + index * 40}" font-size="24">${text}</text>`)
    .join('');
  return new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600"><rect width="400" height="600" fill="#fbfaf5"/><text x="200" y="80" font-size="34" font-weight="bold" text-anchor="middle" font-family="monospace">${haendler}</text>${zeilen}<line x1="30" y1="360" x2="370" y2="360" stroke="#333" stroke-dasharray="6 4"/><text x="30" y="410" font-size="30" font-weight="bold" font-family="monospace">SUMME ${betrag}</text></svg>`
  );
}

/** The receipts of a Planung; the demo Planung gets three on first use. */
function liste(planung: MockPlanung): MockBeleg[] {
  let eintraege = belege.get(planung.id);
  if (eintraege) return eintraege;
  eintraege = [];
  belege.set(planung.id, eintraege);
  if (planung.name === 'Demo-Sommerlager') {
    const ich = planung.mitglieder[0]?.id ?? null;
    const basis = { notiz: '', erstattetAm: null, erstattetVonId: null, angelegtVonId: ich };
    eintraege.push(
      {
        ...basis,
        id: neueId(),
        etag: neuesEtag(),
        datum: heute(5),
        betragCent: 8735,
        haendler: 'Großmarkt',
        notiz: 'Grundeinkauf',
        bezahltVonId: ich,
        bezahltVonText: '',
        erstattet: true,
        erstattetAm: new Date(Date.now() - 86_400_000).toISOString(),
        erstattetVonId: ich,
        angelegtAm: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      },
      {
        ...basis,
        id: neueId(),
        etag: neuesEtag(),
        datum: heute(3),
        betragCent: 4250,
        haendler: 'Rewe',
        bezahltVonId: ich,
        bezahltVonText: '',
        erstattet: false,
        angelegtAm: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      },
      {
        ...basis,
        id: neueId(),
        etag: neuesEtag(),
        datum: heute(2),
        betragCent: 1450,
        haendler: 'Gas für den Kocher',
        bezahltVonId: null,
        bezahltVonText: 'Oma Inge',
        erstattet: false,
        angelegtAm: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      }
    );
    fotos.set(eintraege[1].id, { photo: demoBon('REWE', '42,50'), svg: true });
  }
  return eintraege;
}

function name(planung: MockPlanung, id: number | null): string {
  return id === null ? '' : (planung.mitglieder.find((m) => m.id === id)?.name ?? '');
}

/** The receipts as the view shows them, newest day first. */
export function belegeAnsicht(planung: MockPlanung): PlanungBeleg[] {
  return liste(planung)
    .map((beleg): PlanungBeleg => {
      const datei = fotos.get(beleg.id);
      return {
        id: beleg.id,
        etag: beleg.etag,
        datum: beleg.datum,
        betragCent: beleg.betragCent,
        haendler: beleg.haendler,
        notiz: beleg.notiz,
        bezahltVonId: beleg.bezahltVonId,
        bezahltVonText: beleg.bezahltVonText,
        bezahltVon:
          beleg.bezahltVonId === null ? beleg.bezahltVonText : name(planung, beleg.bezahltVonId),
        erstattet: beleg.erstattet,
        erstattetAm: beleg.erstattet ? beleg.erstattetAm : null,
        erstattetVon: beleg.erstattet ? name(planung, beleg.erstattetVonId) : '',
        foto: datei ? (datei.pdf ? 'pdf' : 'bild') : null,
        original: Boolean(datei?.original),
        angelegtVon: name(planung, beleg.angelegtVonId),
        angelegtAm: beleg.angelegtAm,
      };
    })
    .sort((a, b) => b.datum.localeCompare(a.datum) || b.id - a.id);
}

function pruefeBezahltVon(z: MockZugang, input: BelegBezahltVon, bisher: number | null): string {
  if (input.bezahltVonId === null) return input.bezahltVonText;
  const mitglied = z.planung.mitglieder.find((m) => m.id === input.bezahltVonId);
  if (!mitglied || (mitglied.entzogen && mitglied.id !== bisher))
    throw feld('bezahltVonId', 'Bitte aus der Liste wählen.');
  return mitglied.name;
}

/**
 * The photos of a JSON body like the API reads them; null when it sends none. Throws for a
 * picture that is no JPEG or a file that is no PDF.
 */
export function fotosAus(body: Record<string, unknown> | null): MockFotos | null {
  if (typeof body?.photo !== 'string') return null;
  const photo = new Uint8Array(Buffer.from(body.photo, 'base64'));
  if (photo[0] !== 0xff || photo[1] !== 0xd8)
    throw feld('photo', 'Bitte ein Foto im JPEG-Format hochladen.');
  const original =
    typeof body.original === 'string'
      ? new Uint8Array(Buffer.from(body.original, 'base64'))
      : undefined;
  const pdf =
    typeof body.pdf === 'string' ? new Uint8Array(Buffer.from(body.pdf, 'base64')) : undefined;
  if (pdf && Buffer.from(pdf.subarray(0, 5)).toString('latin1') !== '%PDF-')
    throw feld('photo', 'Die Datei ist kein PDF. Bitte ein PDF oder ein Foto wählen.');
  return { photo, original, pdf };
}

const details = (beleg: Pick<MockBeleg, 'haendler' | 'betragCent' | 'datum'>) => ({
  name: beleg.haendler,
  betragCent: beleg.betragCent,
  datum: beleg.datum,
});

export function belegAnlegen(z: MockZugang, input: BelegInput, datei: MockFotos | null): void {
  const eintraege = liste(z.planung);
  if (eintraege.length >= MAX_BELEGE)
    throw feld('betragCent', `Höchstens ${MAX_BELEGE} Belege je Planung.`);
  pruefeBezahltVon(z, input, null);
  const ich = z.mitglied?.id ?? null;
  aendere(z, 'beleg-neu', details(input), () => {
    const beleg: MockBeleg = {
      id: neueId(),
      etag: neuesEtag(),
      ...input,
      erstattetAm: input.erstattet ? new Date().toISOString() : null,
      erstattetVonId: input.erstattet ? ich : null,
      angelegtVonId: ich,
      angelegtAm: new Date().toISOString(),
    };
    eintraege.push(beleg);
    if (datei) fotos.set(beleg.id, datei);
  });
}

function belegVon(z: MockZugang, id: number): MockBeleg {
  const beleg = liste(z.planung).find((b) => b.id === id);
  if (!beleg) throw nichtGefunden();
  return beleg;
}

/** Changes (`aenderung`) or deletes (null) a receipt. */
export function belegAendern(
  z: MockZugang,
  id: number,
  aenderung: BelegAenderung | null,
  etag: unknown
): void {
  const beleg = belegVon(z, id);
  if (!aenderung) {
    if (beleg.etag !== etag) throw konflikt();
    aendere(z, 'beleg-geloescht', details(beleg), () => {
      const eintraege = liste(z.planung);
      eintraege.splice(eintraege.indexOf(beleg), 1);
      fotos.delete(beleg.id);
    });
    return;
  }
  const log: Record<string, unknown> = details(beleg);
  if (aenderung.bezahltVon)
    log.bezahltVon = pruefeBezahltVon(z, aenderung.bezahltVon, beleg.bezahltVonId);
  if (aenderung.erstattet !== undefined) log.erstattet = aenderung.erstattet;
  if (beleg.etag !== etag) throw konflikt();
  aendere(z, 'beleg-geaendert', log, () => {
    const { bezahltVon, ...rest } = aenderung;
    Object.assign(beleg, rest, bezahltVon ?? {}, { etag: neuesEtag() });
    if (aenderung.erstattet !== undefined) {
      beleg.erstattetAm = aenderung.erstattet ? new Date().toISOString() : null;
      beleg.erstattetVonId = aenderung.erstattet ? (z.mitglied?.id ?? null) : null;
    }
  });
}

/** Adds, replaces (`datei`) or removes (null) the photo of a receipt. */
export function belegFotoSetzen(
  z: MockZugang,
  id: number,
  datei: MockFotos | null,
  etag: unknown
): void {
  const beleg = belegVon(z, id);
  if (beleg.etag !== etag) throw konflikt();
  aendere(z, 'beleg-foto', { ...details(beleg), foto: datei !== null }, () => {
    if (datei) fotos.set(id, datei);
    else fotos.delete(id);
    beleg.etag = neuesEtag();
  });
}

/** A picture of a receipt, also for the read-only link; null without one. */
export function belegFoto(
  z: MockZugang,
  id: number,
  art: string
): { bytes: Uint8Array; typ: string } | null {
  belegVon(z, id);
  const datei = fotos.get(id);
  if (!datei) return null;
  if (art === 'datei' && datei.pdf) return { bytes: datei.pdf, typ: 'application/pdf' };
  if (art === 'original' && datei.original) return { bytes: datei.original, typ: 'image/jpeg' };
  return { bytes: datei.photo, typ: datei.svg ? 'image/svg+xml' : 'image/jpeg' };
}

/** The demo check: reads a made-up shop, today and an amount; rotation never. */
export function demoPruefung(nurDrehung: boolean): Record<string, unknown> {
  if (nurDrehung) return { available: true, rotation: 0 };
  return {
    available: true,
    check: {
      ok: true,
      isReceipt: true,
      complete: true,
      readable: true,
      issues: [],
      restrictedItems: [],
      shop: 'Demo-Markt',
      date: heute(),
      amountCent: 2345,
      checkedAt: new Date().toISOString(),
    },
  };
}
