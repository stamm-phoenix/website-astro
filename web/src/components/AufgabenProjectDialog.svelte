<script lang="ts">
  import { untrack } from 'svelte';
  import { sendApi } from '../lib/api';
  import { aufgabenStore, TASK_ENDPOINT } from '../lib/aufgabenStore.svelte';
  import { createTaskForm } from '../lib/aufgabenForm.svelte';
  import EditDialog from './pflege/EditDialog.svelte';
  import FormField from './pflege/FormField.svelte';
  import type { TaskProject } from '../lib/types';
  import { campflowEventsStore } from '../lib/campflowStore.svelte';
  import StatusNotice from './pflege/StatusNotice.svelte';
  let {
    target = null,
    initialTitle = '',
    initialCampflowId = '',
    onclose,
    onsaved,
  }: {
    target?: TaskProject | null;
    initialTitle?: string;
    initialCampflowId?: string;
    onclose: () => void;
    onsaved: (message: string) => void;
  } = $props();
  let draft = $state(untrack(() => ({ title: target?.title ?? initialTitle })));
  let campflowId = $state(untrack(() => target?.campflowId ?? initialCampflowId));
  const form = createTaskForm();
  const fields = $derived(form.state.fields);
  const busy = $derived(form.state.busy);
  function eventProject(): void {
    const event = campflowEventsStore.data?.find((event) => event.id === campflowId);
    if (event && !draft.title) draft.title = event.title;
  }
  async function save(): Promise<void> {
    await form.submit(async () => {
      await sendApi(
        target ? 'PUT' : 'POST',
        `${TASK_ENDPOINT}/projekte${target ? `/${target.id}` : ''}`,
        { title: draft.title, campflowId, etag: target?.etag }
      );
      return 'Gespeichert.';
    }, onsaved);
  }
  async function reload(): Promise<void> {
    await form.reload(() => {
      const fresh = aufgabenStore.data?.projects.find((item) => item.id === target?.id);
      if (!fresh) {
        onclose();
        return;
      }
      target = fresh;
      draft = { title: fresh.title };
      campflowId = fresh.campflowId;
    });
  }
</script>

<EditDialog
  open
  title="Projekt"
  {busy}
  error={form.state.error}
  onedit={form.changed}
  onreload={form.state.conflict ? reload : undefined}
  onsubmit={save}
  {onclose}
>
  <div class="space-y-4">
    <FormField id="task-title" label="Titel" error={fields.title}
      >{#snippet children(attrs)}<input
          {...attrs}
          class="form-input"
          bind:value={draft.title}
          maxlength="200"
          required
        />{/snippet}</FormField
    >
    <FormField id="project-event" label="CampFlow-Aktion" optional error={fields.campflowId}
      >{#snippet children(attrs)}
        <select {...attrs} class="form-input" bind:value={campflowId} onchange={eventProject}
          ><option value="">Eigenständiges Projekt</option
          >{#if campflowId && !campflowEventsStore.data?.some((e) => e.id === campflowId)}<option
              value={campflowId}>Verknüpfte Aktion</option
            >{/if}{#each campflowEventsStore.data ?? [] as event (event.id)}<option value={event.id}
              >{event.title}</option
            >{/each}</select
        >
      {/snippet}</FormField
    >
    <StatusNotice kind="error" message={campflowEventsStore.error} />
  </div>
</EditDialog>
