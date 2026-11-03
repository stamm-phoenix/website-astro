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
