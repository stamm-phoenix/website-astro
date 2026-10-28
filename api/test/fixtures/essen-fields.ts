import assert from 'node:assert/strict';
import { ValidationError } from '../../lib/validation/errors';

/** The field errors a validation throws. */
export function fields(work: () => unknown): Record<string, string> {
  try {
    work();
  } catch (error: unknown) {
    assert.ok(error instanceof ValidationError);
    return error.fields;
  }
  return assert.fail('expected a validation error');
}
