/**
 * The database and blob container of this deployment. `null` is production
 * (`CONFIG.database.name`, `CONFIG.storage`); the deploy workflow overwrites this file for PR
 * previews with their own (`scripts/db-preview.ts create <PR> --write-deployment`). Never
 * commit other values.
 */
export const PREVIEW_DATABASE: string | null = null;
export const PREVIEW_CONTAINER: string | null = null;
