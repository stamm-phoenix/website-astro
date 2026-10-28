import { parseWith } from './zod';
import { protokollInhaltSchema } from './protokoll-inhalt-schema';
import type { ProtokollInhalt } from '../protokoll-editor-model';

export { protokollInhaltSchema };

/** The whole document of the editor, rebuilt from known fields only; errors show at `inhalt`. */
export function validateProtokollInhalt(value: unknown): ProtokollInhalt {
  return parseWith(protokollInhaltSchema, value, () => 'inhalt');
}
