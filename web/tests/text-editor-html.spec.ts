import { test, expect, answerConfirm } from './fixtures';
import type { APIRequestContext } from '@playwright/test';

// The shared formatting editor at the HTML fields (#320): stored HTML keeps its shape.

const marker = (): string => `TEST – bitte löschen Editor ${test.info().project.name}`;

async function createGruppenstunde(
  request: APIRequestContext,
  location: string,
  description = ''
): Promise<string> {
  const response = await request.post('/api/intern/pflege/gruppenstunden', {
    data: {
      stufe: 'Rover',
      weekday: 'Montags',
      time: '19:00 Uhr - 21:00 Uhr',
      location,
      description,
    },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { id: string }).id;
}

test('a description is stored as plain HTML like before and comes back formatted', async ({
  page,
}) => {
  const location = marker();
  // Written with the previous editor, which allowed underlines without offering them
  const id = await createGruppenstunde(
    page.request,
    location,
    '<p>Bitte <u>pünktlich</u> kommen.</p>'
  );
  await page.goto('/leitendenbereich/gruppenstunden');
  await page
    .getByRole('listitem')
    .filter({ hasText: location })
    .getByRole('button', { name: /^Bearbeiten/ })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Gruppenstunde Rover bearbeiten' });
  const text = dialog.getByRole('textbox', { name: 'Beschreibung' });
  const tools = dialog.getByRole('toolbar', { name: 'Formatierung' });
  // Only what the description allows: no strikethrough, code, headings or links
  await expect(tools.getByRole('button')).toHaveText(['', '', '', '', '', '']);
  await expect(tools.getByRole('button', { name: 'Durchgestrichen' })).toHaveCount(0);
  await expect(tools.getByRole('button', { name: 'Link' })).toHaveCount(0);

  await text.click();
  await expect(text).toBeFocused();
  await page.keyboard.press('Control+End');
  // On a slow runner the click places the cursor after the key; type only once it is at the end
  await expect
    .poll(() =>
      page.evaluate(() => {
        const selection = document.getSelection();
        return `${selection?.anchorNode?.textContent}@${selection?.anchorOffset}`;
      })
    )
    .toBe(' kommen.@8');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Treffen im ');
  await tools.getByRole('button', { name: 'Fett' }).click();
  await page.keyboard.type('Heim');
  await tools.getByRole('button', { name: 'Fett' }).click();
  await page.keyboard.press('Enter');
  await tools.getByRole('button', { name: 'Aufzählung' }).click();
  await page.keyboard.type('Becher mitbringen');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toBeHidden();

  const { items } = (await (
    await page.request.get('/api/intern/pflege/gruppenstunden')
  ).json()) as {
    items: { id: string; description: string }[];
  };
  expect(items.find((entry) => entry.id === id)?.description).toBe(
    '<p>Bitte <u>pünktlich</u> kommen.</p><p>Treffen im <strong>Heim</strong></p><ul><li>Becher mitbringen</li></ul>'
  );

  // Opened again, the editor shows the stored HTML
  await page
    .getByRole('listitem')
    .filter({ hasText: location })
    .getByRole('button', { name: /^Bearbeiten/ })
    .click();
  await expect(text.locator('strong')).toHaveText('Heim');
  await expect(text.locator('li')).toHaveText(['Becher mitbringen']);
  await page.request.delete(`/api/intern/pflege/gruppenstunden/${id}`);
});

test('blog images are shown, inserted at the cursor and removed with the image', async ({
  page,
}) => {
  // An existing post: images with their previews, headings and links
  await page.goto('/leitendenbereich/blog/beitrag?id=14');
  const text = page.getByRole('textbox', { name: 'Text', exact: true });
  await expect(text.locator('img[data-bild]')).toHaveCount(2);
  await expect(text.locator('img[data-bild="bild-1002.jpg"]')).toHaveAttribute('src', /bild-1002/);
  await expect(text.locator('h2')).toHaveText(['Aufbau im Regen', 'Highlights']);
  await expect(text.getByRole('link', { name: 'Instagram' })).toBeVisible();
  await expect(
    page.getByRole('toolbar', { name: 'Formatierung' }).getByRole('button', {
      name: 'Zwischenüberschrift',
      exact: true,
    })
  ).toBeVisible();

  // A post of its own, so the demo data stays as it is
  const created = await page.request.post('/api/intern/pflege/blog', {
    data: { title: marker(), content: '<p>Ein Bericht.</p>' },
  });
  const { id } = (await created.json()) as { id: string };
  const uploaded = await page.request.put(`/api/intern/pflege/blog/${id}/bilder`, {
    headers: { 'content-type': 'image/jpeg' },
    data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  });
  expect(uploaded.ok()).toBe(true);
  const { image } = (await uploaded.json()) as { image: { file: string } };
  try {
    await page.goto(`/leitendenbereich/blog/beitrag?id=${id}`);
    const bild = page.getByRole('listitem').filter({ hasText: 'Titelbild' });
    await text.locator('p').first().click();
    await bild.getByRole('button', { name: 'In Text einfügen' }).click();
    await expect(text.locator(`img[data-bild="${image.file}"]`)).toHaveCount(1);
    await expect(page.getByText('Bild in den Text eingefügt.').first()).toBeVisible();
    await expect(bild).toContainText('Im Text');

    // Pasted HTML never loads an image from elsewhere: only our own previews are kept
    await text.evaluate((element) => {
      const data = new DataTransfer();
      data.setData(
        'text/html',
        '<p>Eingefügt <img data-bild="bild-1.jpg" src="https://example.org/pixel.png"></p>'
      );
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
      );
    });
    await expect(text).toContainText('Eingefügt');
    await expect(text.locator('img[src^="http"]')).toHaveCount(0);

    await bild.getByRole('button', { name: 'Löschen', exact: true }).click();
    await answerConfirm(page, 'Bild 1 löschen?', 'Löschen');
    await expect(text.locator(`img[data-bild="${image.file}"]`)).toHaveCount(0);
    // Only the pasted placeholder without a source is left; the API drops it on saving
    await expect(text.locator('img[src]')).toHaveCount(0);
    await expect(text).toContainText('Ein Bericht.');
  } finally {
    await page.request.delete(`/api/intern/pflege/blog/${id}`);
  }
});

test('the message dialog loads the editor when it opens', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The booking list opens differently on phones.');
  await page.goto('/leitendenbereich/nikolaus?ansicht=liste');
  await page.getByRole('button', { name: 'Familie Huber', exact: true }).click();
  await page.getByRole('button', { name: 'Nachricht schreiben' }).click();
  const dialog = page.getByRole('dialog', { name: /Nachricht/ });
  const text = dialog.getByRole('textbox', { name: 'Nachricht' });
  await expect(text).toBeVisible();
  // Sending without a text is refused and says so
  await dialog.getByLabel('Betreff').fill('Kleine Verspätung');
  await dialog.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(dialog.getByText('Bitte eine Nachricht schreiben.')).toBeVisible();
  await expect(text).toHaveAttribute('aria-invalid', 'true');
  await text.click();
  await page.keyboard.type('Wir kommen etwa ');
  await dialog
    .getByRole('toolbar', { name: 'Formatierung' })
    .getByRole('button', { name: 'Fett' })
    .click();
  await page.keyboard.type('zehn Minuten');
  await expect(text.locator('strong')).toHaveText('zehn Minuten');
});
