<script lang="ts">
  import LoadState from '../ui/LoadState.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import { postfachStart } from '../../lib/postfachStore.svelte';
  import { postfachHref } from '../../lib/postfaecher';
  import { konversationHash, mailZeitKurz } from '../../lib/postfachAnsicht';
  import { istMirZugewiesen, type KonversationZeile } from '../../../../api/lib/postfach-model';

  /**
   * The body of the card „E-Mails“ on the start page: new conversations, and those that need
   * action from the person or from nobody yet, from all mailboxes they see. The dashboard loads
   * the data.
   */
  interface Props {
    limit: number;
  }
  let { limit }: Props = $props();

  const store = postfachStart.state;
  const zeilen = $derived(store.data?.fuerMich ?? []);
  const ich = $derived(store.data?.ich ?? '');
  const postfaecher = $derived(store.data?.postfaecher ?? []);
  const mehrere = $derived(postfaecher.length > 1);
  const gestoert = $derived(postfaecher.filter((postfach) => postfach.fehler));

  function name(zeile: KonversationZeile): string {
    return postfaecher.find((postfach) => postfach.id === zeile.postfach)?.name ?? '';
  }
</script>

<LoadState
  data={store.data}
  loading={store.loading}
  error={store.error}
  loadingText="E-Mails werden geladen …"
  onretry={() => void postfachStart.load({ force: true })}
>
  {#snippet skeleton()}
    <p aria-hidden="true" class="mt-2 text-sm text-neutral-700">E-Mails werden geladen …</p>
  {/snippet}
  {#each gestoert as postfach (postfach.id)}
    <p class="mt-1 text-sm text-danger">
      {#if postfach.gesperrt}
        Die Website darf das {postfach.name} gerade nicht lesen. Bitte melde das an
        <a class="text-link" href="mailto:admin@stamm-phoenix.de">admin@stamm-phoenix.de</a>.
      {:else}
        {postfach.name} konnte nicht geladen werden.
        <button
          type="button"
          class="text-link min-h-11 underline underline-offset-4"
          onclick={() => void postfachStart.load({ force: true })}>Erneut versuchen</button
        >
      {/if}
      ·
      <a class="text-link" href={postfachHref(postfach.id)}>Zum Postfach</a>
    </p>
  {/each}
  <ul class="mt-1 divide-y divide-neutral-200" data-testid="meine-emails">
    {#each zeilen.slice(0, limit) as zeile (zeile.postfach + zeile.id)}
      <li>
        <a
          href="{postfachHref(zeile.postfach)}{konversationHash(zeile.id)}"
          class="block min-h-11 py-2"
          title={zeile.betreff}
        >
          <span class="text-link block truncate" class:font-semibold={zeile.status === 'neu'}
            >{zeile.betreff}</span
          >
          <span class="flex flex-wrap items-center gap-x-2 text-sm text-neutral-700">
            <span class="max-w-full truncate"
              >{zeile.von.name} · {mailZeitKurz(zeile.am)}{mehrere ? ` · ${name(zeile)}` : ''}</span
            >
            {#if istMirZugewiesen(zeile, ich)}<StatusLabel
                label="Dir zugewiesen"
                tone="warning"
                dot
              />{:else if zeile.status === 'neu'}<StatusLabel
                label="Neu"
                tone="danger"
                dot
              />{:else if zeile.zustaendig}<StatusLabel
                label={zeile.zustaendig.name}
                tone="warning"
                dot
              />{:else}<StatusLabel label="Niemand zuständig" tone="warning" dot />{/if}
          </span>
        </a>
      </li>
    {/each}
  </ul>
  {#if zeilen.length > limit}
    <p class="pt-2 text-sm text-neutral-700">und {zeilen.length - limit} weitere</p>
  {/if}
</LoadState>
