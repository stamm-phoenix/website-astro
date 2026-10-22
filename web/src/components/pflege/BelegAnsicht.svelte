<script lang="ts">
  import ModalDialog from '../ui/ModalDialog.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import { formatIsoDate } from '../../lib/belege';
  import { photoUrl } from '../../lib/belegForm';
  import { formatEuro } from '../../lib/format';
  import type { StaffBeleg } from '../../lib/types';
  interface Props {
    /** A receipt someone else submitted for the user's Auslage: to look at, not to change. */
    beleg: StaffBeleg | null;
    onclose: () => void;
  }
  let { beleg, onclose }: Props = $props();

  const TONE = { Eingereicht: 'neutral', Angenommen: 'success', Abgelehnt: 'danger' } as const;

  const details = $derived.by<[string, string][]>(() => {
    if (!beleg) return [];
    const rows: [string, string | null][] = [
      ['Datum', beleg.date ? formatIsoDate(beleg.date) : null],
      ['Betrag', formatEuro(beleg.amountCent)],
      ['Aktion', beleg.aktion || null],
      ['Ausgelegt von', beleg.paidBy || null],
      ['Bemerkung', beleg.note || null],
      ['Eingereicht von', beleg.submittedBy || null],
      ['Begründung der Kasse', beleg.status === 'Abgelehnt' ? beleg.reviewNote || null : null],
    ];
    return rows.filter((row): row is [string, string] => !!row[1]);
  });
</script>

<ModalDialog
  open={beleg !== null}
  title={beleg ? `Beleg von ${beleg.shop || 'unbekannt'}` : ''}
  size="medium"
  dismissOnBackdrop
  {onclose}
>
  {#if beleg}
    <div class="min-h-0 space-y-4 overflow-y-auto px-5 py-4">
      <StatusLabel label={beleg.status} tone={TONE[beleg.status]} dot />
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {#each details as [label, value] (label)}
          <dt class="font-semibold text-neutral-700">{label}</dt>
          <dd class="min-w-0 break-words text-neutral-900">{value}</dd>
        {/each}
      </dl>
      {#if beleg.hasImage}
        <img
          src={photoUrl(beleg)}
          alt={`Foto des Belegs von ${beleg.shop || 'unbekannt'}`}
          width="600"
          height="800"
          class="aspect-[3/4] h-auto w-full rounded-md bg-neutral-100 object-contain"
        />
      {/if}
    </div>
  {/if}
</ModalDialog>
