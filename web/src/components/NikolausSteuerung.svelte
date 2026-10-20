<script lang="ts">
  import { untrack } from 'svelte';
  import LoadState from './ui/LoadState.svelte';
  import ReloadButton from './pflege/ReloadButton.svelte';
  import StatusNotice from './pflege/StatusNotice.svelte';
  import { nikolausSteuerung } from '../lib/pflegeStore.svelte';
  import { formatDay } from '../lib/nikolausSteuerungForm';
  import NikolausSettingsForm from './nikolaus/NikolausSettingsForm.svelte';
  import NikolausCleanup from './nikolaus/NikolausCleanup.svelte';
  import NikolausGeocoding from './nikolaus/NikolausGeocoding.svelte';
  import NikolausAuditLog from './nikolaus/NikolausAuditLog.svelte';
  const store = nikolausSteuerung.state;
  const data = $derived(store.data);
  let message = $state<string | null>(null);
  let messageKind = $state<'success' | 'error'>('success');
  function onnotice(text: string | null, kind: 'success' | 'error'): void {
    message = text;
    messageKind = kind;
  }
  $effect(() => {
    untrack(() => nikolausSteuerung.load());
  });
</script>

<div class="space-y-8">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <StatusNotice {message} kind={messageKind} class="min-w-0 flex-1" popup />
    <ReloadButton resource={nikolausSteuerung} />
  </div>

  <LoadState
    {data}
    loading={store.loading}
    error={store.error}
    loadingText="Einstellungen werden geladen …"
    onretry={() => void nikolausSteuerung.load({ force: true })}
  >
    {#snippet skeleton()}
      <div class="space-y-4">
        <div class="skeleton-element h-40 rounded-[var(--radius-lg)]"></div>
        <div class="skeleton-element h-64 rounded-[var(--radius-lg)]"></div>
      </div>
    {/snippet}
    {#snippet children(data)}
      {#if data.cleanup.due}
        <section class="surface border-l-4! border-l-danger! p-5" aria-labelledby="due-heading">
          <h2 id="due-heading" class="text-lg font-semibold text-danger">Löschfrist erreicht</h2>
          <p class="mt-1 text-sm text-neutral-800">
            Der letzte Besuch war am {formatDay(data.cleanup.lastVisit)}. Laut Datenschutzerklärung
            müssen die Daten seit dem {formatDay(data.cleanup.deleteBy)} gelöscht sein.
            <a class="font-semibold text-link underline" href="#cleanup-heading">Zum Löschen</a>
          </p>
        </section>
      {/if}

      <NikolausSettingsForm {data} {onnotice} />
      <NikolausCleanup {data} {onnotice} />
      <NikolausGeocoding {data} {onnotice} />
      <NikolausAuditLog entries={data.log} />
    {/snippet}
  </LoadState>
</div>
