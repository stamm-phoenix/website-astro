import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationError } from '../lib/validation/errors';
import {
  validateAnhang,
  validateGelesen,
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

test('marks take a list of message ids or all at once', () => {
  assert.deepEqual(validateGelesen({ alle: true }), { alle: true });
  assert.deepEqual(validateGelesen({ nachrichten: [ID, ID], gelesen: false }), {
    nachrichten: [ID],
    gelesen: false,
  });
  const viele = Array.from(
    { length: 200 },
    (_, index) => `AAkALg${String(index).padStart(6, '0')}`
  );
  assert.equal(
    (validateGelesen({ nachrichten: viele, gelesen: true }) as { nachrichten: string[] })
      .nachrichten.length,
    200
  );
  assert.match(
    fields(() => validateGelesen({ nachrichten: [...viele, 'AAkALg999999'], gelesen: true }))
      .nachrichten,
    /Zu viele/
  );
  assert.match(
    fields(() => validateGelesen({ nachrichten: [], gelesen: true })).nachrichten,
    /fehlen/
  );
  assert.match(
    fields(() => validateGelesen({ nachrichten: ['x y'], gelesen: true })).nachrichten,
    /ungültig/
  );
  assert.match(fields(() => validateGelesen({ nachrichten: [ID] })).gelesen, /Markierung/);
});

test('a responsibility needs a conversation and a login or null', () => {
  assert.deepEqual(validateZustaendig({ konversation: ID, login: ' Lea@Stamm-Phoenix.de ' }), {
    konversation: ID,
    login: 'lea@stamm-phoenix.de',
    vorher: null,
  });
  assert.deepEqual(
    validateZustaendig({ konversation: ID, login: null, vorher: 'lea@stamm-phoenix.de' }),
    {
      konversation: ID,
      login: null,
      vorher: 'lea@stamm-phoenix.de',
    }
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

test('a status is one of the three and names the one shown before', () => {
  assert.deepEqual(validateStatus({ konversation: ID, status: 'erledigt', vorher: 'offen' }), {
    konversation: ID,
    status: 'erledigt',
    vorher: 'offen',
  });
  assert.match(
    fields(() => validateStatus({ konversation: ID, status: 'fertig', vorher: 'offen' })).status,
    /Stand/
  );
  assert.match(fields(() => validateStatus({ konversation: ID, status: 'offen' })).vorher, /Stand/);
});
