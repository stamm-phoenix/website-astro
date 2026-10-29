import type { Page } from '@playwright/test';
import { test, expect, expectNoHorizontalOverflow, answerConfirm } from './fixtures';
import { anlegen, pdfLaden } from './essensplanung-helpers';

interface Ansicht {
  tage: { mahlzeiten: { id: number }[] }[];
}

/** Sends a request of the Planung with the token of the page's link, as the page would. */
async function senden<T = Ansicht>(
  page: Page,
  method: 'POST' | 'GET',
  path: string,
  data?: object
): Promise<T> {
  const token = /[#&]t=([\w-]{43})/.exec(page.url())?.[1];
  expect(token, 'the link of the page').toBeTruthy();
  const antwort = await page.request.fetch(`/api/essensplanung/planung${path}`, {
    method,
    headers: { 'x-essensplanung-token': token!, 'content-type': 'application/json' },
    ...(data ? { data } : {}),
  });
  expect(antwort.ok(), await antwort.text()).toBeTruthy();
  return (await antwort.json()) as T;
}

/** Dishes with tools, planned at lunch on both days; the waffles are not planned. */
const GERICHTE: [string, string[]][] = [
  ['Chili', ['Großer Topf', 'Kochlöffel']],
  ['Suppe', [' großer  TOPF', 'Pürierstab']],
  ['Waffeln', ['Waffeleisen']],
];

/** Creates the dishes; Chili at lunch on both days and Suppe on the first, the rest unplanned. */
async function gerichteMitWerkzeugen(page: Page, gerichte = GERICHTE): Promise<void> {
  const ids: Record<string, number> = {};
  for (const [name, werkzeuge] of gerichte) {
    ids[name] = (
      await senden<{ id: number }>(page, 'POST', '/gerichte', {
        name,
        personen: 10,
        werkzeuge,
      })
    ).id;
  }
  const ansicht = await senden(page, 'GET', '');
  const [tag1, tag2] = ansicht.tage;
  for (const [mahlzeitId, gerichtId] of [
    [tag1.mahlzeiten[1].id, ids.Chili],
    [tag1.mahlzeiten[1].id, ids.Suppe],
    [tag2.mahlzeiten[1].id, ids.Chili],
  ]) {
    await senden(page, 'POST', '/einplanungen', { mahlzeitId, gerichtId });
  }
  await page.reload();
  await page.getByRole('tab', { name: 'Packliste' }).click();
}

test('the packing list merges the tools of planned dishes; packing goes in the row', async ({
  page,
}) => {
  await anlegen(page, 'E2E Packliste');
  await gerichteMitWerkzeugen(page);
  const liste = page.getByRole('list', { name: 'Packliste' });
  const zeile = (name: string) => liste.getByRole('listitem').filter({ hasText: name });

  // Same names once, with the dishes and their planned meals; unplanned dishes bring nothing
  await expect(liste.getByRole('listitem')).toHaveCount(3);
  await expect(zeile('Großer Topf')).toContainText('für Chili (1_2_1, 2_2_1) · Suppe (1_2_2)');
  await expect(zeile('Pürierstab')).toContainText('für Suppe (1_2_2)');
  await expect(liste).not.toContainText('Waffeleisen');
  await expect(page.getByText('Häkchen werden sofort gespeichert.')).toBeVisible();

  // Packed with one tick, saved at once
  await page.getByRole('checkbox', { name: 'Großer Topf' }).check();
  await expect(page.getByText('Großer Topf ist eingepackt.').first()).toBeVisible();
  await expect(zeile('Großer Topf')).toContainText('gepackt');

  // Who packs it: a member, or a free name typed in the row
  await page.getByLabel('Wer packt Kochlöffel ein?').selectOption({ label: 'Kim Küche' });
  await expect(page.getByText('Kim Küche packt Kochlöffel ein.').first()).toBeVisible();
  await page.getByLabel('Wer packt Pürierstab ein?').selectOption({ label: 'Anderer Name …' });
  const name = page.getByRole('textbox', { name: 'Wer packt Pürierstab ein?' });
  await expect(name).toBeFocused();
  await name.fill('Rover');
  await name.press('Enter');
  await expect(page.getByText('Rover packt Pürierstab ein.').first()).toBeVisible();
  await expect(page.getByLabel('Wer packt Pürierstab ein?')).toHaveValue('text');

  // Something of its own below the list, with Enter; a name on the list already is refused
  const neu = page.getByLabel('Noch etwas einpacken');
  await neu.fill('Gaskocher');
  await neu.press('Enter');
  await expect(zeile('Gaskocher')).toBeVisible();
  await expect(neu).toHaveValue('');
  await expect(neu).toBeFocused();
  await neu.fill('großer topf');
  await neu.press('Enter');
  await expect(
    page.getByRole('alert').filter({ hasText: 'Das steht schon auf der Packliste.' })
  ).toBeVisible();
  await expect(neu).toHaveValue('großer topf');
  await neu.fill('');

  // Filters: still to pack, and mine
  await page.getByRole('button', { name: 'Noch einpacken', exact: true }).click();
  await expect(liste.getByRole('listitem')).toHaveCount(3);
  await expect(liste).not.toContainText('Großer Topf');
  await page.getByRole('button', { name: 'Meine', exact: true }).click();
  await expect(liste.getByRole('listitem')).toHaveCount(1);
  await expect(liste).toContainText('Kochlöffel');
  await page.getByRole('button', { name: 'Alle', exact: true }).click();
  await expect(liste.getByRole('listitem')).toHaveCount(4);
  await expectNoHorizontalOverflow(page);

  const pdf = await pdfLaden(page, () =>
    page.getByRole('button', { name: 'Packliste als PDF' }).click()
  );
  expect(pdf.name).toBe('Packliste E2E Packliste.pdf');
  expect(pdf.text).toContain('Großer Topf');
  expect(pdf.text).toContain('Chili (1_2_1, 2_2_1) · Suppe (1_2_2)');
  expect(pdf.text).toContain('Gaskocher');
  expect(pdf.text).toContain('Rover');
  expect(pdf.text).not.toContain('Waffeleisen');

  // An entry of its own goes again, a tool stays
  await expect(page.getByRole('button', { name: 'Großer Topf entfernen' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Gaskocher entfernen' }).click();
  await answerConfirm(page, 'Gaskocher von der Packliste nehmen?', 'Entfernen');
  await expect(zeile('Gaskocher')).toHaveCount(0);
  await expect(liste.getByRole('listitem')).toHaveCount(3);
});

test('two people pack at once; the read-only link shows the list without changing it', async ({
  page,
  browser,
}) => {
  await anlegen(page, 'E2E Packliste zu zweit');
  await gerichteMitWerkzeugen(page);
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Packliste' }).click();

  // This page does not hear of the other one's tick before it changes the same tool
  await page.route('**/api/essensplanung/planung/stand*', (route) => route.abort());
  await anderes.getByRole('checkbox', { name: 'Großer Topf' }).check();
  await expect(anderes.getByText('Großer Topf ist eingepackt.').first()).toBeVisible();
  const wer = page.getByLabel('Wer packt Großer Topf ein?');
  await wer.selectOption({ label: 'Kim Küche' });
  await expect(page.getByText(/Jemand anderes hat das gerade geändert/).first()).toBeVisible();
  // The current state is shown, the choice is open again and goes through now
  await expect(page.getByRole('checkbox', { name: 'Großer Topf' })).toBeChecked();
  await expect(wer).toHaveValue('');
  await wer.selectOption({ label: 'Kim Küche' });
  await expect(page.getByText('Kim Küche packt Großer Topf ein.').first()).toBeVisible();
  await page.unroute('**/api/essensplanung/planung/stand*');
  await expect(anderes.getByLabel('Wer packt Großer Topf ein?')).toHaveValue(/^m:/, {
    timeout: 15_000,
  });
  await anderes.context().close();

  // The read-only link
  await page.getByRole('tab', { name: 'Mitglieder' }).click();
  await page.getByRole('button', { name: 'Link erzeugen', exact: true }).nth(1).click();
  const links = page
    .locator('.copy-code .font-mono')
    .filter({ hasText: '/essensplanung/planung#t=' });
  await expect(links).toHaveCount(2);
  const lesen = (await links.last().textContent())!.trim();
  const leser = await (await browser.newContext()).newPage();
  await leser.goto(lesen);
  await leser.getByRole('tab', { name: 'Packliste' }).click();
  const topf = leser
    .getByRole('list', { name: 'Packliste' })
    .getByRole('listitem')
    .filter({ hasText: 'Großer Topf' });
  await expect(topf).toContainText('gepackt');
  await expect(topf).toContainText('Zuständig: Kim Küche');
  await expect(leser.getByRole('checkbox')).toHaveCount(0);
  await expect(leser.getByLabel('Noch etwas einpacken')).toHaveCount(0);
  await expect(leser.getByRole('button', { name: 'Packliste als PDF' })).toBeVisible();
  await leser.context().close();
});

test('names that differ in signs have their own box; a typed name that failed is kept', async ({
  page,
}) => {
  await anlegen(page, 'E2E Packliste Zeichen');
  await gerichteMitWerkzeugen(page, [
    ['Chili', ['Grill-Zange']],
    ['Suppe', ['Grill Zange']],
  ]);
  const liste = page.getByRole('list', { name: 'Packliste' });
  await expect(liste.getByRole('listitem')).toHaveCount(2);

  // A name typed below the list survives the maintenance mode, which hides the field
  const neu = page.getByLabel('Noch etwas einpacken');
  const wartung = async (an: boolean): Promise<void> => {
    await page.unroute('**/api/essensplanung/planung/stand?*');
    await page.route('**/api/essensplanung/planung/stand?*', async (route) => {
      const url = route
        .request()
        .url()
        .replace(/seit=[^&]*/, 'seit=0');
      const antwort = await route.fetch({ url });
      const json = await antwort.json();
      if (json.ansicht) json.ansicht.wartung = an;
      await route.fulfill({ response: antwort, json });
    });
  };
  await neu.fill('Gaskocher');
  await wartung(true);
  await expect(neu).toHaveCount(0, { timeout: 15_000 });
  await wartung(false);
  await expect(neu).toHaveValue('Gaskocher', { timeout: 15_000 });
  await page.unroute('**/api/essensplanung/planung/stand?*');
  await neu.fill('');

  // Box and name are one target of at least 44 px on a phone
  await page.setViewportSize({ width: 390, height: 844 });
  const flaeche = await liste
    .locator('label', { has: page.getByRole('checkbox', { name: 'Grill Zange', exact: true }) })
    .boundingBox();
  expect(flaeche!.height).toBeGreaterThanOrEqual(44);
  expect(flaeche!.width).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalOverflow(page);

  // The label of the one row ticks its own box
  await liste.getByText('Grill Zange', { exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Grill Zange', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Grill-Zange', exact: true })).not.toBeChecked();
  await expect(page.getByText('Grill Zange ist eingepackt.').first()).toBeVisible();

  // A free name whose save failed stays, also when a filter hides its row for a while
  await page.route('**/api/essensplanung/planung/packliste/werkzeug', (route) => route.abort());
  await page.getByLabel('Wer packt Grill-Zange ein?').selectOption({ label: 'Anderer Name …' });
  const name = page.getByRole('textbox', { name: 'Wer packt Grill-Zange ein?' });
  await name.fill('Rover');
  await name.press('Enter');
  await expect(page.getByText(/Das hat nicht geklappt/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Gepackt', exact: true }).click();
  await expect(liste.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Alle', exact: true }).click();
  await expect(name).toHaveValue('Rover');

  // Leaving asks first
  await page.getByRole('link', { name: 'Impressum' }).first().click();
  const frage = page.getByRole('dialog', { name: 'Änderungen verwerfen?' });
  await expect(frage).toBeVisible();
  await frage.getByRole('button', { name: 'Weiter bearbeiten' }).click();
  await expect(name).toHaveValue('Rover');

  // Saved, it asks no more
  await page.unroute('**/api/essensplanung/planung/packliste/werkzeug');
  await name.press('Enter');
  await expect(page.getByText('Rover packt Grill-Zange ein.').first()).toBeVisible();
  await expect(page.getByLabel('Wer packt Grill-Zange ein?')).toHaveValue('text');
  await page.getByRole('link', { name: 'Impressum' }).first().click();
  await expect(page).toHaveURL(/impressum/);
});
