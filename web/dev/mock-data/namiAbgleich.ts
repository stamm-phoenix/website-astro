import { gleicheAb } from '../../../api/lib/nami-abgleich';
import type { NamiAbgleichData } from '../../../api/lib/nami-abgleich-model';
import type { NamiMitglied } from '../../../api/lib/nami-schema';
import type { CampflowPerson } from '../../../api/lib/campflow';
import { dayFromToday } from './util';
import { mitgliederData } from './mitglieder';

/**
 * The module „Nami-Abgleich“ of the mock API: NaMi is built from the invented CampFlow members,
 * with a few differences, one member only in NaMi and one missing there.
 */

function record(value: unknown): Record<string, string> {
  return value && typeof value === 'object' ? (value as Record<string, string>) : {};
}

function asNami(person: CampflowPerson, index: number): NamiMitglied {
  const name = record(person.name);
  const address = record(person.address);
  const phones = Array.isArray(person.phone_numbers)
    ? person.phone_numbers.map((phone) => record(phone).number ?? '')
    : [];
  const groups = Array.isArray(person.group_names) ? person.group_names.map(String) : [];
  const stufe = ['Wölfling', 'Jungpfadfinder', 'Pfadfinder', 'Rover'].find((s) =>
    groups.some((g) => g.includes(s.slice(0, 6)))
  );
  const left = typeof person.leave_date === 'string' && person.leave_date <= dayFromToday(0);
  return {
    id: 300000 + index,
    mitgliedsnummer: index % 4 === 0 ? '' : String(person.membership_number ?? ''),
    vorname: name.first_name ?? '',
    nachname: name.last_name ?? '',
    spitzname: '',
    geburtsdatum: typeof person.birthdate === 'string' ? person.birthdate : null,
    geschlecht: person.gender === 'f' ? 'weiblich' : 'männlich',
    email: String(person.primary_email ?? ''),
    emailVertretungsberechtigter: '',
    // Some numbers and streets were changed in CampFlow only
    telefon: index % 5 === 1 ? ['08063 999999'] : phones,
    eintritt: typeof person.join_date === 'string' ? person.join_date : null,
    austritt: left ? String(person.leave_date) : null,
    status: left ? 'Inaktiv' : 'Aktiv',
    mitgliedstyp: left ? 'Nicht-Mitglied' : 'Mitglied',
    stufe: stufe ?? '',
    adresse: {
      strasse:
        index % 7 === 2 ? 'Alte Dorfstraße 1' : (address.street ?? '').replace('straße', 'str.'),
      plz: address.postcode ?? '',
      ort: address.city ?? '',
    },
  };
}

export function namiAbgleichData(): NamiAbgleichData {
  const persons = mitgliederData().persons;
  // The newest child is not yet in NaMi
  const inNami = persons.slice(0, -1).map(asNami);
  inNami.push({
    ...asNami(persons[0], 999),
    id: 399999,
    mitgliedsnummer: '777777',
    vorname: 'Korbinian',
    nachname: 'Nurnami',
    geburtsdatum: '2012-06-15',
  });
  const now = new Date();
  return gleicheAb(inNami, persons, dayFromToday(0), { nami: now, campflow: now });
}
