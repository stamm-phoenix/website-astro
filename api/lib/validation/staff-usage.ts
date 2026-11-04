import { z } from 'zod';
import { lenientObject, parseWith } from './zod';
import { STAFF_USAGE_MODULES } from '../staff-usage-model';
const schema = lenientObject({
  module: z.enum(STAFF_USAGE_MODULES, { error: 'Der Bereich ist ungültig.' }),
});
export function validateStaffUsage(body: unknown): string {
  return parseWith(schema, body).module;
}
