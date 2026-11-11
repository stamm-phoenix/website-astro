<script lang="ts">
  import ModalDialog from '../ui/ModalDialog.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import { belegDetails } from '../../lib/belegDetails';
  import BelegPdfSeiten from './BelegPdfSeiten.svelte';
  import { ladePdf, photoUrl } from '../../lib/belegForm';
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
    const reason = beleg.status === 'Abgelehnt' ? beleg.reviewNote : '';
    return [
      ...belegDetails(beleg),
      ...(reason ? [['Begründung der Kasse', reason] as [string, string]] : []),
    ];
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
          alt={`${beleg.isPdf ? 'Erste Seite des PDFs' : 'Foto des Belegs'} von ${beleg.shop || 'unbekannt'}`}
          width="600"
          height="800"
          class="aspect-[3/4] h-auto w-full rounded-md bg-neutral-100 object-contain"
        />
        {#if beleg.isPdf}
          <BelegPdfSeiten
            schluessel={photoUrl(beleg)}
            laden={(signal) => ladePdf(beleg, signal)}
            class="h-auto w-full rounded-md bg-neutral-100 object-contain"
          />
          <a class="btn-secondary" href="{photoUrl(beleg)}&download=1" download>PDF herunterladen</a
          >
        {/if}
      {/if}
    </div>
  {/if}
</ModalDialog>
