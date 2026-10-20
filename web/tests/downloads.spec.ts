import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';

// Every test works on its own files, so the demo data other tests rely on stays in place.
const marker = (): string => `TEST – bitte löschen ${test.info().project.name}`;

/** A one-page PDF with a line of text. */
function pdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 72 760 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

async function choose(page: Page, name: string, mimeType: string, buffer: Buffer): Promise<void> {
  await page.locator('input[type=file]').setInputFiles({ name, mimeType, buffer });
}

async function expectLoadedImage(image: Locator): Promise<void> {
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0);
}

test('uploaded files get a preview, can be replaced and appear on the public page', async ({
  page,
}) => {
  const name = `${marker()} Packliste.pdf`;
  const zip = `${marker()} Lieder.zip`;
  await page.goto('/leitendenbereich/downloads');

  // A PDF gets the picture of its first page as preview
  await choose(page, name, 'application/pdf', pdf('Packliste'));
  await expect(page.getByText(`${name} hochgeladen.`).first()).toBeVisible();
  const entry = page.getByRole('listitem').filter({ hasText: name }).last();
  await expectLoadedImage(entry.locator('img'));

  // The same name again asks first
  await choose(page, name, 'application/pdf', pdf('Neue Packliste'));
  const upload = page.getByRole('listitem').filter({ hasText: 'Eine Datei mit diesem Namen' });
  await upload.getByRole('button', { name: 'Ersetzen' }).click();
  await expect(page.getByText(`${name} ersetzt.`).first()).toBeVisible();
  const named = async (): Promise<number> =>
    (
      (await (await page.request.get('/api/intern/pflege/downloads')).json()) as {
        fileName: string;
      }[]
    ).filter((file) => file.fileName === name).length;
  expect(await named()).toBe(1);

  // Other files have no preview; the list shows their extension
  await choose(page, zip, 'application/zip', Buffer.from('PK\u0005\u0006' + '\0'.repeat(18)));
  await expect(page.getByText(`${zip} hochgeladen.`).first()).toBeVisible();

  await page.goto('/downloads');
  const article = (fileName: string): Locator =>
    page.getByRole('article').filter({ has: page.getByRole('heading', { name: fileName }) });
  await expectLoadedImage(article(name).locator('img').first());
  await expect(article(zip).locator('img')).toHaveCount(0);
  await expect(article(zip).getByText('ZIP', { exact: true }).first()).toBeVisible();

  const files = (await (await page.request.get('/api/intern/pflege/downloads')).json()) as {
    id: string;
    fileName: string;
  }[];
  for (const file of files.filter((candidate) => candidate.fileName.startsWith(marker()))) {
    await page.request.delete(`/api/intern/pflege/downloads/${file.id}`);
  }
});

test('renaming a PDF with punctuation keeps its extension unless a supported one is explicit', async ({
  page,
}) => {
  let name = `${marker()} Umbenennen.pdf`;
  await page.goto('/leitendenbereich/downloads');
  await choose(page, name, 'application/pdf', pdf('Umbenennen'));
  await expect(page.getByText(`${name} hochgeladen.`).first()).toBeVisible();
  for (const entered of [
    `${marker()} Anmeldung 1. Advent`,
    `${marker()} Anmeldung 20.10.2026`,
    `${marker()} Explizit.PDF`,
  ]) {
    await page.getByRole('button', { name: `Umbenennen (${name})`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Datei umbenennen' });
    await dialog.getByLabel('Dateiname', { exact: true }).fill(entered);
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog).toBeHidden();
    name = entered.endsWith('.PDF') ? entered : `${entered}.pdf`;
    await expect(page.getByText(`Umbenannt in ${name}.`)).toBeVisible();
  }
  const files = (await (await page.request.get('/api/intern/pflege/downloads')).json()) as {
    id: string;
    fileName: string;
  }[];
  await page.request.delete(
    `/api/intern/pflege/downloads/${files.find((file) => file.fileName === name)!.id}`
  );
});
