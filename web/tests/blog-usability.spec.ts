import { test, expect, answerConfirm } from './fixtures';

test('a new blog post has an accurate heading and explains when images become available', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/blog/beitrag');
  await expect(page.getByRole('heading', { name: 'Neuer Beitrag', level: 1 })).toBeVisible();
  await expect(
    page.getByText('Bilder fügst du im Bereich „Bilder“', { exact: false })
  ).toBeHidden();
  await expect(page.getByText('Bilder kannst du nach dem Anlegen hinzufügen.')).toBeVisible();
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
      page.getByTestId('blog-status').getByText('Entwurf', { exact: true })
    ).toBeVisible();
    let releaseFailure: () => void = () => {};
    const failedResponse = new Promise<void>((resolve) => (releaseFailure = resolve));
    let markStarted: () => void = () => {};
    const writeStarted = new Promise<void>((resolve) => (markStarted = resolve));
    await page.route(`**/api/intern/pflege/blog/${id}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      markStarted();
      await failedResponse;
      await route.fulfill({ status: 500, json: {} });
    });
    await page.getByRole('button', { name: 'Veröffentlichen', exact: true }).click();
    await answerConfirm(
      page,
      'Beitrag „TEST – bitte löschen: Blog-Freigabe“ veröffentlichen?',
      'Veröffentlichen'
    );
    await writeStarted;
    try {
      await page
        .getByRole('navigation', { name: 'Zurück' })
        .getByRole('link', { name: 'Blog', exact: true })
        .click();
      const discard = page.getByRole('dialog', { name: 'Änderungen verwerfen?', exact: true });
      await expect(discard).toBeVisible();
      await discard.getByRole('button', { name: 'Weiter bearbeiten', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`\\?id=${id}$`));
    } finally {
      releaseFailure();
    }
    await expect(
      page.getByText('Der Beitrag wurde nicht gespeichert.', { exact: false }).first()
    ).toBeVisible();
    await expect(
      page.getByTestId('blog-status').getByText('Entwurf', { exact: true })
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
      page.getByTestId('blog-status').getByText('Veröffentlicht', { exact: true })
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
      page.getByTestId('blog-status').getByText('Entwurf', { exact: true })
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByTestId('blog-status').getByText('Entwurf', { exact: true })
    ).toBeVisible();
  } finally {
    await page.request.delete(`/api/intern/pflege/blog/${id}`);
  }
});

test('a successful deletion returns to the blog list without an unsaved-work warning', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/blog/beitrag');
  await page
    .getByRole('textbox', { name: 'Titel', exact: true })
    .fill('TEST – bitte löschen: Blog entfernen');
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Ein Entwurf.');
  await page.getByRole('button', { name: 'Als Entwurf anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\?id=/);
  const id = new URL(page.url()).searchParams.get('id');
  const warnings: string[] = [];
  page.on('dialog', async (dialog) => {
    warnings.push(dialog.type());
    await dialog.dismiss();
  });
  try {
    await page.getByRole('button', { name: 'Löschen', exact: true }).click();
    await answerConfirm(page, 'Beitrag „TEST – bitte löschen: Blog entfernen“ löschen?', 'Löschen');
    await expect(page).toHaveURL(/\/leitendenbereich\/blog\/?$/);
    expect(warnings).toEqual([]);
  } finally {
    await page.request.delete(`/api/intern/pflege/blog/${id}`);
  }
});

test('deleting a blog image names its position and description', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: info.project.name === 'mobile' ? 'dark' : 'light' });
  const created = await page.request.post('/api/intern/pflege/blog', {
    data: { title: 'Lagerbericht', content: '<p>Unser Lager.</p>' },
  });
  expect(created.ok()).toBe(true);
  const { id } = await created.json();
  await page.route(`**/api/intern/pflege/blog/${id}`, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.images = [{ file: 'lager.jpg', width: 900, height: 600, alt: 'Lagerfeuer' }];
    await route.fulfill({ response, json: data });
  });
  await page.goto(`/leitendenbereich/blog/beitrag?id=${id}`);
  const images = page.getByRole('region', { name: 'Bilder', exact: true });
  await images.getByRole('button', { name: 'Löschen', exact: true }).click();
  const confirmation = page.getByRole('dialog', {
    name: 'Bild 1 „Lagerfeuer“ löschen?',
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await page.screenshot({ path: `/tmp/278-delete-image-${info.project.name}.png` });
  await confirmation.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(images.getByLabel('Bildbeschreibung')).toHaveValue('Lagerfeuer');
});

test('a post saved while an older list answer is on its way shows up in the list', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/leitendenbereich/blog/beitrag');
  await page.getByRole('textbox', { name: 'Titel', exact: true }).fill('TEST – Liste alt');
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Bericht der Gruppenstunde.');
  await page.getByRole('button', { name: 'Als Entwurf anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\?id=/);
  const back = page.getByRole('navigation', { name: 'Zurück' }).getByRole('link', { name: 'Blog' });
  await back.click();
  await expect(page.getByRole('link', { name: 'TEST – Liste alt', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'TEST – Liste alt', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toHaveValue(
    'TEST – Liste alt'
  );

  // A minute later the list asks again, and its answer, with the old title, is held back
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/intern/pflege/blog', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  await page.clock.fastForward(61_000);
  const oldAnswer = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/intern/pflege/blog') && response.request().method() === 'GET'
  );
  await back.click();
  await page.getByRole('link', { name: 'TEST – Liste alt', exact: true }).click();
  await page.getByRole('textbox', { name: 'Titel', exact: true }).fill('TEST – Liste neu');
  await page.getByRole('button', { name: 'Als Entwurf speichern', exact: true }).click();
  await expect(page.getByText('Als Entwurf gespeichert.', { exact: false }).first()).toBeVisible();
  release();
  await oldAnswer;
  await page.unroute('**/api/intern/pflege/blog');

  await back.click();
  await expect(page.getByRole('link', { name: 'TEST – Liste neu', exact: true })).toBeVisible();
});
