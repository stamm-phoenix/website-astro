import { createGruppenstunde, getStaffGruppenstunden } from './gruppenstunden-list';
import { validateGruppenstunde } from './validation/content';
import { STUFEN } from './validation/constants';
const PREVIEW_ACTOR = 'preview';

/** Invented Gruppenstunden, one per Stufe (matched by Stufe). */
const PREVIEW_GRUPPENSTUNDEN = [
  { weekday: 'Montags', time: '17:00 – 18:30 Uhr', ageRange: '7 – 10 Jahre' },
  { weekday: 'Dienstags', time: '17:30 – 19:00 Uhr', ageRange: '10 – 13 Jahre' },
  { weekday: 'Mittwochs', time: '18:00 – 19:30 Uhr', ageRange: '13 – 16 Jahre' },
  { weekday: 'Freitags', time: '19:00 – 21:00 Uhr', ageRange: '16 – 20 Jahre' },
];

export async function seedPreviewGruppenstunden(): Promise<void> {
  const existing = new Set((await getStaffGruppenstunden()).map((item) => item.stufe));
  for (const [index, stufe] of STUFEN.entries()) {
    if (existing.has(stufe)) continue;
    const input = {
      stufe,
      ...PREVIEW_GRUPPENSTUNDEN[index],
      exception:
        index === 0
          ? {
              startDate: new Date().toISOString().slice(0, 10),
              endDate: '2099-12-31',
              message: 'Heute treffen wir uns draußen (Testdaten).',
              location: 'Wiese am Pfarrheim (Testdaten)',
              time: '',
            }
          : null,
      location: 'Pfarrheim (Testdaten)',
      description: `<p>Erfundene Beschreibung der Gruppenstunde der ${stufe}.</p>`,
    };
    await createGruppenstunde(validateGruppenstunde(input, STUFEN), PREVIEW_ACTOR);
  }
}
