import { test, expect } from './fixtures';

/** A status answer that arrives after the list and the open mail already have a newer message. */

const RECHNUNG = /Rechnung Zeltplatz Sommerlager/;
const KONVERSATION = 'AAQkADemoKonv02';

test('a late „Erledigt“ does not close a conversation that got a newer message meanwhile', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'list and mail side by side only on desktop');
  let neuer = false;
  const spaeter = new Date(Date.now() + 60_000).toISOString();
  // After „Neu laden“ list and mail have a message newer than the mark that is on its way
  await page.route(
    (url) => url.pathname === '/api/intern/postfach/kontakt',
    async (route) => {
      const antwort = await route.fetch();
      const body = await antwort.json();
      if (neuer) {
        for (const zeile of body.konversationen) if (zeile.id === KONVERSATION) zeile.am = spaeter;
      }
      await route.fulfill({ response: antwort, json: body });
    }
  );
  await page.route(
    (url) => url.pathname === '/api/intern/postfach/kontakt/konversation',
    async (route) => {
      const antwort = await route.fetch();
      const body = await antwort.json();
      if (neuer && body.konversation?.id === KONVERSATION) body.konversation.am = spaeter;
      await route.fulfill({ response: antwort, json: body });
    }
  );

  await page.goto('/leitendenbereich/email/kontakt');
  const liste = page.getByRole('region', { name: 'Posteingang' });
  await liste.getByRole('link', { name: RECHNUNG }).click();
  const mail = page.getByRole('article', { name: 'Rechnung Zeltplatz Sommerlager' });
  const stand = mail.getByRole('group', { name: 'Stand' });
  const offen = stand.getByRole('button', { name: 'Offen' });
  await expect(stand).toBeVisible();
  if ((await offen.getAttribute('aria-pressed')) !== 'true') {
    await offen.click();
    await expect(mail.getByText('Wieder als offen markiert.')).toBeVisible();
  }

  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/intern/postfach/kontakt/status', async (route) => {
    await held;
    await route.continue();
  });
  await stand.getByRole('button', { name: 'Erledigt' }).click();

  neuer = true;
  await page.getByRole('button', { name: 'Neu laden' }).click();
  await expect(page.getByText('Neu geladen.')).toBeVisible();

  const gespeichert = page.waitForResponse('**/api/intern/postfach/kontakt/status');
  release();
  await gespeichert;
  // The mark covers only the older messages: both views keep the conversation open
  await expect(liste.getByRole('link', { name: RECHNUNG })).toContainText(
    'neue Nachricht nach „Erledigt“'
  );
  await expect(offen).toHaveAttribute('aria-pressed', 'true');

  // Back to open for the other tests on the shared demo server
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.reload();
  await page
    .getByRole('region', { name: 'Posteingang' })
    .getByRole('link', { name: RECHNUNG })
    .click();
  const wieder = page
    .getByRole('article', { name: 'Rechnung Zeltplatz Sommerlager' })
    .getByRole('group', { name: 'Stand' });
  await expect(wieder).toBeVisible();
  if ((await wieder.getByRole('button', { name: 'Offen' }).getAttribute('aria-pressed')) !== 'true')
    await wieder.getByRole('button', { name: 'Offen' }).click();
  await expect(wieder.getByRole('button', { name: 'Offen' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});
