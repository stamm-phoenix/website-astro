import assert from 'node:assert/strict';
import test from 'node:test';
import { validateNikolausSettings } from '../lib/nikolaus-settings';
import { ValidationError } from '../lib/validation/errors';
import { TEST_SETTINGS } from './fixtures/nikolaus-settings';

function settings(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...structuredClone(TEST_SETTINGS), ...patch };
}

function fields(value: unknown): Record<string, string> {
  try {
    validateNikolausSettings(value);
  } catch (error) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return assert.fail('Expected a ValidationError.');
}

const DAY = { date: '2026-12-05', start: '17:00', end: '21:00', teams: 2 };
const area = (patch: Record<string, unknown> = {}) => ({ ...TEST_SETTINGS.area, ...patch });
const base = (patch: Record<string, unknown> = {}) =>
  area({ base: { ...TEST_SETTINGS.area.base, ...patch } });

test('valid settings are read as sent, with days sorted and areas cleaned', () => {
  assert.deepEqual(validateNikolausSettings({ ...settings(), extra: 1 }), TEST_SETTINGS);
  const result = validateNikolausSettings(
    settings({
      days: [
        { ...DAY, date: '2026-12-06', teams: 4 },
        { ...DAY, extra: 1 },
      ],
      area: area({
        base: { name: '  Pfarrheim  ', lat: 0, lon: -180 },
        servicePostalCodes: [' 83620 ', '83620', '83052'],
      }),
      dayContact: { name: ' Max ', phone: ' 0170 1234567 ' },
    })
  );
  assert.deepEqual(result.days, [DAY, { ...DAY, date: '2026-12-06', teams: 4 }]);
  assert.deepEqual(result.area.base, { name: 'Pfarrheim', lat: 0, lon: -180 });
  assert.deepEqual(result.area.servicePostalCodes, ['83620', '83052']);
  assert.deepEqual(result.dayContact, { name: 'Max', phone: '0170 1234567' });
  assert.equal(
    validateNikolausSettings(settings({ dayContact: { name: '', phone: ' ' } })).dayContact,
    null
  );
  assert.equal(validateNikolausSettings(settings({ dayContact: 'x' })).dayContact, null);
  assert.equal(
    validateNikolausSettings(
      settings({
        days: Array.from({ length: 10 }, (_, i) => ({ ...DAY, date: `2026-12-${10 + i}` })),
      })
    ).days.length,
    10
  );
});

test('a body that is no object reports every required field', () => {
  assert.deepEqual(Object.keys(fields(null)).sort(), [
    'area.base.lat',
    'area.base.lon',
    'area.base.name',
    'area.farDistanceKm',
    'area.servicePostalCodes',
    'changeDeadlineHours',
    'days',
    'maintenance',
    'pendingHoldMinutes',
    'publicActive',
    'staffActive',
  ]);
  assert.equal(fields(null).days, 'Bitte die Besuchstage angeben.');
  assert.equal(fields([]).publicActive, 'Bitte auswählen.');
});

test('switches and numbers report their limits', () => {
  assert.deepEqual(
    fields(
      settings({
        publicActive: 1,
        staffActive: 'true',
        maintenance: null,
        pendingHoldMinutes: 4,
        changeDeadlineHours: 337,
        area: base({ lat: 91, lon: -181 }),
      })
    ),
    {
      publicActive: 'Bitte auswählen.',
      staffActive: 'Bitte auswählen.',
      maintenance: 'Bitte auswählen.',
      pendingHoldMinutes: 'Bitte eine ganze Zahl von 5 bis 1440 angeben.',
      changeDeadlineHours: 'Bitte eine ganze Zahl von 0 bis 336 angeben.',
      'area.base.lat': 'Bitte eine Zahl von -90 bis 90 angeben.',
      'area.base.lon': 'Bitte eine Zahl von -180 bis 180 angeben.',
    }
  );
  for (const pendingHoldMinutes of [5.5, '60', undefined, 1441]) {
    assert.deepEqual(fields(settings({ pendingHoldMinutes })), {
      pendingHoldMinutes: 'Bitte eine ganze Zahl von 5 bis 1440 angeben.',
    });
  }
  assert.equal(
    validateNikolausSettings(settings({ pendingHoldMinutes: 5, changeDeadlineHours: 0 }))
      .changeDeadlineHours,
    0
  );
  assert.deepEqual(fields(settings({ area: area({ farDistanceKm: 0.05 }) })), {
    'area.farDistanceKm': 'Bitte eine Zahl von 0.1 bis 1000 angeben.',
  });
  assert.deepEqual(fields(settings({ area: area({ farDistanceKm: '8' }) })), {
    'area.farDistanceKm': 'Bitte eine Zahl von 0.1 bis 1000 angeben.',
  });
  assert.equal(
    validateNikolausSettings(settings({ area: area({ farDistanceKm: 0.1 }) })).area.farDistanceKm,
    0.1
  );
});

test('the days of the visit report per day and field', () => {
  const day = (patch: Record<string, unknown>) =>
    fields(settings({ days: [{ ...DAY, ...patch }] }));
  assert.deepEqual(day({ date: '2026-02-30' }), {
    'days.0.date': 'Bitte ein gültiges Datum angeben.',
  });
  assert.deepEqual(day({ date: 5 }), { 'days.0.date': 'Bitte ein gültiges Datum angeben.' });
  assert.deepEqual(day({ start: '9:00' }), {
    'days.0.start': 'Bitte eine Uhrzeit (HH:MM) angeben.',
  });
  assert.deepEqual(day({ start: '25:00', end: '24:00' }), {
    'days.0.start': 'Bitte eine Uhrzeit (HH:MM) angeben.',
    'days.0.end': 'Bitte eine Uhrzeit (HH:MM) angeben.',
  });
  assert.deepEqual(day({ end: undefined }), {
    'days.0.end': 'Bitte eine Uhrzeit (HH:MM) angeben.',
  });
  assert.deepEqual(day({ end: '17:15' }), {
    'days.0.end': 'Das Ende muss mindestens 30 Minuten nach dem Beginn liegen.',
  });
  assert.deepEqual(day({ end: '16:00' }), {
    'days.0.end': 'Das Ende muss mindestens 30 Minuten nach dem Beginn liegen.',
  });
  assert.deepEqual(day({ end: '20:45' }), {
    'days.0.end': 'Die Zeit muss in Termine zu 30 Minuten aufgehen.',
  });
  assert.deepEqual(day({ date: 'x', end: '17:10' }), {
    'days.0.date': 'Bitte ein gültiges Datum angeben.',
    'days.0.end': 'Das Ende muss mindestens 30 Minuten nach dem Beginn liegen.',
  });
  for (const teams of [0, 5, 1.5, '2', undefined]) {
    assert.deepEqual(day({ teams }), {
      'days.0.teams': 'Bitte eine ganze Zahl von 1 bis 4 angeben.',
    });
  }
  const short = { ...DAY, teams: 4, end: '17:30' };
  assert.deepEqual(validateNikolausSettings(settings({ days: [short] })).days, [short]);
  assert.deepEqual(fields(settings({ days: [DAY, 'x'] })), {
    'days.1.date': 'Bitte ein gültiges Datum angeben.',
    'days.1.start': 'Bitte eine Uhrzeit (HH:MM) angeben.',
    'days.1.end': 'Bitte eine Uhrzeit (HH:MM) angeben.',
    'days.1.teams': 'Bitte eine ganze Zahl von 1 bis 4 angeben.',
  });
});

test('the list of days is limited and without duplicates', () => {
  assert.deepEqual(fields(settings({ days: 'x' })), { days: 'Bitte die Besuchstage angeben.' });
  assert.deepEqual(
    fields(
      settings({
        days: Array.from({ length: 11 }, (_, i) => ({ ...DAY, date: `2026-12-${10 + i}` })),
      })
    ),
    { days: 'Höchstens 10 Besuchstage.' }
  );
  assert.deepEqual(
    fields(settings({ days: [DAY, { ...DAY, start: '18:00' }, { ...DAY, date: '2026-12-06' }] })),
    {
      'days.1.date': 'Dieser Tag ist schon eingetragen.',
    }
  );
  assert.deepEqual(fields(settings({ publicActive: true, days: [] })), {
    days: 'Ohne Besuchstag kann die Online-Anmeldung nicht aktiv sein.',
  });
  assert.deepEqual(fields(settings({ publicActive: true, days: [], maintenance: 'x' })), {
    days: 'Ohne Besuchstag kann die Online-Anmeldung nicht aktiv sein.',
    maintenance: 'Bitte auswählen.',
  });
  assert.deepEqual(validateNikolausSettings(settings({ publicActive: false, days: [] })).days, []);
});

test('the service area needs a name and five-digit postal codes', () => {
  assert.deepEqual(fields(settings({ area: base({ name: '  ' }) })), {
    'area.base.name': 'Bitte einen Namen angeben.',
  });
  assert.deepEqual(fields(settings({ area: base({ name: 'x'.repeat(101) }) })), {
    'area.base.name': 'Bitte einen Namen angeben.',
  });
  assert.deepEqual(fields(settings({ area: base({ name: 5 }) })), {
    'area.base.name': 'Bitte einen Namen angeben.',
  });
  assert.equal(
    validateNikolausSettings(settings({ area: base({ name: 'x'.repeat(100) }) })).area.base.name
      .length,
    100
  );
  const postal = { 'area.servicePostalCodes': 'Bitte fünfstellige Postleitzahlen angeben.' };
  for (const servicePostalCodes of [
    '83620',
    [],
    ['8362'],
    ['83620', 83052],
    ['836200'],
    Array.from({ length: 31 }, (_, i) => `${10000 + i}`),
  ]) {
    assert.deepEqual(fields(settings({ area: area({ servicePostalCodes }) })), postal);
  }
  assert.deepEqual(fields(settings({ area: area({ servicePostalCodes: undefined }) })), postal);
  assert.equal(
    validateNikolausSettings(
      settings({
        area: area({ servicePostalCodes: Array.from({ length: 30 }, (_, i) => `${10000 + i}`) }),
      })
    ).area.servicePostalCodes.length,
    30
  );
});

test('the contact of the day needs a name and a phone number together', () => {
  const contact = (value: unknown) => fields(settings({ dayContact: value }));
  const name = 'Bitte einen Namen mit höchstens 100 Zeichen angeben.';
  const phone = 'Bitte eine Telefonnummer angeben, z. B. 0170 1234567.';
  assert.deepEqual(contact({ name: 'Max' }), { 'dayContact.phone': phone });
  assert.deepEqual(contact({ phone: '0170 1234567' }), { 'dayContact.name': name });
  assert.deepEqual(contact({ name: 'x'.repeat(101), phone: '0170 1234567' }), {
    'dayContact.name': name,
  });
  assert.deepEqual(contact({ name: 'Max', phone: 5 }), { 'dayContact.phone': phone });
  assert.deepEqual(contact({ name: 5, phone: '0170 1234567' }), { 'dayContact.name': name });
  for (const number of ['abc12345', '12345', '(+)(+)(+)', '+49', '1'.repeat(31), '0170-12a']) {
    assert.deepEqual(contact({ name: 'Max', phone: number }), { 'dayContact.phone': phone });
  }
  for (const number of ['+49 170 1234567', '(0170) 123/45-67', '------1-2-3-4-5-6']) {
    assert.deepEqual(
      validateNikolausSettings(settings({ dayContact: { name: 'Max', phone: number } })).dayContact,
      { name: 'Max', phone: number }
    );
  }
});
