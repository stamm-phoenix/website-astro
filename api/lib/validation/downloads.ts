/** Validation of the file names and upload requests of the Downloads. */
import { z } from 'zod';
import { isJpeg } from '../jpeg';
import { MAX_PHOTO_BYTES, MAX_UPLOAD_BYTES } from './constants';
import { parseWith } from './zod';

/**
 * Media types by file extension. The type is never taken from the browser: the website serves
 * the files from its own origin, so an uploaded file must not become a web page or a script.
 */
export { downloadMimeType } from '../download-file-name';

/** Size of the parts a download is uploaded in; the last part may be smaller. */
export const UPLOAD_PART_BYTES = 4 * 1024 * 1024;

const NAME_MISSING = 'Bitte einen Dateinamen angeben.';

const fileNameSchema = z
  .string({ error: NAME_MISSING })
  .refine((name) => name.trim().length > 0, { error: NAME_MISSING })
  .refine((name) => name.length <= 200, {
    error: 'Der Dateiname darf höchstens 200 Zeichen lang sein.',
  })
  .refine((name) => !/["*:<>?/\\|#%]/.test(name) && !name.startsWith('.') && !name.endsWith('.'), {
    error: 'Der Dateiname darf keines dieser Zeichen enthalten: " * : < > ? / \\ | # %',
  })
  .refine((name) => /\.[a-z0-9]{1,8}$/i.test(name), {
    error: 'Der Dateiname braucht eine Dateiendung.',
  });

/** Returns an error message for an unsuitable file name, or undefined if it is fine. */
export function checkFileName(name: unknown): string | undefined {
  const result = fileNameSchema.safeParse(name);
  return result.success ? undefined : result.error.issues[0]?.message;
}

/** The name as typed in the form: surrounding blanks do not count. */
const uploadFileName = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() : ''),
  fileNameSchema
);

const SIZE_MISSING = 'Die Größe der Datei fehlt. Lade sie noch einmal hoch.';
const PREVIEW_INVALID = 'Das Vorschaubild ist kein JPEG oder größer als 2 MB.';

/** Only `true` replaces a file; anything else asks first. */
const replaceFlag = z
  .unknown()
  .optional()
  .transform((value) => value === true);

const startSchema = z.object({
  fileName: uploadFileName,
  size: z
    .number({ error: 'Die Datei ist leer oder größer als 250 MB.' })
    .refine((size) => size > 0 && size <= MAX_UPLOAD_BYTES, {
      error: 'Die Datei ist leer oder größer als 250 MB.',
    }),
  replace: replaceFlag,
});

const completeSchema = z.object({
  fileName: uploadFileName,
  size: z
    .number({ error: SIZE_MISSING })
    .refine((size) => Number.isInteger(size) && size > 0, { error: SIZE_MISSING }),
  // The preview is a JPEG as base64; a missing or empty one means none
  preview: z
    .unknown()
    .optional()
    .transform((value): Uint8Array | undefined =>
      typeof value === 'string' && value ? Buffer.from(value, 'base64') : undefined
    )
    .refine((bytes) => !bytes || (bytes.length <= MAX_PHOTO_BYTES && isJpeg(bytes)), {
      error: PREVIEW_INVALID,
    }),
  replace: replaceFlag,
});

/** Topic of a file; left out or empty keeps the current one. */
const categorySchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''),
  z
    .string()
    .max(50, { error: 'Das Thema darf höchstens 50 Zeichen lang sein.' })
    .transform((value) => value || undefined)
);

const renameSchema = z.object({ fileName: uploadFileName, category: categorySchema });

function asBody(body: Record<string, unknown> | null): Record<string, unknown> {
  return body ?? {};
}

/** Name and size of a new upload; `replace` says that a file of the same name is replaced. */
export function validateUploadStart(
  body: Record<string, unknown> | null
): z.output<typeof startSchema> {
  return parseWith(startSchema, asBody(body));
}

/** The request that completes an upload; `preview` holds the decoded JPEG, if there is one. */
export function validateUploadComplete(
  body: Record<string, unknown> | null
): z.output<typeof completeSchema> {
  return parseWith(completeSchema, asBody(body));
}

/** The new name of a file and, if sent, its topic. */
export function validateDownloadRename(
  body: Record<string, unknown> | null
): z.output<typeof renameSchema> {
  return parseWith(renameSchema, asBody(body));
}
