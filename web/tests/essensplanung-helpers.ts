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
  // The first load of the page compiles it in the dev server
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 });
}

/**
 * Plans a dish at a meal by typing its name into the meal (`kennung` like `1_2`): an existing
 * dish is planned, a new name creates it there. Closes the fields again.
 */
export async function einplanen(
  page: Page,
  kennung: string,
  gericht: string,
  zustaendig = ''
): Promise<void> {
  await page
    .getByRole('button', { name: new RegExp(`^Gericht eintragen bei ${kennung} `) })
    .first()
    .click();
  const feld = page.getByLabel(new RegExp(`^Gericht bei ${kennung} `)).filter({ visible: true });
  await feld.fill(gericht);
  if (zustaendig)
    await page
      .getByLabel(`Zuständig für das Gericht bei ${kennung}`)
      .filter({ visible: true })
      .fill(zustaendig);
  await feld.press('Enter');
  await expect(page.getByText(new RegExp(`bei ${kennung} eingeplant\\.`)).first()).toBeVisible();
  // Escape closes the suggestions first, then the fields
  await feld.press('Escape');
  if (await feld.isVisible()) await feld.press('Escape');
  await expect(feld).toHaveCount(0);
}

/** Unfolds a planned dish (`kennung` like `1_2_1`): its actions, amounts and what it used. */
export async function aufklappen(page: Page, kennung: string, name: string): Promise<void> {
  const knopf = page.getByRole('button', { name: `Mehr zu ${kennung} ${name}` });
  if ((await knopf.getAttribute('aria-expanded')) !== 'true') await knopf.click();
}

/** Opens the amounts a planned dish used, to tick it off with other amounts or change them. */
export async function verbrauchOeffnen(page: Page, kennung: string, name: string): Promise<void> {
  await aufklappen(page, kennung, name);
  const teil = page.getByLabel(
    new RegExp(`^Verbrauch von ${name} bei ${kennung} (eintragen|ändern|ansehen)$`)
  );
  if (!(await teil.evaluate((summary) => (summary.parentElement as HTMLDetailsElement).open)))
    await teil.click();
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
