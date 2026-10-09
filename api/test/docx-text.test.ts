import assert from 'node:assert/strict';
import test from 'node:test';
import { DocxError, docxToText, documentXmlToText } from '../lib/docx-text';
import { writeZip } from '../lib/zip';
import { cell, docx, documentXml, paragraph } from './fixtures/docx';

test('paragraphs become lines and runs of one paragraph stay together', () => {
  // Defect: Word splits a sentence into several runs; joining them with spaces or line breaks
  // would tear dates like „4.11.“ apart
  const text = documentXmlToText(
    documentXml(
      paragraph('Nächste LR: ', '4.11.', '2026') +
        paragraph('') +
        paragraph('') +
        paragraph('') +
        paragraph('Ende')
    )
  );
  assert.equal(text, 'Nächste LR: 4.11.2026\n\nEnde');
});

test('entities are decoded, tabs separate words and line breaks are kept', () => {
  // Defect: „&amp;“ or „&#228;“ left as is would garble places and quotes; a tab between
  // „Termin:“ and the date would otherwise glue them together
  const xml = documentXml(
    '<w:p><w:r><w:t>Ort &amp; Zeit: &lt;Pfadiheim&gt; &#228;&#xE4; &quot;19 Uhr&quot;</w:t></w:r>' +
      '<w:r><w:tab/><w:t>Zeile 1</w:t><w:br/><w:t>Zeile 2</w:t></w:r></w:p>'
  );
  assert.equal(documentXmlToText(xml), 'Ort & Zeit: <Pfadiheim> ää "19 Uhr" Zeile 1\nZeile 2');
});

test('table rows become one line with their cells, nested tables included', () => {
  // Defect: protocols keep the agenda in tables; dropping them loses the date of the next LR
  const nested = `<w:tbl><w:tr>${cell(paragraph('innen'))}${cell(paragraph('x'))}</w:tr></w:tbl>`;
  const xml = documentXml(
    paragraph('Vor der Tabelle') +
      '<w:tbl><w:tblPr/>' +
      `<w:tr>${cell(paragraph('TOP'))}${cell(paragraph('Inhalt'))}</w:tr>` +
      `<w:tr>${cell(paragraph('7'))}${cell(paragraph('Nächste LR am 4.11.'), paragraph('19:30 Uhr'))}</w:tr>` +
      `<w:tr>${cell(paragraph(''))}${cell(paragraph(''))}</w:tr>` +
      `<w:tr>${cell(paragraph('8'))}${cell(nested)}</w:tr>` +
      '</w:tbl>' +
      paragraph('Nach der Tabelle')
  );
  assert.equal(
    documentXmlToText(xml),
    'Vor der Tabelle\nTOP | Inhalt\n7 | Nächste LR am 4.11. / 19:30 Uhr\n8 | innen | x\n\nNach der Tabelle'
  );
});

test('deleted text, field codes, tab stops and fallbacks are not part of the text', () => {
  // Defect: a date deleted with tracked changes or repeated in a fallback would show up as a
  // second candidate and make the detection unclear
  const xml = documentXml(
    '<w:p><w:del w:id="1"><w:r><w:delText>11.11.</w:delText></w:r></w:del>' +
      '<w:r><w:instrText> DATE \\@ "dd.MM.yyyy" </w:instrText></w:r>' +
      '<w:r><w:t>18.11.</w:t></w:r>' +
      '<mc:AlternateContent><mc:Choice Requires="wps"><w:r><w:t> Box</w:t></w:r></mc:Choice>' +
      '<mc:Fallback><w:r><w:t> Box</w:t></w:r></mc:Fallback></mc:AlternateContent></w:p>'
  );
  assert.equal(documentXmlToText(xml), '18.11. Box');
});

test('a Word file is read from its ZIP archive, anything else is refused', () => {
  assert.equal(docxToText(docx(paragraph('Hallo'))), 'Hallo');
  assert.throws(() => docxToText(new Uint8Array([1, 2, 3])), DocxError);
  assert.throws(
    () => docxToText(writeZip([{ name: 'xl/workbook.xml', data: Buffer.from('<x/>') }])),
    DocxError
  );
});
