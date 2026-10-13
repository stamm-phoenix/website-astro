<script lang="ts">
  import { tick } from 'svelte';
  import type { Task } from '../lib/types';
  import type { createTaskActions } from '../lib/aufgabenActions.svelte';
  import ActionSheet from './ui/ActionSheet.svelte';
  import ConfirmDialog from './ui/ConfirmDialog.svelte';
  import ActionButton from './ui/ActionButton.svelte';
  import Toast from './ui/Toast.svelte';
  let {
    actions,
    menuTarget = $bindable(null),
    onedit,
  }: {
    actions: ReturnType<typeof createTaskActions>;
    menuTarget?: Task | null;
    onedit: (task: Task) => void;
  } = $props();
  const state = $derived(actions.state);
</script>

<Toast
  message={state.message && state.completionNotice && state.undoTask
    ? `${state.message} Rückgängig: ${state.undoTask.title}.`
    : (state.message ?? state.completionNotice)}
  actionDisabled={state.busy}
  actionLabel={state.completionNotice && state.undoTask ? 'Rückgängig' : undefined}
  onaction={() => {
    if (state.undoTask) void actions.taskAction(state.undoTask, 'toggle', true);
  }}
  onclose={actions.closeNotice}
  duration={10000}
/>
<ActionSheet
  open={menuTarget !== null}
  title="Aufgabenaktionen"
  onclose={() => (menuTarget = null)}
>
  <p class="font-semibold break-words">{menuTarget?.title}</p>
  <div class="mt-3 grid gap-3">
    <ActionButton
      variant="secondary"
      onclick={async () => {
        const task = menuTarget;
        menuTarget = null;
        await tick();
        if (task) onedit(task);
      }}>Bearbeiten</ActionButton
    >
    {#if menuTarget && !menuTarget.sourceId}<ActionButton
        variant="danger"
        onclick={async () => {
          const task = menuTarget;
          menuTarget = null;
          await tick();
          state.deleteError = null;
          state.deleteTarget = task;
        }}>Löschen</ActionButton
      >{/if}
  </div>
</ActionSheet>
<ConfirmDialog
  open={state.deleteTarget !== null}
  title="Aufgabe löschen"
  busy={state.busy}
  error={state.deleteError}
  onclose={() => (state.deleteTarget = null)}
  onconfirm={() => {
    if (state.deleteTarget) {
      state.deleteError = null;
      void actions.taskAction(state.deleteTarget, 'delete');
    }
  }}
>
  <p>Aufgabe „{state.deleteTarget?.title ?? ''}“ wirklich löschen?</p>
  <p class="text-sm text-neutral-700">Das Löschen kann nicht rückgängig gemacht werden.</p>
</ConfirmDialog>
