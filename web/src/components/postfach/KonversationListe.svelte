<script lang="ts">
  import StatusLabel from '../ui/StatusLabel.svelte';
  import { istMirZugewiesen, type KonversationZeile } from '../../../../api/lib/postfach-model';
  import { konversationHash, mailZeitKurz, STATUS_LABEL } from '../../lib/postfachAnsicht';

  /**
   * The conversations of a mailbox: unread ones bold with a dot, the responsible person as a
   * label. Each line is a link to `#konversation=<id>`, so a new tab works as expected.
   */
  interface Props {
    zeilen: KonversationZeile[];
    ich: string;
    aktiv: string | null;
    /** Sentence shown when the filter leaves nothing. */
    leer: string;
    /** A plain click opens the conversation on this page; a new tab follows the link. */
    onoeffnen: (id: string) => void;
  }
  let { zeilen, ich, aktiv, leer, onoeffnen }: Props = $props();

  function klick(event: MouseEvent, id: string): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    onoeffnen(id);
  }
</script>

{#if zeilen.length === 0}
  <p class="p-4 text-sm text-neutral-700">{leer}</p>
{:else}
  <ul class="divide-y divide-neutral-200" data-testid="postfach-liste">
    {#each zeilen as zeile (zeile.id)}
      {@const ungelesen = zeile.ungelesen > 0}
      {@const erledigung = zeile.erledigung}
      <li>
        <a
          href={konversationHash(zeile.id)}
          onclick={(event) => klick(event, zeile.id)}
          aria-current={zeile.id === aktiv ? 'true' : undefined}
          class="block min-h-11 px-3 py-2.5 no-underline hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-900 aria-[current=true]:bg-neutral-100 aria-[current=true]:shadow-[inset_3px_0_0_var(--color-dpsg-red)]"
        >
          <span class="flex items-baseline gap-2">
            {#if erledigung}
              <!-- Ticked off, so done ones stand out from open ones at a glance -->
              <svg
                class="size-4 shrink-0 self-center text-success"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg
              >
            {:else if ungelesen}
              <span class="size-2 shrink-0 self-center rounded-full bg-[var(--color-dpsg-red)]"
              ></span>
              <span class="sr-only">Ungelesen:</span>
            {/if}
            <span
              class="min-w-0 flex-1 truncate text-brand-900"
              class:font-semibold={ungelesen}
              title={zeile.von.adresse}>{zeile.von.name}</span
            >
            <span class="shrink-0 text-xs text-neutral-700 tabular-nums"
              >{mailZeitKurz(zeile.am)}</span
            >
          </span>
          <span
            class="mt-0.5 flex items-baseline gap-1.5 text-sm text-brand-900"
            class:font-semibold={ungelesen}
          >
            <span class="min-w-0 truncate">{zeile.betreff}</span>
            {#if zeile.anzahl > 1}<span class="shrink-0 text-xs text-neutral-700"
                >({zeile.anzahl})</span
              >{/if}
            {#if zeile.hatAnhang}<span class="shrink-0 text-xs text-neutral-700" title="Mit Anhang"
                >📎<span class="sr-only">Mit Anhang</span></span
              >{/if}
          </span>
          <span class="mt-0.5 block truncate text-sm text-neutral-700">{zeile.vorschau}</span>
          <span class="mt-1 flex flex-wrap gap-2 text-sm">
            {#if erledigung}
              <StatusLabel
                label="{STATUS_LABEL[erledigung.status]} · {erledigung.login.toLowerCase() ===
                ich.toLowerCase()
                  ? 'du'
                  : erledigung.name}"
                tone="success"
              />
            {:else if zeile.wiederOffen}
              <StatusLabel label="Neue Nachricht nach „Erledigt“" tone="warning" dot />
            {/if}
            {#if zeile.zustaendig}
              <StatusLabel
                label={istMirZugewiesen(zeile, ich) ? 'Dir zugewiesen' : zeile.zustaendig.name}
                tone={istMirZugewiesen(zeile, ich) ? 'warning' : 'neutral'}
                dot
              />
            {:else if !erledigung}
              <StatusLabel label="Niemand zuständig" tone="neutral" />
            {/if}
            {#if zeile.wichtig}<StatusLabel label="Wichtig" tone="danger" />{/if}
          </span>
        </a>
      </li>
    {/each}
  </ul>
{/if}
