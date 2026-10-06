<script lang="ts" generics="T">
  import ActionButton from '../ui/ActionButton.svelte';
  import Toast from '../ui/Toast.svelte';
  import type { Resource } from '../../lib/pflegeStore.svelte';

  interface Props {
    resource: Resource<T>;
  }
  let { resource }: Props = $props();
  let notice = $state<{ text: string; kind: 'success' | 'error' } | null>(null);
  const current = $derived(resource.state);

  /** Reloads the list and reports both outcomes, since the list itself may look unchanged. */
  async function reload(): Promise<void> {
    notice = null;
    await resource.load({ force: true });
    if (!current.error) notice = { text: 'Liste aktualisiert.', kind: 'success' };
  }

  // A failed reload keeps the last list; without a hint it would look like nothing happened.
  $effect(() => {
    if (current.error && current.data)
      notice = {
        text: `Neu laden fehlgeschlagen: ${current.error} Angezeigt wird der letzte Stand.`,
        kind: 'error',
      };
  });
</script>

<ActionButton
  variant="secondary"
  type="button"
  disabled={current.loading}
  aria-busy={current.loading}
  onclick={() => void reload()}
>
  {current.loading && current.data ? 'Lädt …' : 'Neu laden'}
</ActionButton>
<Toast message={notice?.text ?? null} kind={notice?.kind} onclose={() => (notice = null)} />
