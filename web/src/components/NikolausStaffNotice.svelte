<script lang="ts">
  import { untrack } from 'svelte';
  import { formatNikolausDate } from '../lib/nikolausConfig';
  import { fetchNikolausStatus, nikolausStatusStore } from '../lib/nikolausStatusStore.svelte';

  interface Props {
    /** On the pages of the Nikolaus modules: also says when they are switched off. */
    module?: boolean;
  }
  let { module = false }: Props = $props();

  const status = $derived(nikolausStatusStore.data);

  $effect(() => {
    untrack(() => fetchNikolausStatus());
  });
</script>

<div role="status" aria-live="polite">
  {#if status?.deletionDue && status.deleteBy}
    <p class="mb-4 border-l-4 border-danger py-2 pl-4 text-sm text-neutral-800">
      <strong class="text-danger">Nikolausdienst: Löschfrist erreicht.</strong>
      Die Daten der Familien und Helfenden mussten bis {formatNikolausDate(status.deleteBy)}
      gelöscht werden.
      <a href="/leitendenbereich/nikolaus-steuerung" class="font-semibold text-link"
        >Zur Steuerung</a
      >
    </p>
  {/if}
  {#if status?.maintenance}
    <p class="mb-4 border-l-4 border-warning py-2 pl-4 text-sm text-neutral-800">
      <strong class="text-warning">Nikolausdienst im Wartungsmodus:</strong>
      Änderungen an Nikolaus-Daten sind gerade nicht möglich.
    </p>
  {/if}
  {#if module && status && !status.staffActive}
    <p class="mb-4 border-l-4 border-warning py-2 pl-4 text-sm text-neutral-800">
      <strong class="text-warning">Die Nikolausverwaltung ist ausgeschaltet.</strong>
      Einschalten lässt sie sich in der
      <a href="/leitendenbereich/nikolaus-steuerung" class="font-semibold text-link">Steuerung</a>.
    </p>
  {/if}
</div>
