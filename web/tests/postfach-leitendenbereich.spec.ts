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

test('opening a mail with the keyboard moves the focus to its subject', async ({ page }) => {
  await page.goto('/leitendenbereich/email/kontakt');
  const link = page
    .getByRole('region', { name: 'Posteingang' })
    .getByRole('link', { name: /Frage zum Nikolausdienst/ });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Frage zum Nikolausdienst' })).toBeFocused();
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

test('a mailbox that failed on the start page offers a retry or names whom to tell', async ({
  page,
}) => {
  let gesperrt = false;
  await page.route(/\/api\/intern\/postfach$/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: {
        ...body,
        fuerMich: [],
        postfaecher: body.postfaecher.map((postfach: Record<string, unknown>, index: number) =>
          index === 0 ? { ...postfach, fehler: true, gesperrt } : postfach
        ),
      },
    });
  });
  await page.goto('/leitendenbereich/');
  const karte = page.getByRole('region', { name: 'E-Mails' });
  await expect(karte.getByText('Kontakt-Postfach konnte nicht geladen werden.')).toBeVisible();
  await expect(karte.getByRole('link', { name: 'Zum Postfach' }).first()).toHaveAttribute(
    'href',
    '/leitendenbereich/email/kontakt'
  );
  gesperrt = true;
  await karte.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(
    karte.getByText(/Die Website darf das Kontakt-Postfach gerade nicht lesen/)
  ).toBeVisible();
  await expect(karte.getByRole('link', { name: 'admin@stamm-phoenix.de' })).toBeVisible();
});

test('a long attachment name wraps on a phone instead of being cut off', async ({ page }) => {
  const lang = 'RechnungSommerlager2026TeilnehmerlisteUndZeltplatzkostenMitAnlagen.pdf';
  await page.route('**/api/intern/postfach/kontakt/konversation?*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const nachricht of body.nachrichten)
      for (const anhang of nachricht.anhaenge) anhang.name = lang;
    await route.fulfill({ response, json: body });
  });
  await page.goto('/leitendenbereich/email/kontakt');
  const liste = page.getByRole('region', { name: 'Posteingang' });
  await liste.getByRole('button', { name: /^Alle/ }).click();
  await liste.getByRole('link', { name: /Rechnung Zeltplatz Sommerlager/ }).click();
  const links = page.getByRole('list', { name: 'Anhänge' }).getByRole('link');
  await expect(links.first()).toContainText(lang);
  for (const link of await links.all()) {
    const [box, liste] = await Promise.all([
      link.boundingBox(),
      page.getByRole('list', { name: 'Anhänge' }).boundingBox(),
    ]);
    expect(box!.x + box!.width).toBeLessThanOrEqual(liste!.x + liste!.width + 1);
  }
});
