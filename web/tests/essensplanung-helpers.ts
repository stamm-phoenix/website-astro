import { readFile } from 'node:fs/promises';
import type { Download, Locator, Page } from '@playwright/test';
import { expect, expectNoHorizontalOverflow } from './fixtures';

/** Creates a Planung over the start page and the confirmation link the mock shows. */
export async function anlegen(page: Page, name: string): Promise<void> {
  await page.goto('/essensplanung');
  await expect(page.getByRole('heading', { name: 'Neue Planung anlegen' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByLabel('Name der Planung').fill(name);
  await page.getByLabel('Erster Tag').fill('2027-08-01');
  await page.getByLabel('Letzter Tag').fill('2027-08-02');
  await page.getByLabel('Dein Name').fill('Kim Küche');
  await page.getByLabel('Deine Mailadresse', { exact: true }).first().fill('kim@stamm-phoenix.de');
  await page.getByRole('button', { name: 'Link zum Anlegen schicken' }).click();
  await expect(page.getByRole('status').getByText(/Fast geschafft/)).toBeVisible();
  await page.getByRole('link', { name: 'Planung bestätigen' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

/** Downloads the PDF a button builds; its file name and its text, one line per text run. */
export async function pdfLaden(
  page: Page,
  klick: () => Promise<void>
): Promise<{ name: string; text: string; seiten: number; breiteste: number }> {
  const download: Promise<Download> = page.waitForEvent('download');
  await klick();
  const datei = await download;
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({
    data: new Uint8Array(await readFile(await datei.path())),
    verbosity: 0,
  }).promise;
  const teile: string[] = [];
  /** The right end of the widest text run in mm, to see that nothing runs off the page. */
  let breiteste = 0;
  for (let nummer = 1; nummer <= pdf.numPages; nummer++) {
    const inhalt = await (await pdf.getPage(nummer)).getTextContent();
    for (const item of inhalt.items) {
      if (!('str' in item)) continue;
      teile.push(item.str);
      breiteste = Math.max(breiteste, ((item.transform[4] + item.width) * 25.4) / 72);
    }
  }
  return {
    name: datei.suggestedFilename(),
    text: teile.join('\n'),
    seiten: pdf.numPages,
    breiteste,
  };
}

/** Amount and unit of a line of a dish as its row shows them while editing, „1,5 kg“. */
export async function zeilenMenge(bereich: Locator, name: string): Promise<string> {
  const menge = await bereich.getByLabel(`Menge von ${name}`, { exact: true }).inputValue();
  const einheit = await bereich.getByLabel(`Einheit von ${name}`, { exact: true }).inputValue();
  return menge ? `${menge} ${einheit.trim()}` : '';
}
