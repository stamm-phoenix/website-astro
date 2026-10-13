import type { Page, Locator } from '@playwright/test';

export async function taskStatus(page: Page, status: string): Promise<void> {
  if (!(await page.getByRole('group', { name: 'Status', exact: true }).count()))
    await page.goto('/leitendenbereich/aufgaben');
  await page
    .getByRole('group', { name: 'Status', exact: true })
    .getByRole('button', { name: status, exact: true })
    .click();
}
export async function taskFilters(page: Page): Promise<void> {
  if (!(await page.getByRole('group', { name: 'Aufgabenfilter' }).isVisible()))
    await page.getByText(/^Filter \(\d+ aktiv\)$/).click();
}
export async function deleteTaskMenu(row: Locator): Promise<void> {
  await row.getByRole('button', { name: /^Weitere Aktionen:/ }).click();
  await row
    .page()
    .getByRole('dialog', { name: 'Aufgabenaktionen', exact: true })
    .getByRole('button', { name: 'Löschen', exact: true })
    .click();
}
export async function taskPage(page: Page): Promise<void> {
  if (new URL(page.url()).pathname !== '/leitendenbereich/aufgaben')
    await page.goto('/leitendenbereich/aufgaben');
}

/** Test-only in-memory data; never touches production tasks. */
export async function prepareTaskTest(page: Page, project: string): Promise<void> {
  await page.emulateMedia({ colorScheme: project === 'mobile' ? 'dark' : 'light' });
  const reset = await page.request.post('/api/__mock/aufgaben/reset');
  if (!reset.ok()) throw new Error('Task mock reset failed');
}
