import { createAktion, getStaffAktionen } from './aktionen-list';
import { validateAktion } from './validation/aktion';
import { STUFEN, LEITENDE_STUFE } from './validation/constants';
import { dateToLocalParts } from './nikolaus-config';
const DAY_MS = 86_400_000;
const PREVIEW_ACTOR = 'preview';

/** Invented calendar entries without CampFlow (matched by title). */
const PREVIEW_AKTIONEN: {
  title: string;
  stufen: string[];
  days: number;
  length: number;
  meetingPoint?: string;
  packingList?: string[];
}[] = [
  {
    title: 'Stammeswochenende (Testdaten)',
    stufen: [...STUFEN],
    days: 30,
    length: 2,
    meetingPoint: 'Pfadfinderheim',
    packingList: ['Schlafsack', 'Taschenlampe', 'Wetterfeste Kleidung'],
  },
  {
    title: 'Waldweihnacht (Testdaten)',
    stufen: ['Wölflinge', 'Jungpfadfinder'],
    days: 60,
    length: 0,
  },
  { title: 'Leitendenrunde (Testdaten)', stufen: [LEITENDE_STUFE], days: 10, length: 0 },
];

export async function seedPreviewAktionen(now: Date = new Date()): Promise<void> {
  const existing = new Set((await getStaffAktionen()).map((entry) => entry.title));
  for (const aktion of PREVIEW_AKTIONEN) {
    if (existing.has(aktion.title)) continue;
    const start = dateToLocalParts(new Date(now.getTime() + aktion.days * DAY_MS)).date;
    const end = dateToLocalParts(
      new Date(now.getTime() + (aktion.days + aktion.length) * DAY_MS)
    ).date;
    const input = {
      title: aktion.title,
      stufen: aktion.stufen,
      start,
      end,
      link: '',
      description: '<p>Dieser Termin ist erfunden und nur in der Preview zu sehen.</p>',
      meetingPoint: aktion.meetingPoint,
      packingList: aktion.packingList,
    };
    await createAktion(validateAktion(input, [...STUFEN, LEITENDE_STUFE]), PREVIEW_ACTOR);
  }
}
