import type { Locator, Page } from '@playwright/test';
import { test, expect, expectNoHorizontalOverflow, answerConfirm } from './fixtures';
import { anlegen, zeilenMenge } from './essensplanung-helpers';

/** The AI at dishes with the demo AI of the mock API (`dev/mock-data/essensplanung-ki.ts`). */

async function gericht(page: Page, name: string, personen: string): Promise<Locator> {
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill(name);
  await page.locator('#gericht-neu-personen').fill(personen);
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText(`${name} angelegt.`).first()).toBeVisible();
  return page.locator('li', { has: page.getByText(name, { exact: true }) }).first();
}

test('a pasted recipe becomes lines after checking the preview', async ({ page }) => {
  await anlegen(page, 'E2E KI Rezept');
  const karte = await gericht(page, 'Spaghetti Napoli', '8');
  await karte.getByRole('button', { name: 'Rezept einfügen (KI)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rezept für Spaghetti Napoli' });
  // No explaining text in the dialog; the rule for the text is behind the (i) of the field
  await expect(dialog.getByText(/Die KI liest die Zutaten/)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Erklärung zu Rezept' }).click();
  await expect(dialog.getByText(/Bitte keine Namen oder Kontaktdaten einfügen/)).toBeVisible();
  await dialog
    .getByLabel('Rezept', { exact: true })
    .fill(
      'Für 4 Personen\n500 g Spaghetti\n2 EL Olivenöl\n2 Zwiebeln\n1 Prise Salz\n3 Stück Drachenfrucht'
    );
  await dialog.getByRole('button', { name: 'Zutaten erkennen' }).click();

  // Scaled from 4 to 8 people and converted into the unit of the ingredient
  await expect(dialog.getByText('Die Mengen sind von 4 auf 8 Personen umgerechnet.')).toBeVisible();
  const zeilen = dialog.getByTestId('rezept-zeile');
  await expect(zeilen).toHaveCount(5);
  await expect(dialog.getByLabel('Zutat für 500 g Spaghetti')).toHaveValue('Nudeln (Spaghetti)');
  await expect(dialog.getByLabel('Menge für 500 g Spaghetti')).toHaveValue('1000');
  await expect(dialog.getByLabel('Menge für 2 EL Olivenöl')).toHaveValue('60');
  await expect(dialog.getByLabel('Einheit für 2 EL Olivenöl')).toHaveValue('ml');
  await expect(dialog.getByLabel('Menge für 2 Zwiebeln')).toHaveValue('332');
  await expect(dialog.getByLabel('Hinweis für 1 Prise Salz')).toHaveValue('1 Prise');
  // Unknown: marked and left out until something of the list is chosen
  const frucht = zeilen.filter({ hasText: '3 Stück Drachenfrucht' });
  await expect(frucht.getByText('nicht in der Liste, bitte wählen')).toBeVisible();
  await expect(frucht.getByRole('checkbox')).toBeDisabled();
  // Converted into ml; the recipe's own amount can be taken instead, and back
  const olivenoel = 'Für 2 EL Olivenöl stattdessen';
  await dialog.getByRole('button', { name: `${olivenoel} 4 EL übernehmen` }).click();
  await expect(dialog.getByLabel('Menge für 2 EL Olivenöl')).toHaveValue('4');
  await expect(dialog.getByLabel('Einheit für 2 EL Olivenöl')).toHaveValue('EL');
  await expect(dialog.getByRole('button', { name: `${olivenoel} 60 ml übernehmen` })).toBeVisible();
  // Chosen for an ingredient in g without a weight per piece: never „6 g“, the pieces stay
  await dialog.getByLabel('Zutat für 3 Stück Drachenfrucht').fill('Zucker (weiß)');
  await dialog.getByRole('option', { name: 'Zucker (weiß)' }).click();
  await expect(dialog.getByLabel('Menge für 3 Stück Drachenfrucht')).toHaveValue('6');
  await expect(dialog.getByLabel('Einheit für 3 Stück Drachenfrucht')).toHaveValue('Stück');
  await expect(dialog.getByLabel('Hinweis für 3 Stück Drachenfrucht')).toHaveValue('');
  await expect(frucht.getByRole('checkbox')).toBeChecked();
  await expect(dialog.getByRole('button', { name: '5 Zutaten übernehmen' })).toBeVisible();
  // A line can be left out
  await dialog.getByRole('checkbox', { name: '1 Prise Salz übernehmen' }).uncheck();
  await dialog.getByLabel('Menge für 2 Zwiebeln').fill('300');
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole('button', { name: '4 Zutaten übernehmen' }).click();

  await expect(page.getByText('4 Zutaten übernommen.').first()).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => zeilenMenge(karte, 'Nudeln (Spaghetti)')).toBe('1000 g');
  await expect.poll(() => zeilenMenge(karte, 'Olivenöl')).toBe('4 EL');
  await expect.poll(() => zeilenMenge(karte, 'Zwiebeln')).toBe('300 g');
  await expect(karte.getByLabel('Menge von Salz', { exact: true })).toHaveCount(0);
  await expect.poll(() => zeilenMenge(karte, 'Zucker (weiß)')).toBe('6 Stück');
});

test('checking a dish lists hints, and a proposal is taken over with a click', async ({ page }) => {
  await anlegen(page, 'E2E KI Prüfen');
  const karte = await gericht(page, 'Chili', '10');
  await expect(karte.getByRole('button', { name: 'Gericht prüfen (KI)' })).toBeDisabled();
  await karte.getByRole('button', { name: 'Mehr Angaben …' }).click();
  const dialog = page.getByRole('dialog', { name: 'Zutat für Chili' });
  await dialog.getByLabel('Zutat', { exact: true }).fill('Hackfl');
  await dialog.getByRole('option', { name: 'Hackfleisch' }).click();
  await dialog.getByLabel('Menge', { exact: true }).fill('500');
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect.poll(() => zeilenMenge(karte, 'Hackfleisch')).toBe('500 g');

  await karte.getByRole('button', { name: 'Gericht prüfen (KI)' }).click();
  const hinweise = karte.getByRole('status').filter({ hasText: 'KI-Hinweise zu Chili' });
  await expect(hinweise.getByText('Von der KI erzeugt und ungeprüft.')).toBeVisible();
  await expect(hinweise.getByText('Die Menge wirkt für 10 Personen knapp.')).toBeVisible();
  await expect(hinweise.getByText('Salz fehlt vielleicht.')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await hinweise
    .getByRole('button', { name: 'Vorschlag für Hackfleisch übernehmen: 1.000 g' })
    .click();
  await expect(page.getByText('Vorschlag für Hackfleisch übernommen.').first()).toBeVisible();
  await expect.poll(() => zeilenMenge(karte, 'Hackfleisch')).toBe('1000 g');
  await hinweise
    .getByRole('button', {
      name: 'Vorschlag für Hackfleisch übernehmen: nicht für vegetarisch, nicht für vegan',
    })
    .click();
  await expect(karte.getByText('nur mit allem')).toBeVisible();
  await expect(hinweise.getByText('Übernommen.')).toHaveCount(2);
  await hinweise.getByRole('button', { name: 'Ausblenden' }).click();
  await expect(hinweise).toHaveCount(0);

  // A busy deployment: the page says so with the wait, and everything else keeps working
  const suppe = await gericht(page, 'Suppe KI-Fehler', '10');
  await suppe.getByRole('button', { name: 'Mehr Angaben …' }).click();
  const zweiter = page.getByRole('dialog', { name: 'Zutat für Suppe KI-Fehler' });
  await zweiter.getByLabel('Zutat', { exact: true }).fill('Zwiebeln');
  await zweiter.getByRole('option', { name: 'Zwiebeln', exact: true }).click();
  await zweiter.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(suppe.getByLabel('Menge von Zwiebeln', { exact: true })).toBeVisible();
  await suppe.getByRole('button', { name: 'Gericht prüfen (KI)' }).click();
  await expect(
    suppe.getByRole('alert').filter({ hasText: 'KI gerade nicht verfügbar' })
  ).toContainText('in etwa 30 Sekunden');
  await suppe.getByRole('button', { name: 'Zwiebeln entfernen' }).click();
  await answerConfirm(page, 'Zwiebeln entfernen?', 'Entfernen');
  await expect(suppe.getByText('Noch keine Zutaten.')).toBeVisible();
});

test('grams without a value in the list are estimated by the AI, marked as such', async ({
  page,
}) => {
  await anlegen(page, 'E2E KI Umrechnen');
  const karte = await gericht(page, 'Pudding', '10');
  await karte.getByRole('button', { name: 'Mehr Angaben …' }).click();
  const dialog = page.getByRole('dialog', { name: 'Zutat für Pudding' });
  // Salt has TL and EL in the list, but no weight per piece
  await dialog.getByLabel('Zutat', { exact: true }).fill('Salz');
  await dialog.getByRole('option', { name: 'Salz', exact: true }).click();
  await expect(dialog.getByRole('group', { name: /In Gramm umrechnen/ })).toBeVisible();
  const schaetzen = dialog.getByRole('group', { name: /In Gramm schätzen lassen \(KI\)/ });
  await expect(schaetzen.getByLabel('Maß zum Schätzen').locator('option')).toHaveText(['Stück']);
  // Sugar has no values at all
  await dialog.getByLabel('Zutat', { exact: true }).fill('Zucker (weiß)');
  await dialog.getByRole('option', { name: 'Zucker (weiß)' }).click();
  await schaetzen.getByLabel('Anzahl zum Schätzen').fill('3');
  await schaetzen.getByLabel('Maß zum Schätzen').selectOption({ label: 'EL' });
  await schaetzen.getByRole('button', { name: 'Schätzen lassen', exact: true }).click();
  await expect(schaetzen.getByText('KI-Schätzung, ungeprüft:')).toBeVisible();
  await expect(schaetzen.getByText(/1 EL ≈ 12 g · 3 EL ≈ 36 g/)).toBeVisible();
  await schaetzen.getByRole('button', { name: '36 g übernehmen' }).click();
  await expect(dialog.getByLabel('Menge', { exact: true })).toHaveValue('36');
  await expect(dialog.getByLabel('Einheit', { exact: true })).toHaveValue('g');
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => zeilenMenge(karte, 'Zucker (weiß)')).toBe('36 g');
});
