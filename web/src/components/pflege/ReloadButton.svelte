<script lang="ts" generics="T">
  import ActionButton from '../ui/ActionButton.svelte';
  import Toast from '../ui/Toast.svelte';
  import type { Resource } from '../../lib/pflegeStore.svelte';

  interface Props {
    resource: Resource<T>;
  }
  let { resource }: Props = $props();
  let notice = $state<string | null>(null);
  const current = $derived(resource.state);

  /** Reloads the list; a failure is shown by the list's LoadState, success here. */
  async function reload(): Promise<void> {
    notice = null;
    await resource.load({ force: true });
    if (!current.error) notice = 'Liste aktualisiert.';
  }
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
<Toast message={notice} onclose={() => (notice = null)} />
