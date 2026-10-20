<script lang="ts">
  import { untrack } from 'svelte';
  import { sendApi } from '../lib/api';
  import { aufgabenStore, TASK_ENDPOINT } from '../lib/aufgabenStore.svelte';
  import { createTaskForm } from '../lib/aufgabenForm.svelte';
  import EditDialog from './pflege/EditDialog.svelte';
  import FormField from './pflege/FormField.svelte';
  import type { TaskTemplate, TemplateItem } from '../lib/types';
  import { taskPeople } from '../../../api/lib/aufgaben-zuordnung';
  import TaskAssigneeField from './TaskAssigneeField.svelte';
  import ActionButton from './ui/ActionButton.svelte';
  import StatusNotice from './pflege/StatusNotice.svelte';
  let {
    target: initialTarget = null,
    onclose,
    onsaved,
  }: {
    target?: TaskTemplate | null;
    onclose: () => void;
    onsaved: (message: string) => void;
  } = $props();
  // The dialog owns its current version; reloading never overwrites a parent prop.
  let target = $state(untrack(() => initialTarget));
  let draft = $state(untrack(() => ({ title: target?.title ?? '' })));
  let items = $state<TemplateItem[]>(
    untrack(
      () =>
        target?.items.map((item) => ({
          ...item,
          assignees: taskPeople(item, aufgabenStore.users),
        })) ?? [{ title: '', description: '', assignee: '', assignees: [], daysBefore: 14 }]
    )
  );
  const form = createTaskForm();
  const fields = $derived(form.state.fields);
  const busy = $derived(form.state.busy);
  async function save(): Promise<void> {
    await form.submit(async () => {
      await sendApi(
        target ? 'PUT' : 'POST',
        `${TASK_ENDPOINT}/vorlagen${target ? `/${target.id}` : ''}`,
        {
          title: draft.title,
          items: items.map((item) => ({
            ...item,
            assignee: item.assignees?.[0]?.login || item.assignees?.[0]?.name || '',
          })),
          etag: target?.etag,
        }
      );
      return 'Gespeichert.';
    }, onsaved);
  }
  async function reload(): Promise<boolean> {
    return form.reload(() => {
      const fresh = aufgabenStore.data?.templates.find((item) => item.id === target?.id);
      if (!fresh) {
        onclose();
        return;
      }
      target = fresh;
      draft = { title: fresh.title };
      items = fresh.items.map((item) => ({
        ...item,
        assignees: taskPeople(item, aufgabenStore.users),
      }));
    });
  }
</script>

<EditDialog
  open
  title="Vorlage"
  rescueKey={`vorlage:${target?.id ?? 'neu'}`}
  {busy}
  error={form.state.error}
  onedit={form.changed}
  onreload={form.state.conflict ? reload : undefined}
  onsubmit={save}
  {onclose}
>
  <div class="space-y-4">
    <FormField name="title" id="template-name" label="Titel" error={fields.title}
      >{#snippet children(attrs)}<input
          {...attrs}
          class="form-input"
          bind:value={draft.title}
          maxlength="200"
          required
        />{/snippet}</FormField
    >
    <p class="text-sm text-neutral-700">
      Positive Tageszahlen liegen vor der Aktion; negative danach.
    </p>
    {#each items as item, index (item)}
      <fieldset class="border-t border-neutral-200 pt-3 space-y-3">
        <legend class="font-semibold">Aufgabe {index + 1}</legend>
        <FormField name="items" id="template-title-{index}" label="Aufgabentitel"
          >{#snippet children(attrs)}<input
              {...attrs}
              class="form-input"
              bind:value={item.title}
              required
              maxlength="200"
            />{/snippet}</FormField
        >
        <FormField name="items" id="template-description-{index}" label="Beschreibung" optional
          >{#snippet children(attrs)}<textarea
              {...attrs}
              class="form-input"
              bind:value={item.description}
              maxlength="2000"></textarea>{/snippet}</FormField
        >
        <TaskAssigneeField
          id="template-assignee-{index}"
          bind:people={item.assignees}
          onedit={() => form.clearField('items')}
        />
        <FormField name="items" id="template-days-{index}" label="Tage vor der Aktion"
          >{#snippet children(attrs)}<input
              {...attrs}
              class="form-input"
              type="number"
              min="-366"
              max="366"
              step="1"
              bind:value={item.daysBefore}
              required
            />{/snippet}</FormField
        >
        <ActionButton
          type="button"
          variant="secondary"
          disabled={items.length === 1 || busy}
          onclick={() => (items = items.filter((_, i) => i !== index))}
          >Vorlagenaufgabe entfernen</ActionButton
        >
      </fieldset>
    {/each}
    <StatusNotice kind="error" message={fields.items ?? null} />
    <ActionButton
      type="button"
      variant="secondary"
      disabled={items.length >= 50 || busy}
      onclick={() =>
        (items = [...items, { title: '', description: '', assignee: '', daysBefore: 0 }])}
      >Vorlagenaufgabe hinzufügen</ActionButton
    >
  </div>
</EditDialog>
