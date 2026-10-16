import { test, expect } from './fixtures';
import { prepareTaskTest, taskPage } from './aufgaben-helpers';
test.beforeEach(async ({ page }, testInfo) => prepareTaskTest(page, testInfo.project.name));

test('a unique typed assignee is selected on blur without blocking a new task', async ({
  page,
}) => {
  await page.route('**/api/intern/pflege/aufgaben/benutzer', (route) =>
    route.fulfill({
      json: { users: [{ name: 'Hugo Beispiel', login: 'hugo@example.test' }], unavailable: false },
    })
  );
  await page.goto('/leitendenbereich/aufgaben');
  await taskPage(page);
  await page.getByRole('button', { name: 'Aufgabe anlegen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const assignee = dialog.getByRole('combobox', { name: /Zuständigkeit/ });
  await assignee.fill('Hugo');
  await assignee.press('Tab');
  await expect(
    dialog.getByRole('button', { name: 'Hugo Beispiel entfernen', exact: true })
  ).toBeVisible();
  await expect(assignee).toHaveValue('');
});

test('an ambiguous assignee error stays visible without a list covering it', async ({ page }) => {
  await page.route('**/api/intern/pflege/aufgaben/benutzer', (route) =>
    route.fulfill({
      json: {
        users: [
          { name: 'Hugo Beispiel', login: 'hugo@example.test' },
          { name: 'Hugo Anders', login: 'anders@example.test' },
        ],
        unavailable: false,
      },
    })
  );
  await page.goto('/leitendenbereich/aufgaben');
  await taskPage(page);
  await page.getByRole('button', { name: 'Aufgabe anlegen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('combobox', { name: /Zuständigkeit/ });
  await dialog.getByRole('textbox', { name: 'Titel', exact: true }).fill('TEST – bitte löschen');
  await input.fill('Hugo');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(
    dialog.getByText('Bitte tippe auf einen Namen aus der Liste – oder lass das Feld leer.', {
      exact: true,
    })
  ).toBeVisible();
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await input.fill('Hugo Bei');
  await expect(dialog.getByRole('option', { name: 'Hugo Beispiel', exact: true })).toBeVisible();
});
