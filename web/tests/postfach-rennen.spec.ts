import { test, expect } from './fixtures';
import { requestSettled, settle } from './settle';

/** Answers that arrive late or out of order in the module „E-Mail“; each holds one back. */

test('a late assignment stays with its conversation when another one was opened meanwhile', async ({
  page,
}, testInfo) => {
  // Needs the list next to the open mail, to switch while the answer is still on its way
  test.skip(testInfo.project.name !== 'desktop', 'list and mail side by side only on desktop');
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/intern/postfach/kontakt/zustaendig', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/leitendenbereich/email/kontakt');
  const liste = page.getByRole('region', { name: 'Posteingang' });
  await liste.getByRole('link', { name: /Newsletter Diözesanverband/ }).click();
  const a = page.getByRole('article', { name: 'Newsletter Diözesanverband' });
  // A retry on the same demo server finds the mail already taken over
  const abgeben = a.getByRole('button', { name: 'Nicht mehr zuständig' });
  await expect(a.getByRole('region', { name: 'Zuständigkeit' })).toBeVisible();
  if (await abgeben.isVisible()) {
    await page.unroute('**/api/intern/postfach/kontakt/zustaendig');
    await abgeben.click();
    await expect(a.getByText('Noch niemand zuständig')).toBeVisible();
    await page.route('**/api/intern/postfach/kontakt/zustaendig', async (route) => {
      await held;
      await route.continue();
    });
  }
  await a.getByRole('button', { name: 'Ich kümmere mich' }).click();

  // B opens before the answer for A arrives
  await liste.getByRole('link', { name: /Rechnung Zeltplatz Sommerlager/ }).click();
  const b = page.getByRole('article', { name: 'Rechnung Zeltplatz Sommerlager' });
  await expect(b.getByText('Noch niemand zuständig')).toBeVisible();
  release();
  await expect(liste.getByRole('link', { name: /Newsletter Diözesanverband/ })).toContainText(
    'Dir zugewiesen'
  );
  await expect(b.getByText('Noch niemand zuständig')).toBeVisible();
  await expect(b.getByText('Du bist jetzt zuständig.')).toHaveCount(0);

  // A forwarded mail is offered in Outlook, the PDF as a download
  await expect(
    b.getByRole('link', { name: /Buchungsbestätigung in Outlook öffnen/ })
  ).toHaveAttribute('href', /^https:\/\/outlook\.office\.com\//);
  await expect(b.getByRole('link', { name: /Rechnung-2026-117\.pdf/ })).toHaveAttribute(
    'download',
    'Rechnung-2026-117.pdf'
  );
});

test('a late reload of another mailbox and an older answer of the same mail are dropped', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'switches through the sidebar of the desktop');
  await page.goto('/leitendenbereich/email/kontakt');
  const liste = page.getByRole('region', { name: 'Posteingang' });
  await liste.getByRole('link', { name: /Frage zum Nikolausdienst/ }).click();
  await expect(page.getByRole('article', { name: 'Frage zum Nikolausdienst' })).toBeVisible();

  // The first of two loads of the open mail answers last, with an outdated subject
  let releaseMail: () => void = () => undefined;
  const heldMail = new Promise<void>((resolve) => (releaseMail = resolve));
  let firstMail = true;
  let oldAnswered: () => void = () => undefined;
  const oldAnswer = new Promise<void>((resolve) => (oldAnswered = resolve));
  await page.route('**/api/intern/postfach/kontakt/konversation?*', async (route) => {
    if (!firstMail) return route.continue();
    firstMail = false;
    const response = await route.fetch();
    const body = await response.json();
    body.konversation.betreff = 'Veralteter Stand';
    await heldMail;
    await route.fulfill({ response, json: body });
    oldAnswered();
  });
  // Also hold the list of the first reload back
  let releaseList: () => void = () => undefined;
  const heldList = new Promise<void>((resolve) => (releaseList = resolve));
  let firstList = true;
  await page.route('**/api/intern/postfach/kontakt?frisch=1', async (route) => {
    if (firstList) {
      firstList = false;
      await heldList;
    }
    await route.continue();
  });
  const neuLaden = page.getByRole('button', { name: 'Neu laden' });
  await neuLaden.click();
  releaseList();
  await expect(page.getByText('Neu geladen.')).toBeVisible();
  const newer = page.waitForResponse((response) =>
    response.url().includes('/api/intern/postfach/kontakt/konversation?')
  );
  await neuLaden.click();
  await newer;
  releaseMail();
  await oldAnswer;
  await settle(page);
  await expect(page.getByRole('article', { name: 'Frage zum Nikolausdienst' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Veralteter Stand' })).toHaveCount(0);

  // A reload of the Kontakt-Postfach that answers after the switch keeps the Vorstand on screen
  let releaseKontakt: () => void = () => undefined;
  const heldKontakt = new Promise<void>((resolve) => (releaseKontakt = resolve));
  await page.unroute('**/api/intern/postfach/kontakt?frisch=1');
  await page.route('**/api/intern/postfach/kontakt?frisch=1', async (route) => {
    await heldKontakt;
    await route.continue();
  });
  await neuLaden.click();
  await page
    .getByRole('navigation', { name: 'Bereiche des Leitendenbereichs' })
    .getByRole('link', { name: 'Vorstand-Postfach' })
    .click();
  await expect(page.getByRole('heading', { name: 'Vorstand-Postfach', level: 1 })).toBeVisible();
  await expect(page.getByText('Im Posteingang liegt keine E-Mail.')).toBeVisible();
  const spaeteAntwort = requestSettled(page, (url) =>
    url.includes('/api/intern/postfach/kontakt?frisch=1')
  );
  releaseKontakt();
  await spaeteAntwort;
  await settle(page);
  await expect(page.getByText('Im Posteingang liegt keine E-Mail.')).toBeVisible();
});

test('a reload asked before an assignment does not bring the old line back', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'needs the list next to the open mail');
  await page.goto('/leitendenbereich/email/kontakt');
  const liste = page.getByRole('region', { name: 'Posteingang' });
  await liste.getByRole('group', { name: 'Stand' }).getByRole('button', { name: /^Alle/ }).click();
  await liste.getByRole('link', { name: /Rechnung Zeltplatz Sommerlager/ }).click();
  const mail = page.getByRole('article', { name: 'Rechnung Zeltplatz Sommerlager' });
  // Start from nobody, also on a retry
  const abgeben = mail.getByRole('button', {
    name: /Nicht mehr zuständig|Zuständigkeit entfernen/,
  });
  await expect(mail.getByRole('region', { name: 'Zuständigkeit' })).toBeVisible();
  if (await abgeben.isVisible()) {
    await abgeben.click();
    await expect(mail.getByText('Zuständigkeit entfernt.')).toBeVisible();
  }
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  let answered: () => void = () => undefined;
  const answer = new Promise<void>((resolve) => (answered = resolve));
  let fetched: () => void = () => undefined;
  const oldState = new Promise<void>((resolve) => (fetched = resolve));
  await page.route('**/api/intern/postfach/kontakt?frisch=1', async (route) => {
    // The answer holds the state before the assignment and arrives after it
    const response = await route.fetch();
    fetched();
    await held;
    await route.fulfill({ response });
    answered();
  });
  await page.getByRole('button', { name: 'Neu laden' }).click();
  await oldState;
  await mail.getByRole('button', { name: 'Ich kümmere mich' }).click();
  await expect(mail.getByText('Du bist jetzt zuständig.')).toBeVisible();
  release();
  await answer;
  await settle(page);
  await expect(liste.getByRole('link', { name: /Rechnung Zeltplatz Sommerlager/ })).toContainText(
    'Dir zugewiesen'
  );
});

test('a late status answer of a mailbox that was left keeps the new mailbox on screen', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'switches through the sidebar of the desktop');
  await page.goto('/leitendenbereich/email/kontakt');
  const liste = page.getByRole('region', { name: 'Posteingang' });
  await liste.getByRole('group', { name: 'Stand' }).getByRole('button', { name: /^Alle/ }).click();
  await liste.getByRole('link', { name: /Newsletter Diözesanverband/ }).click();
  const mail = page.getByRole('article', { name: 'Newsletter Diözesanverband' });
  const stand = mail.getByRole('group', { name: 'Stand' });
  await expect(stand).toBeVisible();
  const ziel =
    (await stand.getByRole('button', { name: 'Erledigt' }).getAttribute('aria-pressed')) === 'true'
      ? 'Neu'
      : 'Erledigt';
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  let answered: () => void = () => undefined;
  const answer = new Promise<void>((resolve) => (answered = resolve));
  await page.route('**/api/intern/postfach/kontakt/status', async (route) => {
    await held;
    await route.continue();
    answered();
  });
  // The list of the Vorstand is still on its way when the late answer arrives
  let releaseVorstand: () => void = () => undefined;
  const heldVorstand = new Promise<void>((resolve) => (releaseVorstand = resolve));
  await page.route(/\/api\/intern\/postfach\/vorstand$/, async (route) => {
    await heldVorstand;
    await route.continue();
  });
  await stand.getByRole('button', { name: ziel }).click();
  await page
    .getByRole('navigation', { name: 'Bereiche des Leitendenbereichs' })
    .getByRole('link', { name: 'Vorstand-Postfach' })
    .click();
  await expect(page.getByRole('heading', { name: 'Vorstand-Postfach', level: 1 })).toBeVisible();
  const statusAntwort = page.waitForResponse('**/api/intern/postfach/kontakt/status');
  release();
  await answer;
  await statusAntwort;
  await settle(page);
  releaseVorstand();
  await expect(page.getByText('Im Posteingang liegt keine E-Mail.')).toBeVisible();
});

test('a late reload answer does not undo a status just saved in the reading view', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the reload button sits next to the open mail');
  await page.goto('/leitendenbereich/email/kontakt');
  const liste = page.getByRole('region', { name: 'Posteingang' });
  await liste.getByRole('group', { name: 'Stand' }).getByRole('button', { name: /^Alle/ }).click();
  await liste.getByRole('link', { name: /Frage zum Nikolausdienst/ }).click();
  const mail = page.getByRole('article', { name: 'Frage zum Nikolausdienst' });
  const stand = mail.getByRole('group', { name: 'Stand' });
  await expect(stand).toBeVisible();
  if ((await stand.getByRole('button', { name: 'Neu' }).getAttribute('aria-pressed')) !== 'true') {
    await stand.getByRole('button', { name: 'Neu' }).click();
    await expect(mail.getByText('Wieder als neu markiert.')).toBeVisible();
  }
  // The reading view's reload fetches the open state and delivers it after the save
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  let fetched: () => void = () => undefined;
  const oldState = new Promise<void>((resolve) => (fetched = resolve));
  await page.route('**/api/intern/postfach/kontakt/konversation?*', async (route) => {
    const response = await route.fetch();
    fetched();
    await held;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await page.getByRole('button', { name: 'Neu laden' }).click();
  await oldState;
  await stand.getByRole('button', { name: 'Erledigt' }).click();
  await expect(mail.getByText('Erledigt und archiviert.')).toBeVisible();
  const spaeterStand = requestSettled(page, (url) =>
    url.includes('/api/intern/postfach/kontakt/konversation?')
  );
  release();
  await spaeterStand;
  await settle(page);
  await expect(stand.getByRole('button', { name: 'Erledigt' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  // New again for the next run
  await page.unroute('**/api/intern/postfach/kontakt/konversation?*');
  await stand.getByRole('button', { name: 'Neu' }).click();
  await expect(mail.getByText('Wieder als neu markiert.')).toBeVisible();
});

test('a late conflict of a mailbox that was left does not take the list over', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'switches through the sidebar of the desktop');
  await page.goto('/leitendenbereich/email/kontakt');
  const liste = page.getByRole('region', { name: 'Posteingang' });
  await liste.getByRole('group', { name: 'Stand' }).getByRole('button', { name: /^Alle/ }).click();
  await liste.getByRole('link', { name: /Newsletter Diözesanverband/ }).click();
  const stand = page
    .getByRole('article', { name: 'Newsletter Diözesanverband' })
    .getByRole('group', {
      name: 'Stand',
    });
  await expect(stand).toBeVisible();
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/intern/postfach/kontakt/status', async (route) => {
    await held;
    await route.fulfill({
      status: 409,
      json: { error: 'CONFLICT', code: 'CONFLICT', message: 'Jemand hat den Stand geändert.' },
    });
  });
  const ziel =
    (await stand.getByRole('button', { name: 'Erledigt' }).getAttribute('aria-pressed')) === 'true'
      ? 'Neu'
      : 'Erledigt';
  await stand.getByRole('button', { name: ziel }).click();
  await page
    .getByRole('navigation', { name: 'Bereiche des Leitendenbereichs' })
    .getByRole('link', { name: 'Vorstand-Postfach' })
    .click();
  await expect(page.getByText('Im Posteingang liegt keine E-Mail.')).toBeVisible();
  const konflikt = page.waitForResponse('**/api/intern/postfach/kontakt/status');
  release();
  await konflikt;
  await settle(page);
  await expect(page.getByRole('heading', { name: 'Vorstand-Postfach', level: 1 })).toBeVisible();
  await expect(page.getByText('Im Posteingang liegt keine E-Mail.')).toBeVisible();
});
