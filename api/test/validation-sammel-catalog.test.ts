import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateSammelCampaign,
  validateSammelCatalog,
  validateSammelMessage,
  validateSammelStatus,
} from '../lib/sammelbestellung-validation';
import { ValidationError } from '../lib/validation/errors';

function fields(run: () => unknown): Record<string, string> {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return assert.fail('Expected a ValidationError.');
}

const textMessage = (max: number): string =>
  `Bitte gib einen Text mit höchstens ${max} Zeichen ein.`;
const STAMM = 'Bitte wähle einen Stammesartikel aus dem Katalog.';

const ARTICLE = { reference: '123', name: 'Zelt', variants: ['S', ' M '] };

test('catalog articles are normalised', () => {
  assert.deepEqual(validateSammelCatalog([]), []);
  assert.deepEqual(validateSammelCatalog([{ ...ARTICLE, extra: 1 }]), [
    { reference: '123', name: 'Zelt', variants: ['S', 'M'] },
  ]);
  assert.deepEqual(validateSammelCatalog([{ ...ARTICLE, shop: 'eschwege' }]), [
    { reference: '123', name: 'Zelt', variants: ['S', 'M'], shop: 'eschwege' },
  ]);
  assert.deepEqual(
    validateSammelCatalog([{ reference: 'stamm-halstuch', name: 1, variants: ['x'] }]),
    [{ reference: 'stamm-halstuch', name: 'Stamm Phoenix Halstuch', variants: [], shop: 'stamm' }]
  );
});

test('the catalog reports what is wrong with it', () => {
  const catalog = (max: number): string => `Bitte wähle höchstens ${max} häufige Artikel aus.`;
  for (const value of [undefined, null, 'x', {}])
    assert.deepEqual(
      fields(() => validateSammelCatalog(value)),
      { catalog: catalog(50) }
    );
  assert.deepEqual(
    fields(() => validateSammelCatalog(Array(51).fill(ARTICLE))),
    {
      catalog: catalog(50),
    }
  );
  for (const row of [null, 'x', []])
    assert.deepEqual(
      fields(() => validateSammelCatalog([row])),
      { form: 'Bitte prüfe die Eingaben.' }
    );
  for (const variants of [undefined, 'S', null, Array(41).fill('S')])
    assert.deepEqual(
      fields(() => validateSammelCatalog([{ ...ARTICLE, variants }])),
      {
        variants: 'Bitte prüfe die Größen und Varianten.',
      }
    );
  for (const variant of ['', ' ', 5, 'x'.repeat(121)])
    assert.deepEqual(
      fields(() => validateSammelCatalog([{ ...ARTICLE, variants: [variant] }])),
      {
        variants: textMessage(120),
      }
    );
  assert.deepEqual(
    fields(() => validateSammelCatalog([{ ...ARTICLE, name: '' }])),
    {
      name: textMessage(200),
    }
  );
  assert.deepEqual(
    fields(() => validateSammelCatalog([{ ...ARTICLE, reference: 'stamm-x' }])),
    {
      reference: STAMM,
    }
  );
  assert.deepEqual(
    fields(() => validateSammelCatalog([{ ...ARTICLE, shop: 'x' }])),
    {
      shop: 'Bitte wähle Rüsthaus oder Ausrüster Eschwege.',
    }
  );
  const wide = Array.from({ length: 50 }, (_, index) => ({
    reference: `${index}`,
    name: 'n'.repeat(200),
    variants: Array(40).fill('v'.repeat(120)),
  }));
  assert.deepEqual(
    fields(() => validateSammelCatalog(wide)),
    {
      catalog: 'Die Artikelauswahl ist zu umfangreich. Bitte kürze die Größen oder Beschreibungen.',
    }
  );
});

const CAMPAIGN = {
  title: ' Winterlager ',
  startsAt: '2026-10-01T10:00:00.000Z',
  endsAt: '2026-10-31T10:00:00.000Z',
  catalog: [ARTICLE],
};

test('a campaign is normalised and starts unarchived', () => {
  assert.deepEqual(validateSammelCampaign({ ...CAMPAIGN, description: ' Lager ', extra: 1 }), {
    title: 'Winterlager',
    description: 'Lager',
    startsAt: CAMPAIGN.startsAt,
    endsAt: CAMPAIGN.endsAt,
    catalog: [{ reference: '123', name: 'Zelt', variants: ['S', 'M'] }],
    archived: false,
  });
  assert.equal(validateSammelCampaign(CAMPAIGN).description, '');
});

test('a campaign reports what is wrong with it', () => {
  const instant = 'Bitte gib einen gültigen Zeitpunkt ein.';
  for (const value of [
    '2026-10-01',
    '2026-10-01T10:00:00Z',
    '2026-10-01T10:00:00.000+02:00',
    '2026-02-30T10:00:00.000Z',
    '2026-13-01T10:00:00.000Z',
    '',
    5,
  ]) {
    const message = value === '' || value === 5 ? textMessage(30) : instant;
    assert.deepEqual(
      fields(() => validateSammelCampaign({ ...CAMPAIGN, startsAt: value })),
      {
        startsAt: message,
      }
    );
    assert.deepEqual(
      fields(() => validateSammelCampaign({ ...CAMPAIGN, endsAt: value })),
      {
        endsAt: message,
      }
    );
  }
  for (const endsAt of [CAMPAIGN.startsAt, '2026-09-30T10:00:00.000Z'])
    assert.deepEqual(
      fields(() => validateSammelCampaign({ ...CAMPAIGN, endsAt })),
      {
        endsAt: 'Das Ende muss nach dem Beginn liegen.',
      }
    );
  assert.deepEqual(
    fields(() => validateSammelCampaign({ ...CAMPAIGN, title: ' ' })),
    {
      title: textMessage(200),
    }
  );
  assert.deepEqual(
    fields(() => validateSammelCampaign({ ...CAMPAIGN, description: 'x'.repeat(2001) })),
    { description: textMessage(2000) }
  );
  assert.deepEqual(
    fields(() => validateSammelCampaign({ ...CAMPAIGN, catalog: 'x' })),
    {
      catalog: 'Bitte wähle höchstens 50 häufige Artikel aus.',
    }
  );
});

test('the staff status of an order is checked against its processing', () => {
  const base = { status: 'Bestellt', paid: false, delivered: false, totalCents: null };
  assert.deepEqual(validateSammelStatus({ ...base, extra: 1 }), base);
  assert.deepEqual(validateSammelStatus({ ...base, totalCents: 10_000_000, paid: true }), {
    ...base,
    totalCents: 10_000_000,
    paid: true,
  });
  assert.deepEqual(
    validateSammelStatus({ ...base, status: 'Eingetroffen', delivered: true, totalCents: 0 }),
    { ...base, status: 'Eingetroffen', delivered: true, totalCents: 0 }
  );
  for (const status of ['Bezahlt', undefined, null, 3])
    assert.deepEqual(
      fields(() => validateSammelStatus({ ...base, status })),
      {
        status: 'Bitte wähle einen gültigen Status.',
      }
    );
  for (const patch of [
    { paid: 'true' },
    { paid: undefined },
    { delivered: 1 },
    { delivered: null },
  ])
    assert.deepEqual(
      fields(() => validateSammelStatus({ ...base, ...patch })),
      {
        form: 'Bitte prüfe Bezahlstatus und Auslieferung.',
      }
    );
  for (const totalCents of [undefined, -1, 1.5, '5', 10_000_001, NaN, Number.MAX_SAFE_INTEGER + 1])
    assert.deepEqual(
      fields(() => validateSammelStatus({ ...base, totalCents })),
      {
        totalCents: 'Bitte gib einen gültigen Betrag an.',
      }
    );
  assert.deepEqual(
    fields(() => validateSammelStatus({ ...base, delivered: true })),
    {
      delivered: 'Nur eingetroffene Bestellungen können ausgeliefert werden.',
    }
  );
});

test('a staff message needs a subject and 1 to 5000 visible characters', () => {
  assert.deepEqual(
    validateSammelMessage({ subject: ' Hallo   Welt ', message: '<p>Text <b>fett</b></p>' }),
    {
      subject: 'Hallo Welt',
      messageHtml: '<p>Text <b>fett</b></p>',
    }
  );
  assert.deepEqual(
    fields(() => validateSammelMessage({ subject: ' ', message: 'x' })),
    { subject: textMessage(150) }
  );
  assert.deepEqual(
    fields(() => validateSammelMessage({ subject: 'x'.repeat(151), message: 'x' })),
    { subject: textMessage(150) }
  );
  for (const message of [undefined, 5, 'x'.repeat(30_001)])
    assert.deepEqual(
      fields(() => validateSammelMessage({ subject: 's', message })),
      {
        message: 'Bitte schreibe eine Nachricht mit höchstens 5000 Zeichen.',
      }
    );
  for (const message of ['', '   ', '<p></p>', '<script>x</script>', 'x'.repeat(5001)])
    assert.deepEqual(
      fields(() => validateSammelMessage({ subject: 's', message })),
      {
        message: 'Bitte schreibe eine Nachricht mit 1 bis 5000 Zeichen.',
      }
    );
});

test('rules across fields apply only once every field is valid', () => {
  assert.deepEqual(
    fields(() =>
      validateSammelCampaign({
        ...CAMPAIGN,
        startsAt: '2026-10-01T10:00:00Z',
        endsAt: '2026-09-01T10:00:00.000Z',
      })
    ),
    { startsAt: 'Bitte gib einen gültigen Zeitpunkt ein.' }
  );
  assert.deepEqual(
    fields(() =>
      validateSammelStatus({ status: 'Bestellt', paid: false, delivered: true, totalCents: -1 })
    ),
    { totalCents: 'Bitte gib einen gültigen Betrag an.' }
  );
});
