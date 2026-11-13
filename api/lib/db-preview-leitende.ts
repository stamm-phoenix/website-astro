import { testPicture } from './db-preview-blog';
import { createLeitende, getStaffLeitende, setLeitendePhoto } from './leitende-list';
import { validateLeitende } from './validation/content';
const PREVIEW_ACTOR = 'preview';

/** Invented Leitende with their teams; some with a test photo (matched by name). */
const PREVIEW_LEITENDE: {
  name: string;
  teams: string[];
  photo?: [string, string];
  contact?: { phone: string; street: string; postalCode: string; city: string };
}[] = [
  {
    name: 'Vera Vorstand',
    teams: ['Vorstand'],
    photo: ['#003056', '#810a1a'],
    contact: {
      phone: '0123 456789',
      street: 'Teststraße 1',
      postalCode: '12345',
      city: 'Musterstadt',
    },
  },
  {
    name: 'Volker Vorstand',
    teams: ['Vorstand', 'Rover'],
    contact: {
      phone: '0123 987654',
      street: 'Beispielweg 2',
      postalCode: '12345',
      city: 'Musterstadt',
    },
  },
  { name: 'Lea Leiterin', teams: ['Wölflinge'], photo: ['#f28c00', '#f2b705'] },
  { name: 'Max Muster', teams: ['Wölflinge', 'Jungpfadfinder'] },
  { name: 'Tom Test', teams: ['Jungpfadfinder'], photo: ['#2f53a7', '#8ab4f8'] },
  { name: 'Paula Protokoll', teams: ['Pfadfinder'], photo: ['#2a7a3b', '#a8d5b0'] },
  { name: 'Rita Rover', teams: ['Rover'] },
];

export async function seedPreviewLeitende(): Promise<void> {
  let people = await getStaffLeitende();
  for (const person of PREVIEW_LEITENDE) {
    if (people.some((candidate) => candidate.name === person.name)) continue;
    const input = { name: person.name, teams: person.teams, ...person.contact };
    await createLeitende(validateLeitende(input, person.teams), PREVIEW_ACTOR);
  }
  people = await getStaffLeitende();
  for (const person of PREVIEW_LEITENDE) {
    const stored = people.find((candidate) => candidate.name === person.name);
    if (!person.photo || !stored || stored.hasImage) continue;
    const [from, to] = person.photo;
    await setLeitendePhoto(
      Number(stored.id),
      await testPicture(600, 600, from, to),
      stored.etag,
      PREVIEW_ACTOR
    );
  }
}
