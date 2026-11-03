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
  await expect(karte.getByRole('link', { name: /Frage zum Nikolausdienst/ })).toBeVisible();
  await expect(karte.getByText('Dir zugewiesen')).toBeVisible();

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
  await expect(liste.getByText('Dir ist gerade keine E-Mail zugewiesen.')).toBeVisible();
});
