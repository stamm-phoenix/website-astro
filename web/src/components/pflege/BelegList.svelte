<script lang="ts">
  import BelegStatusLabel from './BelegStatusLabel.svelte';
  import { photoUrl } from '../../lib/belegForm';
  import { formatIsoDate } from '../../lib/belege';
  import { formatEuro } from '../../lib/format';
  import type { StaffBeleg } from '../../lib/types';
  interface Props {
    items: StaffBeleg[];
    onedit: (beleg: StaffBeleg) => void;
  }
  let { items, onedit }: Props = $props();
</script>

<ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
  {#each items as beleg (beleg.id)}
    <li class="min-w-0">
      <button
        type="button"
        class="card flex w-full items-start gap-3 text-left hover:border-[var(--color-brand-300)]"
        onclick={() => onedit(beleg)}
      >
        {#if beleg.hasImage}
          <img
            src={photoUrl(beleg, '&thumb=1')}
            alt=""
            aria-hidden="true"
            width="64"
            height="80"
            loading="lazy"
            class="h-20 w-16 shrink-0 rounded-md bg-neutral-100 object-cover"
          />
        {/if}
        <span class="min-w-0 flex-1">
          <span class="flex flex-wrap items-start justify-between gap-x-2">
            <span class="min-w-0 break-words font-semibold text-brand-900">{beleg.shop}</span>
            <span class="shrink-0 font-semibold text-brand-900">{formatEuro(beleg.amountCent)}</span
            >
          </span>
          <span class="block truncate text-sm text-neutral-700">
            {formatIsoDate(beleg.date)} · {beleg.aktion}
          </span>
          <span class="block truncate text-xs text-neutral-700">Bezahlt von {beleg.paidBy}</span>
          {#if beleg.status === 'Abgelehnt' && beleg.reviewNote}
            <span class="mt-1 line-clamp-2 block text-xs text-danger"
              >Abgelehnt: {beleg.reviewNote}</span
            >
          {/if}
          <span class="mt-1.5 flex flex-wrap gap-1">
            <BelegStatusLabel status={beleg.status} />
            {#if beleg.payout}
              <span class="tag">Auszahlung</span>
            {/if}
            {#if beleg.aiCheck && !beleg.aiCheck.ok}
              <span
                class="rounded-sm bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning"
                >Automatische Prüfung: Foto prüfen</span
              >
            {/if}
            {#if beleg.aiCheck?.restrictedItems.length}
              <span class="rounded-sm bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger"
                >Wird von der Kasse geprüft: evtl. Alkohol/Tabak</span
              >
            {/if}
          </span>
        </span>
        <span class="sr-only">öffnen</span>
      </button>
    </li>
  {/each}
</ul>
