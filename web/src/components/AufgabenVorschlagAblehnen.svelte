<script lang="ts">
  import { tick } from 'svelte';
  import type { Task } from '../lib/types';
  import type { TaskActions } from '../lib/aufgabenActions.svelte';
  import { aufgabenStore, loadTasks } from '../lib/aufgabenStore.svelte';
  import ConfirmDialog from './ui/ConfirmDialog.svelte';
  import ActionButton from './ui/ActionButton.svelte';
  let {
    target = $bindable(null),
    actions,
    onclosed,
  }: {
    target: Task | null;
    actions: TaskActions;
    onclosed: () => void;
  } = $props();
  let reloading = $state(false);
  let reloadError = $state<string | null>(null);
  const busy = $derived(reloading || actions.state.busy);
  async function close(): Promise<void> {
    target = null;
    reloadError = null;
    actions.clearError();
    await tick();
    onclosed();
  }
  async function reload(): Promise<void> {
    if (busy || !target) return;
    const id = target.id;
    reloading = true;
    reloadError = null;
    try {
      if (!(await loadTasks())) {
        reloadError = 'Die aktuelle Fassung konnte nicht geladen werden. Bitte erneut versuchen.';
        return;
      }
      actions.clearError();
      const fresh = aufgabenStore.data?.tasks.find((task) => task.id === id);
      if (fresh?.state === 'vorschlag') target = fresh;
      else await close();
    } finally {
      reloading = false;
    }
  }
</script>

<ConfirmDialog
  open={target !== null}
  title="Vorschlag ablehnen"
  {busy}
  error={reloadError || actions.state.error}
  submitLabel="Ablehnen"
  onclose={() => void close()}
  onconfirm={async () => {
    if (!target) return;
    await actions.taskAction(target, 'reject');
    if (!actions.state.error) await close();
  }}
>
  <p>„{target?.title}“ ablehnen? Dieser Vorschlag wird nicht als Aufgabe übernommen.</p>
  {#if reloadError || actions.state.error}
    <ActionButton variant="secondary" disabled={busy} onclick={reload}
      >Aktuelle Fassung laden</ActionButton
    >
  {/if}
</ConfirmDialog>
