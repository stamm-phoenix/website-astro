/**
 * The database, blob container and Playwright API of this deployment. `null` is production
 * (`CONFIG.database.name`, `CONFIG.storage`, `CONFIG.playwrightApi`); the deploy workflow
 * overwrites these values for PR previews (`scripts/db-preview.ts create <PR>
 * --write-deployment`, `scripts/playwright-preview.ts`). Never commit other values.
 */
export const PREVIEW_DATABASE: string | null = null;
export const PREVIEW_CONTAINER: string | null = null;
export const PREVIEW_PLAYWRIGHT_API: string | null = null;
