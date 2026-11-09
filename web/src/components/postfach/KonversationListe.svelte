<script lang="ts">
  import StatusLabel from '../ui/StatusLabel.svelte';
  import { istMirZugewiesen, type KonversationZeile } from '../../../../api/lib/postfach-model';
  import { konversationHash, mailZeitKurz, STATUS_LABEL } from '../../lib/postfachAnsicht';

  /**
   * The conversations of a mailbox: new ones bold with a dot, those needing action with a flag,
   * done ones ticked off, and the responsible person as a label. Each line is a link to
   * `#konversation=<id>`, so a new tab works as expected; the box in front chooses it for the
   * actions on several at once.
   */
  interface Props {
    zeilen: KonversationZeile[];
    ich: string;
    aktiv: string | null;
    /** Sentence shown when the filter leaves nothing. */
    leer: string;
    /** Offered next to that sentence while filters are set. */
    onzuruecksetzen?: () => void;
    /** A plain click opens the conversation on this page; a new tab follows the link. */
    onoeffnen: (id: string) => void;
    /** The chosen conversations. */
    ausgewaehlt: ReadonlySet<string>;
    /** While the chosen ones are saved. */
    auswahlGesperrt: boolean;
    onwaehle: (id: string, gewaehlt: boolean) => void;
  }
  let {
    zeilen,
    ich,
    aktiv,
    leer,
    onzuruecksetzen,
    onoeffnen,
    ausgewaehlt,
    auswahlGesperrt,
    onwaehle,
  }: Props = $props();

  function klick(event: MouseEvent, id: string): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    onoeffnen(id);
  }
</script>

{#if zeilen.length === 0}
  <div class="flex flex-wrap items-center gap-x-3 p-4 text-sm text-neutral-700">
    <p>{leer}</p>
    {#if onzuruecksetzen}<button
        type="button"
        class="text-link min-h-11 underline underline-offset-4"
        onclick={onzuruecksetzen}>Filter zurücksetzen</button
      >{/if}
  </div>
{:else}
  <ul class="divide-y divide-neutral-200" data-testid="postfach-liste">
    {#each zeilen as zeile (zeile.id)}
      {@const neu = zeile.status === 'neu'}
      {@const gewaehlt = ausgewaehlt.has(zeile.id)}
      <li class="flex items-stretch" class:bg-brand-50={gewaehlt}>
        <label
          class="flex min-h-11 w-11 shrink-0 cursor-pointer items-start justify-center pt-3"
          title="Auswählen"
        >
          <input
            type="checkbox"
            class="size-5 cursor-pointer accent-brand-900"
            checked={gewaehlt}
            disabled={auswahlGesperrt}
            onchange={(event) => onwaehle(zeile.id, event.currentTarget.checked)}
          />
          <span class="sr-only">„{zeile.betreff}“ von {zeile.von.name} auswählen</span>
        </label>
        <a
          href={konversationHash(zeile.id)}
          onclick={(event) => klick(event, zeile.id)}
          aria-current={zeile.id === aktiv ? 'true' : undefined}
          class="block min-h-11 min-w-0 flex-1 py-2.5 pr-3 no-underline hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-900 aria-[current=true]:bg-neutral-100 aria-[current=true]:shadow-[inset_3px_0_0_var(--color-dpsg-red)]"
        >
          <span class="flex items-baseline gap-2">
            {#if zeile.status === 'erledigt'}
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
            {:else if zeile.status === 'handlungsbedarf'}
              <!-- The flag of Outlook -->
              <svg
                class="size-4 shrink-0 self-center text-warning"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"><path d="M5 21V4h11l-1.5 4L16 12H7v9z" /></svg
              >
            {:else}
              <span class="size-2 shrink-0 self-center rounded-full bg-[var(--color-dpsg-red)]"
              ></span>
            {/if}
            <span
              class="min-w-0 flex-1 truncate text-brand-900"
              class:font-semibold={neu}
              title={zeile.von.adresse}>{zeile.von.name}</span
            >
            <span class="shrink-0 text-xs text-neutral-700 tabular-nums"
              >{mailZeitKurz(zeile.am)}</span
            >
          </span>
          <span
            class="mt-0.5 flex items-baseline gap-1.5 text-sm text-brand-900"
            class:font-semibold={neu}
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
            {#if zeile.status === 'erledigt'}
              <StatusLabel label={STATUS_LABEL.erledigt} tone="success" />
            {:else if zeile.status === 'handlungsbedarf'}
              <StatusLabel label={STATUS_LABEL.handlungsbedarf} tone="warning" dot />
            {:else}
              <StatusLabel label={STATUS_LABEL.neu} tone="danger" dot />
            {/if}
            {#if zeile.zustaendig}
              <StatusLabel
                label={istMirZugewiesen(zeile, ich) ? 'Dir zugewiesen' : zeile.zustaendig.name}
                tone={istMirZugewiesen(zeile, ich) ? 'warning' : 'neutral'}
                dot
              />
            {:else if zeile.status !== 'erledigt'}
              <StatusLabel label="Niemand zuständig" tone="neutral" />
            {/if}
            {#if zeile.wichtig}<StatusLabel label="Wichtig" tone="danger" />{/if}
          </span>
        </a>
      </li>
    {/each}
  </ul>
{/if}
