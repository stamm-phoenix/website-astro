import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationError } from '../lib/validation/errors';
import {
  validateProtokollEditorCreate,
  validateProtokollEditorSave,
  validateProtokollSperre,
} from '../lib/validation/protokoll-editor';
import { inhalt } from './fixtures/protokoll-inhalt';

const TOKEN = 'tab-a-0123456789abcdef';

function fields(run: () => unknown): Record<string, string> {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return assert.fail('Expected a ValidationError.');
}

test('new minutes: trimmed title, date and optional start', () => {
  assert.deepEqual(
    validateProtokollEditorCreate({ title: '  Leitenden   runde ', date: '2026-10-14' }),
    { title: 'Leitenden runde', date: '2026-10-14', beginn: '' }
  );
  assert.equal(
    validateProtokollEditorCreate({ title: 'A', date: '2026-10-14', beginn: '07:05' }).beginn,
    '07:05'
  );
  assert.equal(
    validateProtokollEditorCreate({ title: 'A', date: '2026-10-14', beginn: null }).beginn,
    ''
  );
});

test('new minutes: messages per field', () => {
  assert.deepEqual(
    fields(() => validateProtokollEditorCreate(null)),
    {
      title: 'Bitte einen Titel angeben.',
      date: 'Bitte das Datum der Sitzung angeben.',
    }
  );
  assert.deepEqual(
    fields(() =>
      validateProtokollEditorCreate({ title: 'x'.repeat(201), date: '2026-02-30', beginn: '25:00' })
    ),
    {
      title: 'einen Titel darf höchstens 200 Zeichen lang sein.',
      date: 'Bitte das Datum der Sitzung angeben.',
      beginn: 'Bitte eine Uhrzeit wie 19:30 angeben.',
    }
  );
  assert.equal(
    fields(() => validateProtokollEditorCreate({ title: 5, date: 5 })).title,
    'einen Titel ist ungültig.'
  );
  // A start that is no text is read as missing
  assert.equal(
    validateProtokollEditorCreate({ title: 'A', date: '2026-10-14', beginn: 5 }).beginn,
    ''
  );
});

test('the lock request: token, takeover and active item', () => {
  assert.deepEqual(validateProtokollSperre({ token: TOKEN }), {
    token: TOKEN,
    uebernehmen: false,
    aktiverPunkt: null,
  });
  assert.deepEqual(
    validateProtokollSperre({ token: TOKEN, uebernehmen: true, aktiverPunkt: 'p-1', fremd: 1 }),
    { token: TOKEN, uebernehmen: true, aktiverPunkt: 'p-1' }
  );
  assert.equal(validateProtokollSperre({ token: TOKEN, uebernehmen: 'true' }).uebernehmen, false);
  assert.equal(validateProtokollSperre({ token: TOKEN, aktiverPunkt: null }).aktiverPunkt, null);
});

test('the lock request: messages per field', () => {
  const token = 'Die Sitzung des Editors ist ungültig.';
  const punkt = 'Der aktive Tagesordnungspunkt ist ungültig.';
  for (const body of [null, {}, { token: 'kurz' }, { token: 5 }, { token: `${TOKEN}!` }]) {
    assert.deepEqual(
      fields(() => validateProtokollSperre(body)),
      { token }
    );
  }
  for (const aktiverPunkt of ['Gross', 5, '', 'x'.repeat(41)]) {
    assert.deepEqual(
      fields(() => validateProtokollSperre({ token: TOKEN, aktiverPunkt })),
      {
        aktiverPunkt: punkt,
      }
    );
  }
});

test('a save: the whole document with its version', () => {
  const body = {
    token: TOKEN,
    uebernehmen: true,
    aktiverPunkt: 'p-1',
    etag: ' "v1" ',
    title: ' Leitendenrunde ',
    date: '2026-10-14',
    inhalt: inhalt(),
    sicherung: 'ueberschreiben',
  };
  assert.deepEqual(validateProtokollEditorSave(body), {
    token: TOKEN,
    uebernehmen: true,
    aktiverPunkt: 'p-1',
    etag: '"v1"',
    title: 'Leitendenrunde',
    date: '2026-10-14',
    inhalt: inhalt(),
    sicherung: 'ueberschreiben',
  });
  assert.equal(validateProtokollEditorSave({ ...body, sicherung: undefined }).sicherung, null);
  assert.equal(validateProtokollEditorSave({ ...body, sicherung: null }).sicherung, null);
  assert.equal(
    validateProtokollEditorSave({ ...body, sicherung: 'wiederherstellen' }).sicherung,
    'wiederherstellen'
  );
});

test('a save: messages per field', () => {
  const valid = {
    token: TOKEN,
    etag: '"v1"',
    title: 'Leitendenrunde',
    date: '2026-10-14',
    inhalt: inhalt(),
  };
  assert.deepEqual(
    fields(() => validateProtokollEditorSave(null)),
    {
      token: 'Die Sitzung des Editors ist ungültig.',
      etag: 'Bitte Die Version angeben.',
      title: 'Bitte einen Titel angeben.',
      date: 'Bitte das Datum der Sitzung angeben.',
      inhalt: 'Der Inhalt fehlt.',
    }
  );
  assert.deepEqual(
    fields(() =>
      validateProtokollEditorSave({
        ...valid,
        etag: 'x'.repeat(101),
        sicherung: 'egal',
        aktiverPunkt: 'Gross',
      })
    ),
    {
      etag: 'Die Version darf höchstens 100 Zeichen lang sein.',
      sicherung: 'Die Sicherung ist ungültig.',
      aktiverPunkt: 'Der aktive Tagesordnungspunkt ist ungültig.',
    }
  );
  const broken = inhalt();
  broken.punkte[0].titel = 'a\nb';
  assert.deepEqual(
    fields(() => validateProtokollEditorSave({ ...valid, inhalt: broken })),
    {
      inhalt: 'Der Titel eines Tagesordnungspunkts enthält ungültige Zeichen.',
    }
  );
});
