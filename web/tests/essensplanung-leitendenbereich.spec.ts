import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test('a Leitende:r creates a Planung, invites a Leitende:r and finds it on the start page', async ({
  page,
}) => {
  const name = `Herbstlager E2E ${Date.now()}`;
  await page.goto('/leitendenbereich/essensplanungen');
  await page.getByRole('button', { name: 'Neue Planung anlegen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Neue Planung' });

  // Without input only the required fields report; the last day is optional
  await dialog.getByRole('button', { name: 'Planung anlegen' }).click();
  await expect(dialog.getByText('Bitte den ersten Tag wählen.')).toBeVisible();
  await expect(dialog.getByText('Bitte den letzten Tag wählen.')).toHaveCount(0);

  await dialog.getByLabel('Name der Planung').fill(name);
  await dialog.getByLabel('Erster Tag').fill('2099-10-01');
  await dialog.getByRole('button', { name: 'Planung anlegen' }).click();
  await expect(page).toHaveURL(/\/essensplanung\/planung#t=/);
  await expect(page.getByRole('heading', { name })).toBeVisible();

  await page.getByRole('tab', { name: 'Mitglieder' }).click();
  const leitende = page.getByRole('region', { name: 'Leitende einladen' });
  await leitende.getByLabel('Name suchen').fill('zoe');
  await expect(leitende.getByText('Anna Ast')).toHaveCount(0);
  await leitende.getByRole('button', { name: 'Zoe Zelt einladen' }).click();
  await expect(leitende.getByText('schon dabei')).toBeVisible();
  await expect(page.getByText('zoe.zelt@example.test').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto('/leitendenbereich/');
  const karte = page.getByRole('region', { name: 'Essensplanung' });
  await expect(karte.getByRole('link', { name: new RegExp(name) })).toBeVisible();
});
