<script lang="ts">
  import FilterTabs from '../ui/FilterTabs.svelte';
  import PdfDownloadButton from '../ui/PdfDownloadButton.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { drawQrCode, qrDateiname, qrMindestPixel } from '../../lib/qrCode';
  import type { QrLogoBild, QrMatrix, QrOptionen } from '../../lib/qrCode';
  import { QR_PDF_ARTEN, downloadQrPdf, type QrPdfArt } from '../../lib/qrCodePdf';

  /** The code as a PDF: a DIN A4 Aushang or a sheet of small codes to stick on. */

  interface Props {
    matrix: QrMatrix | null;
    optionen: QrOptionen;
    logo: QrLogoBild | null;
  }
  let { matrix, optionen, logo }: Props = $props();

  let art = $state<QrPdfArt>('aushang');
  let beschriftung = $state('');

  async function download(): Promise<void> {
    if (!matrix) return;
    const text = optionen.text.trim();
    const canvas = document.createElement('canvas');
    // Sharp when printed large; never fewer pixels than a module needs to scan
    drawQrCode(canvas, matrix, optionen, Math.max(1600, qrMindestPixel(matrix.size)), logo);
    await downloadQrPdf({
      art,
      bild: canvas.toDataURL('image/png'),
      text,
      beschriftung,
      fileName: qrDateiname(text).replace(
        /\.png$/,
        art === 'aufkleber' ? ' Aufkleber.pdf' : ' Aushang.pdf'
      ),
    });
  }
</script>

<div class="mt-6 space-y-3 border-t border-neutral-200 pt-4">
  <div>
    <p class="form-label">PDF zum Drucken</p>
    <FilterTabs
      label="PDF zum Drucken"
      variant="segmented"
      options={QR_PDF_ARTEN}
      value={art}
      onselect={(value) => (art = value)}
    />
  </div>
  <FormField id="qr-beschriftung" label="Text unter dem Code (optional)">
    {#snippet children(attrs)}
      <input
        {...attrs}
        class="form-input"
        maxlength="80"
        placeholder="Zur Anmeldung fürs Sommerlager"
        bind:value={beschriftung}
      />
    {/snippet}
  </FormField>
  <PdfDownloadButton
    {download}
    class="w-full justify-center"
    disabled={!matrix}
    errorText="Das PDF konnte nicht erstellt werden. Lade die Seite neu und versuche es noch einmal."
  />
</div>
