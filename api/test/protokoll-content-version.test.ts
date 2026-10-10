import assert from 'node:assert/strict';
import test from 'node:test';
import { docxContentVersion, withProtokollContentVersion } from '../lib/protokoll-content-version';
import { writeZip } from '../lib/zip';
import { docx, paragraph } from './fixtures/docx';
import * as sharePoint from '../lib/sharepoint-data-access';
import type { ProtokollDriveItem } from '../lib/protokolle';

test('Word content fingerprints ignore SharePoint properties but detect text, style and image edits', () => {
  const parts = [
    { name: 'word/document.xml', data: Buffer.from('<document>Meeting</document>') },
    { name: 'word/styles.xml', data: Buffer.from('<style>original</style>') },
    { name: 'word/media/image.png', data: Buffer.from('image') },
  ];
  const version = docxContentVersion(writeZip(parts));
  assert.equal(
    docxContentVersion(
      writeZip([
        ...[...parts].reverse(),
        { name: 'customXml/item3.xml', data: Buffer.from('SharePoint Termin JSON') },
        { name: '[trash]/0003.dat', data: Buffer.from('old metadata') },
        { name: 'docProps/core.xml', data: Buffer.from('modified timestamp') },
      ])
    ),
    version
  );
  for (let index = 0; index < parts.length; index++) {
    const changed = parts.map((part, i) =>
      i === index ? { ...part, data: Buffer.from('edited') } : part
    );
    assert.notEqual(docxContentVersion(writeZip(changed)), version);
  }
  assert.throws(() => docxContentVersion(writeZip([])), /Not a Word file/);
});

test('a file changing while its fingerprint is downloaded cannot validate a stored version', async (t) => {
  const file = docx(paragraph('Original meeting'));
  const item: ProtokollDriveItem = {
    id: 'version-race',
    name: 'meeting.docx',
    cTag: 'before',
    listItem: { eTag: 'before', fields: { FreigabeVersion: docxContentVersion(file) } },
  };
  t.mock.method(sharePoint, 'getSharePointDriveFileContent', async () => file);
  t.mock.method(sharePoint, 'getSharePointDriveItemWithFields', async () => ({
    ...item,
    cTag: 'after',
  }));
  assert.equal((await withProtokollContentVersion('drive', item)).contentVersion, '');
});
