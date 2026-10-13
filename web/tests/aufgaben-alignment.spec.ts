import { test, expect } from './fixtures';
import { prepareTaskTest } from './aufgaben-helpers';
test.beforeEach(async ({ page }, testInfo) => {
  await prepareTaskTest(page, testInfo.project.name);
});
test('checkbox and menu align with the first title line in list and Kanban', async ({ page }) => {
  let long = false;
  await page.route('**/api/intern/pflege/aufgaben', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.tasks = [
      {
        ...data.tasks[0],
        title: long
          ? 'Material für das nächste gemeinsame Herbstlager sorgfältig prüfen und vorbereiten, Zelte kontrollieren und die Lagerküche abstimmen'
          : 'Material prüfen',
      },
    ];
    await route.fulfill({ response, json: data });
  });
  for (const width of [393, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const multiline of [false, true]) {
      long = multiline;
      await page.goto('/leitendenbereich/aufgaben');
      await page.evaluate(() => document.fonts.ready);
      for (const view of ['Liste', 'Kanban']) {
        await page
          .getByRole('group', { name: 'Darstellung', exact: true })
          .getByRole('button', { name: view, exact: true })
          .click();
        await expect(page.locator('#aufgabe-1')).toBeVisible();
        const geometry = await page.locator('#aufgabe-1').evaluate((row) => {
          const title = row.querySelector<HTMLButtonElement>('.task-open')!;
          const box = title.getBoundingClientRect();
          const firstLine = box.top + parseFloat(getComputedStyle(title).lineHeight) / 2;
          const checkbox = row.querySelector<HTMLButtonElement>('button[aria-pressed]')!;
          const menu = row.querySelector<HTMLButtonElement>(
            'button[aria-label^="Weitere Aktionen:"]'
          )!;
          const centers = [checkbox, menu].map((button) => {
            const target = button.getBoundingClientRect();
            const icon = button.querySelector('svg')!.getBoundingClientRect();
            return {
              width: target.width,
              height: target.height,
              center: icon.top + icon.height / 2,
            };
          });
          return {
            firstLine,
            centers,
            titleHeight: box.height,
            lineHeight: parseFloat(getComputedStyle(title).lineHeight),
          };
        });
        if (multiline) expect(geometry.titleHeight).toBeGreaterThan(geometry.lineHeight);
        for (const target of geometry.centers) {
          expect(target.width).toBeGreaterThanOrEqual(44);
          expect(target.height).toBeGreaterThanOrEqual(44);
          expect(Math.abs(target.center - geometry.firstLine)).toBeLessThanOrEqual(1);
        }
      }
    }
  }
});
