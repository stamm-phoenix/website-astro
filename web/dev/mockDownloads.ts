/** Downloads: list, chunked upload and edit. */
import { downloads, staffDownloads } from './mock-data/content';
import { MOCK_NOW, newId } from './mock-data/util';
import { error, json, noContent, notFound, route, str } from './mockCore';
import { PRINCIPAL } from './mockAuth';

route('GET', '/api/intern/pflege/downloads', () => json(staffDownloads()));

/** Running uploads (upload id → parts), as the API stages them in Blob Storage. */
const uploadParts = new Map<string, Map<number, number>>();
const UPLOAD_PART_BYTES = 4 * 1024 * 1024;

route('POST', '/api/intern/pflege/downloads/upload', (req) => {
  const body = req.json ?? {};
  const fileName = str(body.fileName).trim();
  if (!fileName)
    return error(400, 'INVALID', 'Bitte gib einen Dateinamen an.', {
      fileName: 'Bitte gib einen Dateinamen an.',
    });
  if (body.replace !== true && downloads.some((d) => sameName(d.fileName, fileName)))
    return error(409, 'EXISTS', 'Eine Datei mit diesem Namen gibt es bereits.');
  const id = newId();
  uploadParts.set(id, new Map());
  return json({ uploadId: id, partSize: UPLOAD_PART_BYTES });
});

route(
  'PUT',
  '/api/intern/pflege/downloads/upload/:id/:index',
  (req) => {
    const parts = uploadParts.get(req.params.id);
    if (!parts) return notFound();
    parts.set(Number(req.params.index), req.raw.length);
    return noContent();
  },
  true
);

route('POST', '/api/intern/pflege/downloads/upload/:id', (req) => {
  const body = req.json ?? {};
  const fileName = str(body.fileName).trim();
  const replace = body.replace === true;
  const existing = downloads.find((d) => sameName(d.fileName, fileName));
  if (existing && !replace)
    return error(409, 'EXISTS', 'Eine Datei mit diesem Namen gibt es bereits.');
  const parts = uploadParts.get(req.params.id);
  const received = [...(parts?.values() ?? [])].reduce((total, part) => total + part, 0);
  if (!parts || parts.size === 0 || received !== Number(body.size))
    return error(
      409,
      'INCOMPLETE',
      'Die Datei ist nicht vollständig angekommen und wurde nicht gespeichert. Lade sie noch einmal hoch.'
    );
  uploadParts.delete(req.params.id);
  const size = [...parts.values()].reduce((total, part) => total + part, 0);
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  const mimeType =
    { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' }[
      extension
    ] ?? 'application/octet-stream';
  const preview =
    typeof body.preview === 'string' ? Buffer.from(body.preview, 'base64') : undefined;
  const now = new Date(MOCK_NOW).toISOString();
  const values = {
    fileName,
    size,
    mimeType,
    lastModifiedAt: now,
    lastModifiedBy: PRINCIPAL.userDetails,
    hasPreview: preview !== undefined,
    preview,
  };
  if (existing) {
    Object.assign(existing, values);
    return json({ id: existing.id }, 201);
  }
  const category = 'Allgemein';
  const id = `01MOCKUP${req.params.id}`;
  downloads.push({ id, createdAt: now, createdBy: PRINCIPAL.userDetails, category, ...values });
  return json({ id }, 201);
});

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

route(['PATCH', 'DELETE'], '/api/intern/pflege/downloads/:id', (req) => {
  const index = downloads.findIndex((d) => d.id === req.params.id);
  if (index < 0) return notFound();
  if (req.method === 'DELETE') {
    downloads.splice(index, 1);
    return noContent();
  }
  const fileName = str(req.json?.fileName).trim();
  if (fileName && downloads.some((d, i) => i !== index && sameName(d.fileName, fileName)))
    return error(409, 'EXISTS', 'Eine Datei mit diesem Namen gibt es bereits.');
  if (fileName) downloads[index].fileName = fileName;
  const category = str(req.json?.category).trim();
  if (category) downloads[index].category = category;
  downloads[index].lastModifiedAt = new Date(MOCK_NOW).toISOString();
  return noContent();
});
