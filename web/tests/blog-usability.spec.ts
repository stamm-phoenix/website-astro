import { test, expect, answerConfirm } from './fixtures';

test('a new blog post has an accurate heading and explains when images become available', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/blog/beitrag');
  await expect(page.getByRole('heading', { name: 'Neuer Beitrag', level: 1 })).toBeVisible();
  await expect(
    page.getByText('Bilder fügst du im Bereich „Bilder“', { exact: false })
  ).toBeHidden();
  await expect(page.getByText(/Lege den Beitrag zuerst als Entwurf an/)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Veröffentlicht/ })).toHaveCount(0);
});

test('publishing and withdrawing are explicit actions and failed publishing preserves the draft', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/blog/beitrag');
  await page
    .getByRole('textbox', { name: 'Titel', exact: true })
    .fill('TEST – bitte löschen: Blog-Freigabe');
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Bericht der Gruppenstunde.');
  await page.getByRole('button', { name: 'Als Entwurf anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\?id=/);
  const id = new URL(page.url()).searchParams.get('id')!;
  try {
    await expect(
      page.getByText('Status: Entwurf – nur hier sichtbar.', { exact: true })
    ).toBeVisible();
    await page.route(`**/api/intern/pflege/blog/${id}`, (r) =>
      r.request().method() === 'PATCH' ? r.fulfill({ status: 500, json: {} }) : r.fallback()
    );
    await page.getByRole('button', { name: 'Veröffentlichen', exact: true }).click();
    await answerConfirm(
      page,
      'Beitrag „TEST – bitte löschen: Blog-Freigabe“ veröffentlichen?',
      'Veröffentlichen'
    );
    await expect(
      page.getByText('Der Beitrag wurde nicht gespeichert.', { exact: false }).first()
    ).toBeVisible();
    await expect(
      page.getByText('Status: Entwurf – nur hier sichtbar.', { exact: true })
    ).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toContainText(
      'Bericht der Gruppenstunde.'
    );
    await page.unroute(`**/api/intern/pflege/blog/${id}`);
    await page.getByRole('button', { name: 'Veröffentlichen', exact: true }).click();
    await answerConfirm(
      page,
      'Beitrag „TEST – bitte löschen: Blog-Freigabe“ veröffentlichen?',
      'Veröffentlichen'
    );
    await expect(
      page.getByText('Status: Veröffentlicht – auf der Website sichtbar.', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Auf der Website ansehen', exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Veröffentlichung zurücknehmen', exact: true }).click();
    await answerConfirm(
      page,
      'Veröffentlichung von „TEST – bitte löschen: Blog-Freigabe“ zurücknehmen?',
      'Veröffentlichung zurücknehmen'
    );
    await expect(
      page.getByText('Status: Entwurf – nur hier sichtbar.', { exact: true })
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText('Status: Entwurf – nur hier sichtbar.', { exact: true })
    ).toBeVisible();
  } finally {
    await page.request.delete(`/api/intern/pflege/blog/${id}`);
  }
});
