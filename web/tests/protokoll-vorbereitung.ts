import type { Page } from '@playwright/test';
import { expect } from './fixtures';

/**
 * Creates minutes in the editor over the demo API instead of the list page, for tests whose
 * subject comes after creating them. The body is the one „Anlegen und schreiben“ sends
 * (`ProtokollEditorListe.svelte`): today in Berlin and the time of now as start.
 */

/** Opens the head data and lets the texts be typed as Markdown, as the editor tests expect. */
export async function editorBereit(page: Page): Promise<void> {
  await page.getByText(/^Sitzungsdaten und Teilnehmende bearbeiten/).click();
  await expect(page.getByRole('heading', { name: 'Kopfdaten' })).toBeVisible();
  // These tests type Markdown into the plain fields; the formatting editor has its own tests
  await page
    .getByRole('group', { name: 'Texte schreiben als' })
    .getByRole('button', { name: 'Einfacher Text (Markdown)' })
    .click();
  await expect(page.getByLabel('Text zu Punkt 1.')).toHaveAttribute('rows', '2');
}

/** Creates the minutes `title` and opens them for writing. */
export async function protokollAnlegen(page: Page, title: string): Promise<void> {
  const jetzt = new Date();
  const antwort = await page.request.post('/api/intern/pflege/protokoll-editor', {
    data: {
      title,
      date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(jetzt),
      // The time of the browser, as the page sends it
      beginn: `${String(jetzt.getHours()).padStart(2, '0')}:${String(jetzt.getMinutes()).padStart(2, '0')}`,
    },
  });
  expect(antwort.ok(), `${antwort.status()} ${await antwort.text()}`).toBe(true);
  const { id } = (await antwort.json()) as { id: number };
  await page.goto(`/leitendenbereich/protokolle/protokoll?id=${id}&bearbeiten=1`);
}

/** Creates the minutes `title`, ready for Markdown in the head data; returns the URL of their page. */
export async function protokollVorbereiten(page: Page, title: string): Promise<string> {
  await protokollAnlegen(page, title);
  await editorBereit(page);
  return page.url();
}
