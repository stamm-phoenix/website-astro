import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import type { StaffBeleg } from '../src/lib/types';

for (const operation of ['PUT', 'DELETE'] as const) {
  test(`photo ${operation} keeps its own write version for the unsaved person draft`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: info.project.name === 'mobile' ? 'dark' : 'light' });
    const name = `Foto-Version ${operation} ${info.project.name}`;
    const created = await page.request.post('/api/intern/pflege/leitende', {
      data: { name, teams: ['Rover'] },
    });
    expect(created.ok()).toBe(true);
    const { id } = await created.json();
    let changedPhoto = false;
    const ownVersion = 'photo-write-version';
    await page.route('**/api/intern/pflege/leitende', async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      const person = data.items.find((item: { id: string }) => item.id === id);
      person.hasImage = operation === 'DELETE';
      if (changedPhoto) person.etag = 'later-foreign-version';
      await route.fulfill({ response, json: data });
    });
    await page.route(`**/api/intern/pflege/leitende/${id}/foto`, (route) => {
      changedPhoto = true;
      return route.fulfill({ json: { hasImage: operation === 'PUT', etag: ownVersion } });
    });
    let usedVersion = '';
    await page.route(`**/api/intern/pflege/leitende/${id}`, (route) => {
      usedVersion = route.request().postDataJSON().etag;
      return route.fulfill({
        status: 409,
        json: { code: 'CONFLICT', message: 'Die Person wurde inzwischen geändert.' },
      });
    });
    await page.goto('/leitendenbereich/leitende');
    await page.getByRole('button', { name: new RegExp(name) }).click();
    const editor = page.getByRole('dialog').filter({ has: page.locator('#ld-name') });
    await editor.getByLabel('Name', { exact: true }).fill('Mein ungespeicherter Name');
    if (operation === 'PUT') {
      const photo = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 900;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#887766';
        context.fillRect(0, 0, 900, 900);
        return canvas.toDataURL('image/jpeg').split(',')[1];
      });
      await editor.locator('input[type="file"]').setInputFiles({
        name: 'person.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from(photo, 'base64'),
      });
      await expect(editor).toContainText('Foto gespeichert.');
    } else {
      await editor.getByRole('button', { name: 'Foto entfernen', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Foto entfernen?', exact: true })
        .getByRole('button', { name: 'Entfernen', exact: true })
        .click();
      await expect(editor).toContainText('Foto entfernt.');
    }
    await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect.poll(() => usedVersion).toBe(ownVersion);
    await expect(editor.getByLabel('Name', { exact: true })).toHaveValue(
      'Mein ungespeicherter Name'
    );
    await expect(editor).toContainText(/wurde inzwischen geändert/);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `/tmp/278-photo-${operation}-${info.project.name}.png` });
  });
}

for (const pathway of ['photo', 'receipt'] as const) {
  test(`receipt ${pathway} save keeps the photo write version and its unsaved note`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: info.project.name === 'mobile' ? 'dark' : 'light' });
    const records = (await (
      await page.request.get('/api/intern/pflege/belege')
    ).json()) as StaffBeleg[];
    const receipt = records.find((item) => item.status === 'Eingereicht')!;
    let changedPhoto = false;
    const ownVersion = 'receipt-photo-write-version';
    await page.route('**/api/intern/pflege/belege', (route) =>
      route.fulfill({
        json: [{ ...receipt, etag: changedPhoto ? 'later-foreign-version' : receipt.etag }],
      })
    );
    await page.route(`**/api/intern/pflege/belege/${receipt.id}/foto`, (route) => {
      changedPhoto = true;
      return route.fulfill({ json: { ...receipt, etag: ownVersion, hasImage: true } });
    });
    let usedVersion = '';
    await page.route(`**/api/intern/pflege/belege/${receipt.id}`, (route) => {
      usedVersion = route.request().postDataJSON().etag;
      return route.fulfill({
        status: 409,
        json: { code: 'CONFLICT', message: 'Der Beleg wurde inzwischen geändert.' },
      });
    });
    await page.goto('/leitendenbereich/belege');
    await page.getByRole('button').filter({ hasText: receipt.shop }).first().click();
    const editor = page
      .getByRole('dialog')
      .filter({ has: page.getByLabel('Geschäft', { exact: true }) });
    const note = editor.getByLabel(/^Bemerkung(?: \(optional\))?$/, { exact: true });
    await note.fill('Mein noch nicht gespeicherter Hinweis');
    const photo = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 900;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#887766';
      context.fillRect(0, 0, 900, 900);
      return canvas.toDataURL('image/jpeg').split(',')[1];
    });
    await editor.locator('input[type="file"]').setInputFiles({
      name: 'beleg.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(photo, 'base64'),
    });
    const photoSave = editor.getByRole('button', { name: 'Neues Foto speichern', exact: true });
    await expect(photoSave).toBeEnabled();
    if (pathway === 'photo') {
      await photoSave.click();
      await expect(editor).toContainText('Foto ersetzt.');
    }
    await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect.poll(() => usedVersion).toBe(ownVersion);
    await expect(note).toHaveValue('Mein noch nicht gespeicherter Hinweis');
    await expect(editor).toContainText(/wurde inzwischen geändert/);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `/tmp/278-receipt-photo-${pathway}-${info.project.name}.png` });
  });
}
