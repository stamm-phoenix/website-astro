import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AUFKLEBER_SPALTEN,
  AUFKLEBER_ZEILEN,
  qrAufkleberRaster,
  qrAushangOben,
  qrLinkText,
} from '../src/lib/qrCodePdf';
import { PAGE_HEIGHT, PAGE_WIDTH } from '../src/lib/pdfBasis';

describe('qrLinkText', () => {
  test('a link without https:// and the closing slash; other text not at all', () => {
    assert.equal(qrLinkText(' https://www.stamm-phoenix.de/ '), 'www.stamm-phoenix.de');
    assert.equal(qrLinkText('http://example.org/a?b=1'), 'example.org/a?b=1');
    assert.equal(qrLinkText('WIFI:S:Zeltplatz;P:geheim;;'), '');
    assert.equal(qrLinkText('Hallo Welt'), '');
  });
});

describe('qrAufkleberRaster', () => {
  test('all stickers fit on the page without overlapping, with room for their text', () => {
    const felder = qrAufkleberRaster();
    assert.equal(felder.length, AUFKLEBER_SPALTEN * AUFKLEBER_ZEILEN);
    const cellHeight = (PAGE_HEIGHT - 20) / AUFKLEBER_ZEILEN;
    for (const feld of felder) {
      assert.ok(feld.size >= 30, 'big enough to scan');
      assert.ok(feld.x >= 10 && feld.x + feld.size <= PAGE_WIDTH - 10);
      assert.ok(feld.y >= 10 && feld.y + feld.size + 8 <= PAGE_HEIGHT - 10);
    }
    assert.ok(felder[AUFKLEBER_SPALTEN].y - felder[0].y >= felder[0].size + 8);
    assert.ok(Math.abs(felder[AUFKLEBER_SPALTEN].y - felder[0].y - cellHeight) < 1e-9);
  });
});

describe('qrAushangOben', () => {
  test('centres code, text and link on the page', () => {
    const ohne = qrAushangOben(0, 0);
    assert.equal(ohne, (PAGE_HEIGHT - 150) / 2);
    assert.ok(qrAushangOben(2, 1) < ohne);
    assert.ok(qrAushangOben(4, 3) >= 20);
  });
});
