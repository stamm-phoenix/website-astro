import { emptyNotizen } from '../../../api/lib/mitschriften-model';
import type {
  LiveAbschnitt,
  MitschriftAbschnitt,
  MitschriftAuftrag,
  MitschriftDetail,
  MitschriftNotizen,
  MitschriftSprecher,
  MitschriftenOverview,
} from '../../src/lib/types';
import { joinSentences } from '../../src/lib/mitschriften';
import { dayFromToday, isoFromNow, newEtag } from './util';

/**
 * Mitschriften of the mock API: an invented, finished Leitendenrunde and whatever is created
 * while the dev server runs. Uploaded files are not transcribed; the first check after an
 * upload pretends the job finished with invented sentences.
 */

interface MockMitschrift extends MitschriftDetail {
  /** Client IDs of live sentences, so sending them again changes nothing. */
  clientIds: Set<string>;
}

const mitschriften = new Map<number, MockMitschrift>();
let nextId = 1;
let nextChildId = 1;

const DEMO: [source: 'raum' | 'teams', speaker: number, second: number, text: string][] = [
  ['raum', 1, 2, 'Hallo zusammen, dann fangen wir mit der Leitendenrunde an.'],
  ['raum', 1, 6, 'Erster Punkt ist das Pfingstlager, wo stehen wir da?'],
  ['raum', 2, 11, 'Der Zeltplatz ist reserviert, die Anzahlung fehlt noch.'],
  ['teams', 1, 17, 'Die Anzahlung überweise ich bis Freitag.'],
  ['raum', 1, 22, 'Super, danke. Dann beschließen wir den Teilnahmebeitrag von 120 Euro.'],
  ['raum', 3, 33, 'Ich schaue mir die Jurten am Samstag im Materiallager an.'],
  ['teams', 1, 39, 'Offen ist noch, ob die Rover mitfahren oder ein eigenes Lager machen.'],
  ['raum', 1, 45, 'Nächste Leitendenrunde ist am Donnerstag um 19:30 Uhr im Stammesheim.'],
];

const DEMO_NOTES: MitschriftNotizen = {
  beschluesse: ['Der Teilnahmebeitrag für das Pfingstlager beträgt 120 Euro.'],
  todos: [
    {
      aufgabe: 'Anzahlung für den Zeltplatz überweisen',
      verantwortlich: 'Teams – Sprecher 1',
      frist: 'Freitag',
    },
    {
      aufgabe: 'Jurten im Materiallager prüfen',
      verantwortlich: 'Raum – Sprecher 3',
      frist: 'Samstag',
    },
  ],
  offenePunkte: ['Fahren die Rover mit ins Pfingstlager oder machen sie ein eigenes Lager?'],
  naechsterTermin: 'Donnerstag, 19:30 Uhr im Stammesheim',
};

function create(input: {
  title: string;
  date: string;
  status: MitschriftDetail['status'];
}): MockMitschrift {
  const id = nextId++;
  const mitschrift: MockMitschrift = {
    id,
    title: input.title,
    date: input.date,
    status: input.status,
    etag: newEtag(`mitschrift-${id}`),
    notes: null,
    notesEdited: false,
    notesStale: false,
    notesAt: null,
    createdBy: 'test.leitung@stamm-phoenix.de',
    createdAt: isoFromNow(0),
    sprecher: [],
    abschnitte: [],
    auftraege: [],
    clientIds: new Set(),
  };
  mitschriften.set(id, mitschrift);
  return mitschrift;
}

function speakerFor(
  mitschrift: MockMitschrift,
  source: MitschriftSprecher['source'],
  key: string
): number {
  const existing = mitschrift.sprecher.find((s) => s.source === source && s.key === key);
  if (existing) return existing.id;
  const number = mitschrift.sprecher.filter((s) => s.source === source).length + 1;
  const speaker: MitschriftSprecher = {
    id: nextChildId++,
    source,
    key,
    number,
    name: '',
    etag: newEtag('sprecher'),
  };
  mitschrift.sprecher.push(speaker);
  mitschrift.sprecher.sort((a, b) => a.source.localeCompare(b.source) || a.number - b.number);
  return speaker.id;
}

function addSentence(
  mitschrift: MockMitschrift,
  sentence: Omit<MitschriftAbschnitt, 'id' | 'etag'>
): void {
  mitschrift.abschnitte.push({ ...sentence, id: nextChildId++, etag: newEtag('abschnitt') });
  mitschrift.abschnitte.sort((a, b) => a.startMs - b.startMs || a.id - b.id);
}

function touch(mitschrift: MockMitschrift, transcriptChanged = false): void {
  mitschrift.etag = newEtag(`mitschrift-${mitschrift.id}`);
  if (transcriptChanged && mitschrift.notes) mitschrift.notesStale = true;
}

{
  const demo = create({ title: 'Leitendenrunde', date: dayFromToday(-3), status: 'fertig' });
  for (const [source, speaker, second, text] of DEMO) {
    addSentence(demo, {
      sprecherId: speakerFor(demo, source, `p:${speaker}`),
      source,
      startMs: second * 1000,
      endMs: second * 1000 + 4000,
      text,
    });
  }
  demo.notes = DEMO_NOTES;
  demo.notesAt = isoFromNow(-3);
  const old = create({ title: 'Stammesversammlung', date: dayFromToday(-400), status: 'fertig' });
  addSentence(old, {
    sprecherId: null,
    source: 'datei',
    startMs: 0,
    endMs: 3000,
    text: 'Willkommen zur Stammesversammlung.',
  });
}

function view(mitschrift: MockMitschrift): MitschriftDetail {
  const detail: Partial<MockMitschrift> = { ...mitschrift };
  delete detail.clientIds;
  return structuredClone(detail as MitschriftDetail);
}

export function mitschriftenOverview(): MitschriftenOverview {
  const today = dayFromToday(0);
  const warn = dayFromToday(-365);
  const list = [...mitschriften.values()]
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .map((m) => ({
      id: m.id,
      title: m.title,
      date: m.date,
      status: m.status,
      abschnitte: m.abschnitte.length,
      durationMs: m.abschnitte.reduce((max, a) => Math.max(max, a.endMs), 0),
      auftraege: m.auftraege.filter((a) => a.status !== 'fehler').length,
      createdBy: m.createdBy,
      updatedAt: m.createdAt,
    }));
  return {
    mitschriften: list,
    oldCount: list.filter((m) => m.date < warn).length,
    warnAfterMonths: 12,
    today,
  };
}

export function getMockMitschrift(id: string): MitschriftDetail | undefined {
  const mitschrift = mitschriften.get(Number(id));
  return mitschrift ? view(mitschrift) : undefined;
}

export function createMockMitschrift(
  title: string,
  date: string,
  mode: 'live' | 'datei'
): MitschriftDetail {
  return view(create({ title, date, status: mode }));
}

export function updateMockMitschrift(
  id: string,
  title: string,
  date: string,
  etag: string
): string | null {
  const mitschrift = mitschriften.get(Number(id));
  if (!mitschrift || mitschrift.etag !== etag) return null;
  mitschrift.title = title;
  mitschrift.date = date;
  touch(mitschrift);
  return mitschrift.etag;
}

export function deleteMockMitschrift(id: string): boolean {
  return mitschriften.delete(Number(id));
}

export function deleteOldMockMitschriften(): number {
  const warn = dayFromToday(-365);
  let deleted = 0;
  for (const [id, m] of mitschriften) {
    if (m.date < warn) {
      mitschriften.delete(id);
      deleted++;
    }
  }
  return deleted;
}

export function finishMockMitschrift(id: string): MitschriftDetail | undefined {
  const mitschrift = mitschriften.get(Number(id));
  if (!mitschrift) return undefined;
  mitschrift.status = 'fertig';
  touch(mitschrift);
  return view(mitschrift);
}

export function appendMockLive(
  id: string,
  abschnitte: LiveAbschnitt[]
): { saved: string[]; sprecher: MitschriftSprecher[] } | undefined {
  const mitschrift = mitschriften.get(Number(id));
  if (!mitschrift || mitschrift.status !== 'live') return undefined;
  for (const a of abschnitte) {
    if (mitschrift.clientIds.has(a.clientId)) continue;
    mitschrift.clientIds.add(a.clientId);
    addSentence(mitschrift, {
      sprecherId: a.speakerKey ? speakerFor(mitschrift, a.source, a.speakerKey) : null,
      source: a.source,
      startMs: a.startMs,
      endMs: a.endMs,
      text: a.text,
    });
  }
  touch(mitschrift, true);
  return {
    saved: abschnitte.map((a) => a.clientId),
    sprecher: structuredClone(mitschrift.sprecher),
  };
}

export function updateMockAbschnitt(
  id: string,
  abschnittId: string,
  text: string,
  sprecherId: number | null,
  etag: string
): string | null {
  const mitschrift = mitschriften.get(Number(id));
  const abschnitt = mitschrift?.abschnitte.find((a) => a.id === Number(abschnittId));
  if (!mitschrift || !abschnitt || abschnitt.etag !== etag) return null;
  abschnitt.text = text;
  abschnitt.sprecherId = sprecherId;
  abschnitt.etag = newEtag('abschnitt');
  touch(mitschrift, true);
  return abschnitt.etag;
}

/** Joins sentences into the earliest; `null` if one of them changed in the meantime. */
export function mergeMockAbschnitte(
  id: string,
  parts: { id: number; etag: string }[],
  text: string
): string | null {
  const mitschrift = mitschriften.get(Number(id));
  if (!mitschrift || parts.length < 2) return null;
  const rows = parts.map((p) => mitschrift.abschnitte.find((a) => a.id === p.id));
  if (rows.some((row, i) => !row || row.etag !== parts[i].etag)) return null;
  const sorted = (rows as MitschriftAbschnitt[]).sort((a, b) => a.startMs - b.startMs);
  const [first, ...rest] = sorted;
  first.text = text;
  first.endMs = Math.max(...sorted.map((a) => a.endMs));
  first.etag = newEtag('abschnitt');
  mitschrift.abschnitte = mitschrift.abschnitte.filter((a) => !rest.includes(a));
  touch(mitschrift, true);
  return first.etag;
}

/**
 * Stands in for the model that joins cut sentences: joins sentences of the same speaker after
 * a pause of at most a second, with the suggestion the page also makes by hand.
 */
export function smoothMockAbschnitte(id: string): number {
  const mitschrift = mitschriften.get(Number(id));
  if (!mitschrift) return 0;
  let merged = 0;
  for (let i = mitschrift.abschnitte.length - 1; i > 0; i--) {
    const previous = mitschrift.abschnitte[i - 1];
    const next = mitschrift.abschnitte[i];
    if (
      previous.sprecherId === null ||
      previous.sprecherId !== next.sprecherId ||
      previous.source !== next.source ||
      next.startMs - previous.endMs > 1000
    ) {
      continue;
    }
    previous.text = joinSentences([previous.text, next.text]);
    previous.endMs = next.endMs;
    previous.etag = newEtag('abschnitt');
    mitschrift.abschnitte.splice(i, 1);
    merged++;
  }
  if (merged > 0) touch(mitschrift, true);
  return merged;
}

export function deleteMockAbschnitte(id: string, ids: number[]): number {
  const mitschrift = mitschriften.get(Number(id));
  if (!mitschrift) return 0;
  const before = mitschrift.abschnitte.length;
  mitschrift.abschnitte = mitschrift.abschnitte.filter((a) => !ids.includes(a.id));
  const deleted = before - mitschrift.abschnitte.length;
  if (deleted > 0) {
    mitschrift.notes = null;
    mitschrift.notesEdited = false;
    mitschrift.notesStale = false;
    touch(mitschrift);
  }
  return deleted;
}

export function renameMockSprecher(
  id: string,
  sprecherId: string,
  name: string,
  etag: string
): string | null {
  const mitschrift = mitschriften.get(Number(id));
  const speaker = mitschrift?.sprecher.find((s) => s.id === Number(sprecherId));
  if (!mitschrift || !speaker || speaker.etag !== etag) return null;
  speaker.name = name;
  speaker.etag = newEtag('sprecher');
  touch(mitschrift, true);
  return speaker.etag;
}

export function mergeMockSprecher(id: string, sprecherId: string, into: number): boolean {
  const mitschrift = mitschriften.get(Number(id));
  const from = Number(sprecherId);
  if (!mitschrift || !mitschrift.sprecher.some((s) => s.id === into) || from === into) return false;
  for (const a of mitschrift.abschnitte) if (a.sprecherId === from) a.sprecherId = into;
  mitschrift.sprecher = mitschrift.sprecher.filter((s) => s.id !== from);
  touch(mitschrift, true);
  return true;
}

/** Invented notes; the mock has no model. */
export function generateMockNotes(id: string): MitschriftNotizen | undefined {
  const mitschrift = mitschriften.get(Number(id));
  if (!mitschrift) return undefined;
  if (mitschrift.abschnitte.length === 0) return emptyNotizen();
  return {
    beschluesse: [`${mitschrift.abschnitte.length} Sätze besprochen (Beispielnotiz der Mock-API).`],
    todos: [{ aufgabe: 'Notizen prüfen', verantwortlich: null, frist: null }],
    offenePunkte: [],
    naechsterTermin: null,
  };
}

export function saveMockNotes(
  id: string,
  notes: MitschriftNotizen,
  etag: string,
  edited: boolean
): string | null {
  const mitschrift = mitschriften.get(Number(id));
  if (!mitschrift || mitschrift.etag !== etag) return null;
  mitschrift.notes = notes;
  mitschrift.notesEdited = edited;
  if (!edited) {
    mitschrift.notesStale = false;
    mitschrift.notesAt = isoFromNow(0);
  }
  touch(mitschrift);
  return mitschrift.etag;
}

export function isMockNotesEdited(id: string): boolean {
  return mitschriften.get(Number(id))?.notesEdited === true;
}

export function mockEtag(id: string): string | undefined {
  return mitschriften.get(Number(id))?.etag;
}

export function mockStatus(id: string): MitschriftDetail['status'] | undefined {
  return mitschriften.get(Number(id))?.status;
}

export function createMockAuftrag(
  id: string,
  source: MitschriftAuftrag['source'],
  offsetMs: number,
  untilMs: number | null
): MitschriftAuftrag | undefined {
  const mitschrift = mitschriften.get(Number(id));
  if (!mitschrift) return undefined;
  const auftrag: MitschriftAuftrag = {
    id: nextChildId++,
    source,
    status: 'hochladen',
    offsetMs,
    untilMs,
    error: null,
    createdAt: isoFromNow(0),
  };
  mitschrift.auftraege.push(auftrag);
  return structuredClone(auftrag);
}

export function startMockAuftrag(id: string, auftragId: string): MitschriftDetail | undefined {
  const mitschrift = mitschriften.get(Number(id));
  const auftrag = mitschrift?.auftraege.find((a) => a.id === Number(auftragId));
  if (!mitschrift || !auftrag) return undefined;
  if (auftrag.status === 'hochladen') auftrag.status = 'laeuft';
  return view(mitschrift);
}

export function removeMockAuftrag(id: string, auftragId: string): MitschriftDetail | undefined {
  const mitschrift = mitschriften.get(Number(id));
  if (!mitschrift) return undefined;
  mitschrift.auftraege = mitschrift.auftraege.filter((a) => a.id !== Number(auftragId));
  return view(mitschrift);
}

/** The first check finishes every running job with invented sentences. */
export function checkMockAuftraege(
  id: string
): { stored: boolean; mitschrift: MitschriftDetail } | undefined {
  const mitschrift = mitschriften.get(Number(id));
  if (!mitschrift) return undefined;
  let stored = false;
  for (const auftrag of mitschrift.auftraege.filter((a) => a.status === 'laeuft')) {
    const lines = [
      'Willkommen zum Treffen, schön dass alle da sind.',
      'Wir planen heute das Sommerlager.',
      'Ich kümmere mich um die Anmeldung bis Ende des Monats.',
    ];
    lines.forEach((text, index) =>
      addSentence(mitschrift, {
        sprecherId: speakerFor(mitschrift, auftrag.source, `a${auftrag.id}:${(index % 2) + 1}`),
        source: auftrag.source,
        startMs: auftrag.offsetMs + index * 5000,
        endMs: auftrag.offsetMs + index * 5000 + 4000,
        text,
      })
    );
    mitschrift.auftraege = mitschrift.auftraege.filter((a) => a !== auftrag);
    if (mitschrift.status === 'datei') mitschrift.status = 'fertig';
    touch(mitschrift, true);
    stored = true;
  }
  return { stored, mitschrift: view(mitschrift) };
}
