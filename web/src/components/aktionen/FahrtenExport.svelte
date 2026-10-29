<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import PdfHerunterladen from './PdfHerunterladen.svelte';
  import { fahrtenRows } from '../../lib/fahrtenCsv';
  import type { FahrtPlan } from '../../lib/fahrtenPlan';
  import { sammelCsv } from '../../lib/sammelExport';

  interface Props {
    title: string;
    /** Dates of the Aktion. */
    range: string;
    plans: FahrtPlan[];
    onresult: (result: { message: string; kind: 'success' | 'error' }) => void;
  }

  let { title, range, plans, onresult }: Props = $props();

  function downloadCsv(): void {
    const url = URL.createObjectURL(
      new Blob([sammelCsv(fahrtenRows(plans))], { type: 'text/csv;charset=utf-8' })
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `fahrten-${title.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadPdf(): Promise<void> {
    const { downloadFahrtenPdf } = await import('../../lib/fahrtenPdf');
    await downloadFahrtenPdf({ title, range, plans });
  }
</script>

<PdfHerunterladen
  create={downloadPdf}
  errorText="Das PDF der Fahrten konnte nicht erstellt werden. Lade die Seite neu und versuch es noch einmal."
  {onresult}
/>
<ActionButton onclick={downloadCsv}>Als CSV</ActionButton>
