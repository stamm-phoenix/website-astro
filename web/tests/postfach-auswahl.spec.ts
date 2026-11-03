import type { Page } from '@playwright/test';
import { test, expect, expectNoHorizontalOverflow } from './fixtures';

/** Choosing several conversations of the Kontakt-Postfach and changing them at once. */

const NEWSLETTER = /Newsletter Diözesanverband/;
const RECHNUNG = /Rechnung Zeltplatz Sommerlager/;

async function oeffnen(page: Page) {
  await page.goto('/leitendenbereich/email/kontakt');
  const liste = page.getByRole('region', { name: 'Posteingang' });
  await expect(liste.getByRole('link', { name: NEWSLETTER })).toBeVisible();
  return liste;
}

async function waehleBeide(page: Page) {
  const liste = page.getByRole('region', { name: 'Posteingang' });
  await liste.getByRole('checkbox', { name: NEWSLETTER }).check();
  await liste.getByRole('checkbox', { name: RECHNUNG }).check();
  const aktionen = liste.getByRole('region', { name: 'Aktionen für die Auswahl' });
  await expect(aktionen.getByText('2 E-Mails ausgewählt')).toBeVisible();
  return aktionen;
}

/** The projects share the demo server: both start open and without a responsible person. */
async function zuruecksetzen(page: Page) {
  const aktionen = await waehleBeide(page);
  await aktionen.getByRole('button', { name: 'Wieder offen' }).click();
  await expect(aktionen.getByText(/wieder als offen markiert/)).toBeVisible();
  await waehleBeide(page);
  await aktionen.getByRole('button', { name: 'Zuständigkeit entfernen' }).click();
  await expect(aktionen.getByText(/Zuständigkeit für 2 E-Mails entfernt/)).toBeVisible();
}

test('the list shows all mails with their state; several are marked as done at once', async ({
  page,
}) => {
  const liste = await oeffnen(page);
  // „Alle“ is where the page starts
  await expect(liste.getByRole('button', { name: /^Alle/ })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await zuruecksetzen(page);
  await expect(liste.getByRole('link', { name: NEWSLETTER })).toContainText('Offen');
  await expect(liste.getByRole('link', { name: /Danke für das Sommerlager/ })).toContainText(
    'Kein Handlungsbedarf'
  );

  const aktionen = await waehleBeide(page);
  await expectNoHorizontalOverflow(page);
  await aktionen.getByRole('button', { name: 'Als erledigt markieren' }).click();
  await expect(aktionen.getByText('2 E-Mails als erledigt markiert.')).toBeVisible();
  // Done, the choice is empty again and both stay in „Alle“, ticked off
  await expect(liste.getByRole('checkbox', { name: NEWSLETTER })).not.toBeChecked();
  await expect(liste.getByRole('link', { name: NEWSLETTER })).toContainText('Erledigt · du');
  await expect(liste.getByRole('link', { name: RECHNUNG })).toContainText('Erledigt · du');

  await liste.getByRole('button', { name: /^Offen/ }).click();
  await expect(liste.getByRole('link', { name: NEWSLETTER })).toHaveCount(0);
  await liste.getByRole('button', { name: /^Alle/ }).click();
  await zuruecksetzen(page);
});

test('several mails are handed to one person at once', async ({ page }) => {
  const liste = await oeffnen(page);
  await zuruecksetzen(page);

  const aktionen = await waehleBeide(page);
  await aktionen.getByRole('button', { name: 'Jemandem zuweisen' }).click();
  await aktionen.getByLabel('Wer soll sich um die 2 E-Mails kümmern?').fill('Tom');
  await page.getByRole('option', { name: /Tom Test/ }).click();
  await expect(
    aktionen.getByText('Tom Test ist jetzt für 2 E-Mails zuständig und hat eine Mail bekommen.')
  ).toBeVisible();
  await expect(liste.getByRole('link', { name: NEWSLETTER })).toContainText('Tom Test');
  await expect(liste.getByRole('link', { name: RECHNUNG })).toContainText('Tom Test');
  await expectNoHorizontalOverflow(page);

  // „Alle auswählen“ takes what the filter shows
  await liste.getByRole('button', { name: /^Erledigt/ }).click();
  await liste.getByRole('checkbox', { name: /^Alle \d+ auswählen/ }).check();
  await expect(liste.getByRole('checkbox', { name: /Danke für das Sommerlager/ })).toBeChecked();
  await expect(liste.getByRole('checkbox', { name: NEWSLETTER })).toHaveCount(0);
  await liste
    .getByRole('region', { name: 'Aktionen für die Auswahl' })
    .getByRole('button', { name: 'Auswahl aufheben' })
    .click();
  await expect(liste.getByRole('checkbox', { name: /^Alle \d+ auswählen/ })).not.toBeChecked();

  await liste.getByRole('button', { name: /^Alle/ }).click();
  await zuruecksetzen(page);
});

test('while the chosen ones are saved, the choice stays as it is and the result counts them', async ({
  page,
}) => {
  const liste = await oeffnen(page);
  await zuruecksetzen(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/intern/postfach/kontakt/status', async (route) => {
    await held;
    await route.continue();
  });
  await liste.getByRole('checkbox', { name: NEWSLETTER }).check();
  const aktionen = liste.getByRole('region', { name: 'Aktionen für die Auswahl' });
  await aktionen.getByRole('button', { name: 'Als erledigt markieren' }).click();
  await expect(aktionen.getByText('Wird gespeichert …')).toBeVisible();
  // Nothing can be added or taken away before the answer is there
  await expect(liste.getByRole('checkbox', { name: RECHNUNG })).toBeDisabled();
  await expect(liste.getByRole('checkbox', { name: /^Alle \d+ auswählen/ })).toBeDisabled();
  release();
  await expect(aktionen.getByText('1 E-Mail als erledigt markiert.')).toBeVisible();
  await expect(liste.getByRole('link', { name: RECHNUNG })).toContainText('Offen');
  await expect(liste.getByRole('checkbox', { name: RECHNUNG })).toBeEnabled();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await zuruecksetzen(page);
});

test('a mail someone opened again meanwhile is not confirmed as done', async ({ page }) => {
  const liste = await oeffnen(page);
  await zuruecksetzen(page);
  await liste.getByRole('checkbox', { name: NEWSLETTER }).check();
  const aktionen = liste.getByRole('region', { name: 'Aktionen für die Auswahl' });
  await aktionen.getByRole('button', { name: 'Als erledigt markieren' }).click();
  await expect(aktionen.getByText('1 E-Mail als erledigt markiert.')).toBeVisible();

  // Someone else opens it again; this page still shows it done
  const antwort = await page.request.put('/api/intern/postfach/kontakt/status', {
    data: {
      konversation: 'AAQkADemoKonv04',
      status: 'offen',
      vorher: 'erledigt',
      bis: new Date().toISOString(),
    },
  });
  expect(antwort.ok()).toBe(true);
  await expect(liste.getByRole('link', { name: NEWSLETTER })).toContainText('Erledigt');

  await liste.getByRole('checkbox', { name: NEWSLETTER }).check();
  await aktionen.getByRole('button', { name: 'Als erledigt markieren' }).click();
  await expect(aktionen.getByText('0 von 1 E-Mail als erledigt markiert.')).toBeVisible();
  await expect(aktionen.getByRole('alert')).toContainText('Newsletter Diözesanverband');
  await expect(liste.getByRole('checkbox', { name: NEWSLETTER })).toBeChecked();
  // The list is read again and shows what applies now
  await expect(liste.getByRole('link', { name: NEWSLETTER })).toContainText('Offen');
  await aktionen.getByRole('button', { name: 'Auswahl aufheben' }).click();
  await zuruecksetzen(page);
});
