import { test, expect, answerConfirm } from './fixtures';

test.use({ viewport: { width: 390, height: 844 } });

test('a preselected topic and cleared input do not cause a discard warning', async ({ page }) => {
  await page.goto('/kontakt?thema=gruppenstunden');
  await page.getByLabel('Deine Nachricht').fill('Versehentlicher Text');
  await page.getByLabel('Deine Nachricht').fill('');
  await page.locator('footer a[href="/impressum"]').first().click();
  await expect(page).toHaveURL(/\/impressum\/?$/);
});

test('leaving an unsent message asks first and cancellation keeps the input', async ({ page }) => {
  await page.goto('/kontakt');
  await page.getByLabel('Deine Nachricht').fill('Frage zur nächsten Gruppenstunde');
  await page.getByRole('link', { name: 'Zum Inhalt springen' }).focus();
  // A real same-origin link exercises the Astro navigation guard.
  await page.locator('footer a[href="/impressum"]').first().click();
  await answerConfirm(page, 'Änderungen verwerfen?', 'Weiter bearbeiten');
  await expect(page).toHaveURL(/\/kontakt\/?$/);
  await expect(page.getByLabel('Deine Nachricht')).toHaveValue('Frage zur nächsten Gruppenstunde');
  await page.locator('footer a[href="/impressum"]').first().click();
  await answerConfirm(page, 'Änderungen verwerfen?', 'Änderungen verwerfen');
  await expect(page).toHaveURL(/\/impressum\/?$/);
});

test('validation descriptions exist when the first invalid field receives focus', async ({
  page,
}) => {
  await page.goto('/kontakt');
  const name = page.getByLabel('Dein Name', { exact: true });
  await expect(name).toBeVisible();
  await name.evaluate((input) => {
    input.addEventListener('focus', () => {
      const description = input.getAttribute('aria-describedby');
      input.setAttribute(
        'data-error-at-focus',
        String(
          input.getAttribute('aria-invalid') === 'true' &&
            !!description &&
            !!document.getElementById(description)?.textContent
        )
      );
    });
  });
  await page.getByRole('button', { name: 'Nachricht senden', exact: true }).click();
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute('data-error-at-focus', 'true');
});

test('contact fields have stable form names', async ({ page }) => {
  await page.goto('/kontakt');
  await expect(page.getByLabel('Deine Nachricht')).toBeVisible();
  const names = await page
    .locator('form')
    .filter({ has: page.getByLabel('Deine Nachricht') })
    .evaluate((form) => Array.from(new FormData(form as HTMLFormElement).keys()));
  expect(names).toEqual(
    expect.arrayContaining(['kontakt-name', 'kontakt-email', 'kontakt-message'])
  );
});
