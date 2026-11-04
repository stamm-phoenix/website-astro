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
  await expect(
    liste.getByRole('group', { name: 'Stand' }).getByRole('button', { name: /^Alle/ })
  ).toHaveAttribute('aria-pressed', 'true');
  // „Ungelesen“ is a switch on top of the two groups
  const ungelesen = liste.getByRole('button', { name: /^Ungelesen/ });
  await ungelesen.click();
  await expect(ungelesen).toHaveAttribute('aria-pressed', 'true');
  await ungelesen.click();
  await expect(ungelesen).toHaveAttribute('aria-pressed', 'false');
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

  await liste
    .getByRole('group', { name: 'Stand' })
    .getByRole('button', { name: /^Offen/ })
    .click();
  await expect(liste.getByRole('link', { name: NEWSLETTER })).toHaveCount(0);
  await liste.getByRole('group', { name: 'Stand' }).getByRole('button', { name: /^Alle/ }).click();
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

  // The same person again: nothing new for Tom, so no note is due and none is missing
  const nochmal = await waehleBeide(page);
  await nochmal.getByRole('button', { name: 'Jemandem zuweisen' }).click();
  await nochmal.getByLabel('Wer soll sich um die 2 E-Mails kümmern?').fill('Tom');
  await page.getByRole('option', { name: /Tom Test/ }).click();
  await expect(nochmal.getByText('Tom Test ist jetzt für 2 E-Mails zuständig.')).toBeVisible();
  await expect(nochmal.getByText(/Mail ging nicht raus/)).toHaveCount(0);

  // „Alle auswählen“ takes what the filter shows
  await liste
    .getByRole('group', { name: 'Stand' })
    .getByRole('button', { name: /^Erledigt/ })
    .click();
  await liste.getByRole('checkbox', { name: /^Alle \d+ auswählen/ }).check();
  await expect(liste.getByRole('checkbox', { name: /Danke für das Sommerlager/ })).toBeChecked();
  await expect(liste.getByRole('checkbox', { name: NEWSLETTER })).toHaveCount(0);
  await liste
    .getByRole('region', { name: 'Aktionen für die Auswahl' })
    .getByRole('button', { name: 'Auswahl aufheben' })
    .click();
  await expect(liste.getByRole('checkbox', { name: /^Alle \d+ auswählen/ })).not.toBeChecked();

  await liste.getByRole('group', { name: 'Stand' }).getByRole('button', { name: /^Alle/ }).click();
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

test('a late read mark leaves a reply unread that the list got meanwhile', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'list and mail side by side only on desktop');
  const SCHNUPPER = /Schnupperstunde für Mia/;
  let neuer = false;
  // The list read again after the failed action has a newer, unread reply of the open mail
  await page.route(
    (url) => url.pathname === '/api/intern/postfach/kontakt',
    async (route) => {
      const antwort = await route.fetch();
      const body = await antwort.json();
      if (neuer) {
        for (const zeile of body.konversationen) {
          if (zeile.id !== 'AAQkADemoKonv01') continue;
          zeile.am = new Date(Date.now() + 60_000).toISOString();
          zeile.ungelesen = 2;
          zeile.erledigung = null;
        }
      }
      await route.fulfill({ response: antwort, json: body });
    }
  );
  const liste = await oeffnen(page);
  // Start with the mail unread, as an earlier test may have read it
  await liste.getByRole('link', { name: SCHNUPPER }).click();
  const mail = page.getByRole('article', { name: 'Schnupperstunde für Mia' });
  await mail.getByRole('button', { name: 'Als ungelesen markieren' }).click();
  await expect(mail.getByText('Als ungelesen markiert.')).toBeVisible();
  await liste.getByRole('link', { name: NEWSLETTER }).click();
  await expect(page.getByRole('article', { name: 'Newsletter Diözesanverband' })).toBeVisible();

  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/intern/postfach/kontakt/gelesen', async (route) => {
    await held;
    await route.continue();
  });
  await liste.getByRole('link', { name: SCHNUPPER }).click();
  await expect(mail).toBeVisible();

  // A failed choice reads the list again while the read mark is still on its way
  neuer = true;
  await page.route('**/api/intern/postfach/kontakt/status', (route) =>
    route.fulfill({
      status: 409,
      json: { error: 'CONFLICT', code: 'CONFLICT', message: 'Jemand war schneller.' },
    })
  );
  await liste.getByRole('checkbox', { name: NEWSLETTER }).check();
  const aktionen = liste.getByRole('region', { name: 'Aktionen für die Auswahl' });
  await aktionen.getByRole('button', { name: 'Als erledigt markieren' }).click();
  await expect(aktionen.getByRole('alert')).toContainText('Jemand war schneller.');
  await expect(liste.getByRole('link', { name: SCHNUPPER })).toContainText('Ungelesen:');

  release();
  await page.waitForResponse('**/api/intern/postfach/kontakt/gelesen');
  await expect(liste.getByRole('link', { name: SCHNUPPER })).toContainText('Ungelesen:');
  await aktionen.getByRole('button', { name: 'Auswahl aufheben' }).click();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('after „Neu laden“ the choice of people follows the team', async ({ page }) => {
  let personen = [
    { login: 'leitung@example.test', name: 'Demo Leitung' },
    { login: 'tom.test@example.test', name: 'Tom Test' },
  ];
  await page.route('**/api/intern/postfach/kontakt/personen', (route) =>
    route.fulfill({ json: { personen } })
  );
  const liste = await oeffnen(page);
  await liste.getByRole('checkbox', { name: NEWSLETTER }).check();
  const aktionen = liste.getByRole('region', { name: 'Aktionen für die Auswahl' });
  const waehlen = async (name: string) => {
    await aktionen.getByRole('button', { name: 'Jemandem zuweisen' }).click();
    await aktionen.getByLabel(/Wer soll sich um die/).fill(name);
  };
  await waehlen('Tom');
  await expect(page.getByRole('option', { name: /Tom Test/ })).toBeVisible();
  await aktionen.getByRole('button', { name: 'Abbrechen' }).click();

  // Tom left the team, Nina joined
  personen = [
    { login: 'leitung@example.test', name: 'Demo Leitung' },
    { login: 'nina.neu@example.test', name: 'Nina Neu' },
  ];
  await page.getByRole('button', { name: 'Neu laden' }).click();
  await expect(page.getByText('Neu geladen.')).toBeVisible();
  await waehlen('Nina');
  await expect(page.getByRole('option', { name: /Nina Neu/ })).toBeVisible();
  await aktionen.getByLabel(/Wer soll sich um die/).fill('Tom');
  await expect(page.getByRole('option', { name: /Tom Test/ })).toHaveCount(0);
  await aktionen.getByRole('button', { name: 'Abbrechen' }).click();
  await aktionen.getByRole('button', { name: 'Auswahl aufheben' }).click();
});
