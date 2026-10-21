<script lang="ts">
  import CampflowBelegBild from '../CampflowBelegBild.svelte';
  import ModalDialog from '../ui/ModalDialog.svelte';
  import { formatIsoDate } from '../../lib/belege';
  import { formatTimestamp } from '../../lib/belegForm';
  import { formatEuro } from '../../lib/format';
  import type { TransferredBeleg } from '../../lib/types';
  interface Props {
    beleg: TransferredBeleg | null;
    onclose: () => void;
  }
  let { beleg, onclose }: Props = $props();

  const details = $derived<[string, string][]>(
    beleg
      ? [
          ['Belegnummer in CampFlow', beleg.number],
          ['Datum', formatIsoDate(beleg.date)],
          ['Betrag', formatEuro(beleg.amountCent)],
          ['Bezahlt von', `${beleg.paidBy}${beleg.payout ? ' (Auszahlung)' : ''}`],
          ['Aktion', beleg.aktion],
          ['Kostenstelle', beleg.costUnitName],
          ['Kategorie', beleg.categoryName],
          ...(beleg.note ? [['Bemerkung', beleg.note] as [string, string]] : []),
          ['Eingereicht von', beleg.submittedBy],
          ['Übertragen', `${formatTimestamp(beleg.transferredAt)} von ${beleg.transferredBy}`],
        ]
      : []
  );
</script>

<ModalDialog
  open={beleg !== null}
  title={beleg ? `Beleg von ${beleg.shop}` : ''}
  size="medium"
  dismissOnBackdrop
  {onclose}
>
  {#if beleg}
    <div class="min-h-0 space-y-4 overflow-y-auto px-5 py-4">
      <p class="text-sm text-neutral-700">
        Dieser Beleg ist in CampFlow gebucht. Ändern kannst du ihn nur noch dort.
      </p>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {#each details as [label, value] (label)}
          <dt class="font-semibold text-neutral-700">{label}</dt>
          <dd class="min-w-0 break-words text-neutral-900">{value}</dd>
        {/each}
      </dl>
      <CampflowBelegBild receiptNumber={beleg.number} />
    </div>
  {/if}
</ModalDialog>
