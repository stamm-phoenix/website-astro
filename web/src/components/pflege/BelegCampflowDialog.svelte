<script lang="ts">
  import CampflowBelegBild from '../CampflowBelegBild.svelte';
  import ModalDialog from '../ui/ModalDialog.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import { formatIsoDate } from '../../lib/belege';
  import { campflowBildKey, campflowStand } from '../../lib/belegEintraege';
  import { formatEuro } from '../../lib/format';
  import type { CampflowBeleg } from '../../lib/types';
  interface Props {
    beleg: CampflowBeleg | null;
    onclose: () => void;
  }
  let { beleg, onclose }: Props = $props();

  const CAMPFLOW_BELEGE = 'https://my.campflow.de/dpsg-stamm-phoenix-5629/finance/receipts';

  const state = $derived(beleg ? campflowStand(beleg) : null);
  const details = $derived.by<[string, string][]>(() => {
    if (!beleg) return [];
    const rows: [string, string | null][] = [
      ['Belegnummer', beleg.number],
      ['Datei', beleg.fileName],
      ['Belegdatum', beleg.date ? formatIsoDate(beleg.date) : null],
      [
        beleg.amountCent > 0 ? 'Einnahme' : 'Betrag',
        beleg.status === 'unbooked' ? null : formatEuro(Math.abs(beleg.amountCent)),
      ],
      [
        'Noch nicht zugeordnet',
        beleg.status === 'open' && beleg.openCent !== beleg.amountCent
          ? formatEuro(Math.abs(beleg.openCent))
          : null,
      ],
      ['Ausgelegt von', beleg.paidBy],
      ['Kostenstelle', beleg.costUnits.map((unit) => unit.name).join(', ') || null],
      ['Kategorie', beleg.categories.map((category) => category.name).join(', ') || null],
      ['Hochgeladen', beleg.uploadedAt ? formatIsoDate(beleg.uploadedAt.slice(0, 10)) : null],
      [
        'Eingereicht',
        beleg.viaWebsite
          ? beleg.submittedByMe
            ? 'von dir über die Website'
            : 'über die Website'
          : null,
      ],
    ];
    return rows.filter((row): row is [string, string] => !!row[1]);
  });
</script>

<ModalDialog
  open={beleg !== null}
  title={beleg ? beleg.description || beleg.fileName || 'Beleg in CampFlow' : ''}
  size="medium"
  dismissOnBackdrop
  {onclose}
>
  {#if beleg && state}
    <div class="min-h-0 space-y-4 overflow-y-auto px-5 py-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <StatusLabel label={state.label} tone={state.tone} dot />
        <a href={CAMPFLOW_BELEGE} class="btn-secondary" target="_blank" rel="noopener"
          >In CampFlow öffnen</a
        >
      </div>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {#each details as [label, value] (label)}
          <dt class="font-semibold text-neutral-700">{label}</dt>
          <dd class="min-w-0 break-words text-neutral-900">{value}</dd>
        {/each}
      </dl>
      <CampflowBelegBild receiptNumber={campflowBildKey(beleg)} />
    </div>
  {/if}
</ModalDialog>
