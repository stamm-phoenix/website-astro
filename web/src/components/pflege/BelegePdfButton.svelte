<script lang="ts">
  import PdfDownloadButton from '../ui/PdfDownloadButton.svelte';
  import type { BelegEintrag, BelegFilter } from '../../lib/belegEintraege';

  /** The listed receipts as a PDF, with the filters named at the top. */

  interface Props {
    eintraege: BelegEintrag[];
    filter: BelegFilter;
    kostenstellen: { id: string; name: string; categories: { id: string; name: string }[] }[];
    disabled?: boolean;
  }
  let { eintraege, filter, kostenstellen, disabled = false }: Props = $props();

  async function download(): Promise<void> {
    const unit = kostenstellen.find((k) => k.id === filter.costUnitId);
    const [shown, shownFilter] = [eintraege, { ...filter }];
    const names = {
      kostenstelle: unit?.name,
      kategorie: unit?.categories.find((c) => c.id === filter.categoryId)?.name,
    };
    const { downloadBelegePdf } = await import('../../lib/belegePdf');
    await downloadBelegePdf(shown, shownFilter, names);
  }
</script>

<PdfDownloadButton
  {download}
  disabled={disabled || eintraege.length === 0}
  errorText="Das PDF der Belege konnte nicht erstellt werden. Lade die Seite neu und versuche es noch einmal."
/>
