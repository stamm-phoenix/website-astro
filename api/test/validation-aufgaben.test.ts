import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTask, validateTemplate } from '../lib/aufgaben-validation';
import { ValidationError } from '../lib/validation/errors';

const input = {
  title: 'Zelte prüfen',
  description: '',
  assignee: 'alex@example.test',
  dueDate: '2026-10-11',
  projectId: null,
};
const templateInput = {
  title: 'Lager',
  items: [{ title: 'Zelte prüfen', description: '', assignee: '', daysBefore: 7 }],
};

test('task validation names the field and keeps the German messages', () => {
  const fields = (run: () => unknown): Record<string, string> => {
    try {
      run();
    } catch (error) {
      if (error instanceof ValidationError) return error.fields;
      throw error;
    }
    return assert.fail('Expected a ValidationError.');
  };
  assert.deepEqual(
    fields(() => validateTask(null)),
    { form: 'Bitte die Felder ausfüllen.' }
  );
  assert.deepEqual(
    fields(() => validateTask([])),
    { form: 'Bitte die Felder ausfüllen.' }
  );
  assert.deepEqual(
    fields(() => validateTask({ ...input, title: ' ', dueDate: '2026-02-29', projectId: '1' })),
    {
      title: 'Bitte 1 bis 200 Zeichen angeben.',
      dueDate: 'Bitte ein gültiges Datum angeben.',
      projectId: 'Bitte einen gültigen Eintrag auswählen.',
    }
  );
  assert.deepEqual(
    fields(() => validateTask({ ...input, description: {} })),
    {
      description: 'Bitte Text angeben.',
    }
  );
  assert.deepEqual(
    fields(() => validateTask({ ...input, assignees: [{ name: 'Alex', login: 'bad login' }] })),
    { assignee: 'Bitte einen gültigen Login auswählen.' }
  );
  assert.deepEqual(
    fields(() => validateTask({ ...input, assignees: Array(21).fill({ name: 'A' }) })),
    {
      assignee: 'Bitte höchstens 20 Personen auswählen.',
    }
  );
  assert.deepEqual(
    fields(() => validateTemplate({ ...templateInput, items: [] })),
    {
      items: 'Bitte 1 bis 50 Aufgaben angeben.',
    }
  );
  assert.deepEqual(
    fields(() =>
      validateTemplate({
        ...templateInput,
        items: [{ ...templateInput.items[0], title: '', daysBefore: 400 }],
      })
    ),
    {
      title: 'Bitte 1 bis 200 Zeichen angeben.',
      items: 'Der Abstand zum Aktionsdatum muss zwischen −366 und 366 Tagen liegen.',
    }
  );
  assert.equal(validateTask({ ...input, dueDate: '', projectId: undefined }).dueDate, null);
  assert.equal(validateTask({ ...input, projectId: undefined }).projectId, null);
  assert.equal(validateTask({ ...input, title: '  Zelte  ' }).title, 'Zelte');
});

test('a single fault keeps the field and message it had before the migration', () => {
  const fields = (run: () => unknown): Record<string, string> => {
    try {
      run();
    } catch (error) {
      if (error instanceof ValidationError) return error.fields;
      throw error;
    }
    return assert.fail('Expected a ValidationError.');
  };
  // A missing required text reports its range like an empty one; a wrong type says „Text“.
  assert.deepEqual(
    fields(() => validateTask({})),
    { title: 'Bitte 1 bis 200 Zeichen angeben.' }
  );
  assert.deepEqual(
    fields(() => validateTask({ ...input, title: 5 })),
    {
      title: 'Bitte Text angeben.',
    }
  );
  assert.deepEqual(
    fields(() => validateTask({ ...input, title: null })),
    {
      title: 'Bitte Text angeben.',
    }
  );
  // An entry that is no object is a fault of the whole form.
  assert.deepEqual(
    fields(() => validateTemplate({ ...templateInput, items: [null] })),
    {
      form: 'Bitte die Felder ausfüllen.',
    }
  );
  assert.deepEqual(
    fields(() => validateTask({ ...input, assignees: [null] })),
    {
      form: 'Bitte die Felder ausfüllen.',
    }
  );
  assert.deepEqual(
    fields(() =>
      validateTemplate({ ...templateInput, items: [{ ...templateInput.items[0], assignees: [1] }] })
    ),
    { form: 'Bitte die Felder ausfüllen.' }
  );
  assert.deepEqual(
    fields(() => validateTemplate({ ...templateInput, items: 'x' })),
    {
      items: 'Bitte 1 bis 50 Aufgaben angeben.',
    }
  );
  assert.deepEqual(
    fields(() => validateTask({ ...input, assignees: null })),
    {
      assignee: 'Bitte höchstens 20 Personen auswählen.',
    }
  );
});
