import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationError } from '../lib/validation/errors';
import {
  validateAnhang,
  validateKonversationId,
  validateStatus,
  validateZustaendig,
} from '../lib/validation/postfach';

const ID = 'AAQkADAwATM0MDAAMS1hZDA2LTAwAi0wMAoAEAA=';

function fields(work: () => unknown): Record<string, string> {
  try {
    work();
  } catch (error: unknown) {
    assert.ok(error instanceof ValidationError);
    return error.fields;
  }
  assert.fail('expected a ValidationError');
}

test('a responsibility needs a conversation, a login or null, and the name shown before', () => {
  assert.deepEqual(validateZustaendig({ konversation: ID, login: ' Lea@Stamm-Phoenix.de ' }), {
    konversation: ID,
    login: 'lea@stamm-phoenix.de',
    vorher: null,
  });
  assert.deepEqual(validateZustaendig({ konversation: ID, login: null, vorher: ' Lea Leitung ' }), {
    konversation: ID,
    login: null,
    vorher: 'Lea Leitung',
  });
  assert.match(
    fields(() => validateZustaendig({ konversation: ID, login: null, vorher: 'x'.repeat(201) }))
      .vorher,
    /Zuständigkeit/
  );
  assert.match(
    fields(() => validateZustaendig({ konversation: "x' or 1", login: null })).konversation,
    /Konversation/
  );
  assert.match(
    fields(() => validateZustaendig({ konversation: ID, login: 'kein login' })).login,
    /Person/
  );
});

test('ids from the query string are checked before Graph is asked', () => {
  assert.equal(validateKonversationId(ID), ID);
  assert.match(fields(() => validateKonversationId(null)).konversation, /Konversation/);
  assert.deepEqual(validateAnhang(ID, ID), { nachricht: ID, anhang: ID });
  assert.match(fields(() => validateAnhang(ID, '../x')).anhang, /Anhang/);
});

test('a status is one of the three and names the one shown before and the newest message seen', () => {
  const bis = '2026-11-03T10:00:00.000Z';
  assert.deepEqual(validateStatus({ konversation: ID, status: 'erledigt', vorher: 'neu', bis }), {
    konversation: ID,
    status: 'erledigt',
    vorher: 'neu',
    bis,
  });
  assert.match(
    fields(() => validateStatus({ konversation: ID, status: 'offen', vorher: 'neu', bis })).status,
    /Stand/
  );
  assert.match(
    fields(() => validateStatus({ konversation: ID, status: 'neu', bis })).vorher,
    /Stand/
  );
  assert.match(
    fields(() =>
      validateStatus({ konversation: ID, status: 'erledigt', vorher: 'neu', bis: 'gestern' })
    ).bis,
    /Stand/
  );
});
