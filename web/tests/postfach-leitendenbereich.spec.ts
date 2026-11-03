import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test('a Leitende:r reads a mail of the Kontakt-Postfach, hands it on and finds the mails on the start page', async ({
  page,
}) => {
  // Take the mail over first: the projects share the demo server and an earlier run handed it on
  await page.goto('/leitendenbereich/email/kontakt');
  await page
    .getByRole('region', { name: 'Posteingang' })
    .getByRole('link', { name: /Frage zum Nikolausdienst/ })
    .click();
  const uebernehmen = page.getByRole('button', { name: 'Ich kümmere mich' });
  await expect(page.getByRole('article', { name: 'Frage zum Nikolausdienst' })).toBeVisible();
  if (await uebernehmen.isVisible()) await uebernehmen.click();
  await expect(page.getByText('Du bist zuständig')).toBeVisible();

  await page.goto('/leitendenbereich/');
  const karte = page.getByRole('region', { name: 'E-Mails' });
  await expect(karte.getByRole('link', { name: /Frage zum Nikolausdienst/ })).toContainText(
    'Dir zugewiesen'
  );

  await karte.getByRole('link', { name: /Frage zum Nikolausdienst/ }).click();
  await expect(page).toHaveURL(/\/leitendenbereich\/email\/kontakt#konversation=/);
  const mail = page.getByRole('article', { name: 'Frage zum Nikolausdienst' });
  await expect(mail.getByText('Du bist zuständig')).toBeVisible();
  // The answer from Outlook is part of the conversation
  await expect(mail.getByText('(aus dem Postfach gesendet)')).toBeVisible();
  await expect(mail.getByRole('link', { name: /In Outlook öffnen/ })).toHaveAttribute(
    'href',
    /^https:\/\/outlook\.office\.com\/mail\/kontakt%40stamm-phoenix\.de\/inbox\/id\//
  );

  await mail.getByRole('button', { name: 'Jemand anderem zuweisen' }).click();
  await mail.getByLabel('Wer soll sich kümmern?').fill('Tom');
  await page.getByRole('option', { name: /Tom Test/ }).click();
  await expect(
    mail.getByText('Tom Test ist jetzt zuständig und hat eine Mail bekommen.')
  ).toBeVisible();
  await expect(mail.getByText('Zuständig: Tom Test')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // The list shows the new person; the filter of own mails no longer has it
  const liste = page.getByRole('region', { name: 'Posteingang' });
  if (!(await liste.isVisible())) await page.getByRole('button', { name: /Zur Liste/ }).click();
  await expect(liste.getByRole('link', { name: /Frage zum Nikolausdienst/ })).toContainText(
    'Tom Test'
  );
  await liste.getByRole('button', { name: /Mir zugewiesen/ }).click();
  await expect(liste.getByRole('button', { name: /Mir zugewiesen/ })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(liste.getByRole('link', { name: /Frage zum Nikolausdienst/ })).toHaveCount(0);
});

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

test('marking unread right after opening is not undone by the automatic read mark', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/email/kontakt');
  const liste = page.getByRole('region', { name: 'Posteingang' });
  // Hold back the automatic read mark of the opening
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  let first = true;
  await page.route('**/api/intern/postfach/kontakt/gelesen', async (route) => {
    if (first) {
      first = false;
      await held;
    }
    await route.continue();
  });
  await liste.getByRole('link', { name: /Rechnung Zeltplatz Sommerlager/ }).click();
  const mail = page.getByRole('article', { name: 'Rechnung Zeltplatz Sommerlager' });
  await mail.getByRole('button', { name: 'Als ungelesen markieren' }).click();
  release();
  await expect(mail.getByText('Als ungelesen markiert.')).toBeVisible();

  // Loaded again from the server, the mail is still unread
  if (await page.getByRole('button', { name: /Zur Liste/ }).isVisible())
    await page.getByRole('button', { name: /Zur Liste/ }).click();
  await page.getByRole('button', { name: 'Neu laden' }).click();
  await expect(page.getByText('Neu geladen.')).toBeVisible();
  await expect(liste.getByRole('link', { name: /Rechnung Zeltplatz Sommerlager/ })).toContainText(
    'Ungelesen:'
  );
});

test('„Neu laden“ also reads the open conversation again', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'the reload button sits next to the open mail on desktop'
  );
  await page.goto('/leitendenbereich/email/kontakt');
  await page
    .getByRole('region', { name: 'Posteingang' })
    .getByRole('link', { name: /Frage zum Nikolausdienst/ })
    .click();
  await expect(page.getByRole('article', { name: 'Frage zum Nikolausdienst' })).toBeVisible();
  const reread = page.waitForRequest((request) =>
    request.url().includes('/api/intern/postfach/kontakt/konversation?id=')
  );
  await page.getByRole('button', { name: 'Neu laden' }).click();
  await reread;
  await expect(page.getByRole('article', { name: 'Frage zum Nikolausdienst' })).toBeVisible();
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
  await page.waitForTimeout(300);
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
  releaseKontakt();
  await page.waitForTimeout(500);
  await expect(page.getByText('Im Posteingang liegt keine E-Mail.')).toBeVisible();
});

test('a mail marked done is ticked off for everyone and leaves the start page', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/email/kontakt');
  const liste = page.getByRole('region', { name: 'Posteingang' });
  // Retries on the same demo server find it done already
  await liste.getByRole('button', { name: /^Alle/ }).click();
  await liste.getByRole('link', { name: /Schnupperstunde für Mia/ }).click();
  const mail = page.getByRole('article', { name: 'Schnupperstunde für Mia' });
  const stand = mail.getByRole('group', { name: 'Stand' });
  await expect(stand).toBeVisible();
  if (
    (await stand.getByRole('button', { name: 'Offen' }).getAttribute('aria-pressed')) !== 'true'
  ) {
    await stand.getByRole('button', { name: 'Offen' }).click();
    await expect(mail.getByText('Wieder als offen markiert.')).toBeVisible();
  }
  const uebernehmen = mail.getByRole('button', { name: 'Ich kümmere mich' });
  if (await uebernehmen.isVisible()) {
    await uebernehmen.click();
    await expect(mail.getByText('Du bist jetzt zuständig.')).toBeVisible();
  }

  await page.goto('/leitendenbereich/');
  const karte = page.getByRole('region', { name: 'E-Mails' });
  await expect(karte.getByRole('link', { name: /Schnupperstunde für Mia/ })).toBeVisible();
  await karte.getByRole('link', { name: /Schnupperstunde für Mia/ }).click();

  await mail
    .getByRole('group', { name: 'Stand' })
    .getByRole('button', { name: 'Erledigt' })
    .click();
  await expect(mail.getByText('Als erledigt markiert.')).toBeVisible();
  await expect(mail.getByText(/Erledigt von dir/)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  if (await page.getByRole('button', { name: /Zur Liste/ }).isVisible())
    await page.getByRole('button', { name: /Zur Liste/ }).click();
  // Under „Offen“ it is gone, under „Erledigt“ it is ticked off
  await liste.getByRole('button', { name: /^Offen/ }).click();
  await expect(liste.getByRole('link', { name: /Schnupperstunde für Mia/ })).toHaveCount(0);
  await liste.getByRole('button', { name: /^Erledigt/ }).click();
  await expect(liste.getByRole('link', { name: /Schnupperstunde für Mia/ })).toContainText(
    'Erledigt · du'
  );
  await expect(liste.getByRole('link', { name: /Danke für das Sommerlager/ })).toContainText(
    'Kein Handlungsbedarf · Lea Leitung'
  );

  await page.goto('/leitendenbereich/');
  await expect(
    page.getByRole('region', { name: 'E-Mails' }).or(page.getByTestId('nothing-open')).first()
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Schnupperstunde für Mia/ })).toHaveCount(0);

  // Open again, so the next run starts the same way
  await page.goto('/leitendenbereich/email/kontakt');
  await liste.getByRole('button', { name: /^Erledigt/ }).click();
  await liste.getByRole('link', { name: /Schnupperstunde für Mia/ }).click();
  await mail.getByRole('group', { name: 'Stand' }).getByRole('button', { name: 'Offen' }).click();
  await expect(mail.getByText('Wieder als offen markiert.')).toBeVisible();
});

test('a reload asked before an assignment does not bring the old line back', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'needs the list next to the open mail');
  await page.goto('/leitendenbereich/email/kontakt');
  const liste = page.getByRole('region', { name: 'Posteingang' });
  await liste.getByRole('button', { name: /^Alle/ }).click();
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
  await page.waitForTimeout(300);
  await expect(liste.getByRole('link', { name: /Rechnung Zeltplatz Sommerlager/ })).toContainText(
    'Dir zugewiesen'
  );
});

test('opening a mail with the keyboard moves the focus to its subject', async ({ page }) => {
  await page.goto('/leitendenbereich/email/kontakt');
  const link = page
    .getByRole('region', { name: 'Posteingang' })
    .getByRole('link', { name: /Frage zum Nikolausdienst/ });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Frage zum Nikolausdienst' })).toBeFocused();
});

test('a late status answer of a mailbox that was left keeps the new mailbox on screen', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'switches through the sidebar of the desktop');
  await page.goto('/leitendenbereich/email/kontakt');
  const liste = page.getByRole('region', { name: 'Posteingang' });
  await liste.getByRole('button', { name: /^Alle/ }).click();
  await liste.getByRole('link', { name: /Newsletter Diözesanverband/ }).click();
  const mail = page.getByRole('article', { name: 'Newsletter Diözesanverband' });
  const stand = mail.getByRole('group', { name: 'Stand' });
  await expect(stand).toBeVisible();
  const ziel =
    (await stand.getByRole('button', { name: 'Erledigt' }).getAttribute('aria-pressed')) === 'true'
      ? 'Offen'
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
  await page.waitForTimeout(300);
  releaseVorstand();
  await expect(page.getByText('Im Posteingang liegt keine E-Mail.')).toBeVisible();
});

test('marking done after a newer message arrived says so and saves nothing', async ({ page }) => {
  await page.goto('/leitendenbereich/email/kontakt');
  const liste = page.getByRole('region', { name: 'Posteingang' });
  await liste.getByRole('button', { name: /^Alle/ }).click();
  await liste.getByRole('link', { name: /Frage zum Nikolausdienst/ }).click();
  const mail = page.getByRole('article', { name: 'Frage zum Nikolausdienst' });
  const stand = mail.getByRole('group', { name: 'Stand' });
  await expect(stand).toBeVisible();
  if (
    (await stand.getByRole('button', { name: 'Offen' }).getAttribute('aria-pressed')) !== 'true'
  ) {
    await stand.getByRole('button', { name: 'Offen' }).click();
    await expect(mail.getByText('Wieder als offen markiert.')).toBeVisible();
  }
  // As if the page still showed an older state of the conversation
  await page.route('**/api/intern/postfach/kontakt/status', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    await route.continue({
      postData: JSON.stringify({ ...body, bis: '2020-01-01T00:00:00.000Z' }),
    });
  });
  await stand.getByRole('button', { name: 'Erledigt' }).click();
  await expect(mail.getByText(/ist eine neue Nachricht gekommen/)).toBeVisible();
  await expect(stand.getByRole('button', { name: 'Offen' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('a full inbox says that older mails are in Outlook instead of claiming all is done', async ({
  page,
}) => {
  await page.route(/\/api\/intern\/postfach\/kontakt$/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, begrenzt: true, konversationen: body.konversationen.slice(0, 1) },
    });
  });
  await page.goto('/leitendenbereich/email/kontakt');
  const liste = page.getByRole('region', { name: 'Posteingang' });
  await expect(liste.getByText('Hier stehen die neuesten 100 E-Mails.')).toBeVisible();
  await expect(liste.getByRole('link', { name: /Ältere in Outlook ansehen/ })).toHaveAttribute(
    'href',
    /^https:\/\/outlook\.office\.com\/mail\/kontakt%40stamm-phoenix\.de\//
  );
  await liste.getByRole('button', { name: /^Erledigt/ }).click();
  await expect(
    liste.getByText(
      /Unter den neuesten 100 E-Mails ist noch keine erledigt\. Ältere E-Mails siehst du in Outlook\./
    )
  ).toBeVisible();
});
