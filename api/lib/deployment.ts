/**
 * The database of this deployment. `null` is production (`CONFIG.database.name`); the deploy
 * workflow overwrites this file for PR previews with their own database
 * (`scripts/db-preview.ts create <PR> --write-deployment`). Never commit another value.
 */
export const PREVIEW_DATABASE: string | null = null;
