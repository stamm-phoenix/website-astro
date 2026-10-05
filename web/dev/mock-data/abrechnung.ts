/** Einzelnachweise and Kostenstellen of the mock API (Leitendenbereich → Abrechnung). */
import { readFileSync } from 'node:fs';
import { kjrPersons, summarizeEntries, toNachweise } from '../../../api/lib/abrechnung';
import type { NachweisInput } from '../../../api/lib/abrechnung';
import type { Abrechnung, CampflowPerson, Kostenstelle } from '../../src/lib/types';
import { CONFIG } from '../../../api/lib/config';
import {
  buildKjrTeilnahmeliste,
  KjrListeError,
  KjrListeInputError,
  parseKjrListeRequest,
} from '../../../api/lib/kjr-teilnahmeliste';
import { countNights } from '../../../api/lib/kjr-zuschuss';
import { campflowDetail } from './campflow';

export const kostenstellen: Kostenstelle[] = [
  { id: 'cun_Sola26', name: 'Sommerlager 2026 Oberjoch', archived: false },
  { id: 'cun_WoeHerbst', name: 'Wölflings-Herbstwochenende', archived: false },
  { id: 'cun_Hike', name: 'Hike 2026', archived: false },
  { id: 'cun_Stavo', name: 'Stammesversammlung', archived: false },
  { id: 'cun_Allgemein', name: 'Allgemein', archived: false },
  { id: 'cun_Sola25', name: 'Sommerlager 2025', archived: true },
];

type Eintrag = [category: string, amountEur: number];

const BUCHUNGEN: Record<string, Eintrag[]> = {
  // Deficit like the template Abrechnungsmappe: the KJR grant covers part of it
  cun_Sola26: [
    ['Teilnehmerbeiträge', 1850],
    ['Teilnehmerbeiträge', 1650],
    ['Teilnehmerbeiträge', 1400],
    ['Unterkunft', -400],
    ['Unterkunft', -2750.4],
    ['Transport', -1335.06],
    ['Transport', -620],
    ['Verpflegung', -983.37],
    ['Verpflegung', -1112.15],
    ['Verpflegung', -389.9],
    ['Material', -149.45],
    ['Programm', -310],
  ],
  // Surplus: no grant can be applied for
  cun_WoeHerbst: [
    ['Teilnehmerbeiträge', 1260],
    ['Unterkunft', -480],
    ['Verpflegung', -312.48],
    ['Material', -36.9],
  ],
  cun_Hike: [
    ['Teilnehmerbeiträge', 240],
    ['Transport', -186.4],
    ['Verpflegung', -95.2],
  ],
  // Single day without overnight stay: 5 € per person
  cun_Stavo: [
    ['Verpflegung', -64.5],
    ['Spenden', 20],
  ],
};

/** Leaders who register as participants; the KJR counts them as Betreuer*innen from 27 on. */
const BETREUENDE: Record<string, number> = { evt_Sola26: 3, evt_WoeHerbst: 1, evt_Stavo: 2 };

const BESCHREIBUNG: Record<string, string> = {
  Teilnehmerbeiträge: 'Teilnehmerbeitrag',
  Unterkunft: 'Zeltplatz',
  Transport: 'Busfahrt',
  Verpflegung: 'Einkauf Lebensmittel',
  Material: 'Bastelmaterial',
  Programm: 'Eintritt',
  Spenden: 'Spende',
};
const AUSLAGE = ['Kim Muster', 'Alex Beispiel', null];

/** Rows like the Playwright API's Einzelnachweise, with receipt numbers, dates and payers. */
function entries(costUnit: Kostenstelle): NachweisInput[] {
  return (BUCHUNGEN[costUnit.id] ?? []).map(([category, amountEur], index) => ({
    receiptNumber: amountEur > 0 ? null : `2026-${String(100 + index)}`,
    type: amountEur > 0 ? 'Beitrag' : 'Ausgabebeleg',
    description: BESCHREIBUNG[category] ?? category,
    category,
    paidBy: amountEur > 0 ? null : AUSLAGE[index % AUSLAGE.length],
    date: `2026-0${1 + (index % 9)}-${String(10 + index).padStart(2, '0')}`,
    amountEur,
  }));
}

function findKostenstelle(wanted: string): Kostenstelle | undefined {
  const name = wanted.trim().toLowerCase();
  return kostenstellen.find((k) => k.id === wanted || k.name.toLowerCase() === name);
}

/** Teilnehmende from outside the Landkreis Rosenheim, which the KJR does not subsidise. */
const AUSWAERTIGE: Record<string, { name: string; zip: string }[]> = {
  evt_Sola26: [
    { name: 'Gast München', zip: '80331' },
    { name: 'Gast Rosenheim', zip: '83022' },
  ],
};

/** The CampFlow registrations plus leaders and guests from outside the Landkreis. */
function personsFor(id: string): CampflowPerson[] {
  const detail = campflowDetail(id);
  if (!detail) return [];
  const year = Number((detail.event.start_date ?? '2026-01-01').slice(0, 4));
  const leaders: CampflowPerson[] = Array.from({ length: BETREUENDE[id] ?? 0 }, (_, i) => ({
    id: `prs_leitung${i}`,
    name: { first_name: ['Kim', 'Alex', 'Robin'][i % 3], last_name: 'Leitung' },
    gender: i % 2 ? 'f' : 'm',
    birthdate: `${year - 28 - i * 5}-01-15`,
    address: { postcode: '83620' },
    confirmation_date: '2026-01-01T10:00:00Z',
  }));
  const guests: CampflowPerson[] = (AUSWAERTIGE[id] ?? []).map((guest, i) => ({
    id: `prs_gast${i}`,
    name: { first_name: guest.name.split(' ')[0], last_name: guest.name.split(' ')[1] },
    gender: 'f',
    birthdate: `${year - 12 - i}-03-01`,
    address: { postcode: guest.zip },
    confirmation_date: '2026-01-01T10:00:00Z',
  }));
  return [...detail.persons, ...leaders, ...guests];
}

/** Like `POST /api/intern/abrechnung/{id}/kjr-liste`: the filled template or an error. */
export function kjrListeFor(
  id: string,
  body: Record<string, unknown> | null
): { file: Uint8Array; fileName: string } | { status: number; error: string } | 'NOT_FOUND' {
  const detail = campflowDetail(id);
  if (!detail) return 'NOT_FOUND';
  const template = readFileSync(
    new URL('../../../api/assets/kjr-teilnahmeliste.xlsx', import.meta.url)
  );
  const { event } = detail;
  try {
    const input = parseKjrListeRequest(body);
    const file = buildKjrTeilnahmeliste(template, {
      kopf: {
        antragsteller: CONFIG.abrechnung.antragsteller,
        titel: event.title,
        ort: input.ort,
        plz: input.plz,
        beginn: event.start_date,
        beginnZeit: input.beginnZeit,
        ende: event.end_date ?? event.start_date,
        endeZeit: input.endeZeit,
      },
      persons: input.persons,
      nights: countNights(event.start_date, event.end_date),
    });
    return { file, fileName: `KJR-Teilnahmeliste ${event.title}.xlsx` };
  } catch (caught: unknown) {
    if (caught instanceof KjrListeInputError) return { status: 400, error: caught.message };
    if (caught instanceof KjrListeError) return { status: 422, error: caught.message };
    throw caught;
  }
}

/** Like `GET /api/intern/abrechnung/{id}`; a string is the error code. */
export function abrechnungFor(
  id: string,
  requested: string
): Abrechnung | 'NOT_FOUND' | 'KOSTENSTELLE_NOT_FOUND' {
  const detail = campflowDetail(id);
  if (!detail) return 'NOT_FOUND';
  const costUnit = findKostenstelle(requested || detail.event.title);
  if (!costUnit) return 'KOSTENSTELLE_NOT_FOUND';

  return {
    event: {
      id: detail.event.id,
      title: detail.event.title,
      start_date: detail.event.start_date,
      end_date: detail.event.end_date,
    },
    costUnit: { id: costUnit.id, name: costUnit.name },
    persons: kjrPersons(personsFor(id), detail.event.start_date),
    bilanz: summarizeEntries(entries(costUnit)),
    nachweise: toNachweise(entries(costUnit)),
  };
}
