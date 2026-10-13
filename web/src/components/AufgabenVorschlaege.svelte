<script lang="ts">
  import { onMount } from 'svelte';
  import { sendApi } from '../lib/api';
  import type { Task } from '../lib/types';
  import {
    aufgabenStore,
    loadTasks,
    loadTaskUsers,
    loadTaskProtocols,
    taskProblem,
    TASK_ENDPOINT,
  } from '../lib/aufgabenStore.svelte';
  import { createTaskActions } from '../lib/aufgabenActions.svelte';
  import { pendingTask, matchesTaskFilters, sortTasks, protocolLabel } from '../lib/aufgabenView';
  import ActionButton from './ui/ActionButton.svelte';
  import FormField from './pflege/FormField.svelte';
  import StatusNotice from './pflege/StatusNotice.svelte';
  import AufgabenFilter from './AufgabenFilter.svelte';
  import AufgabenListe from './AufgabenListe.svelte';
  import AufgabenNavigation from './AufgabenNavigation.svelte';
  import AufgabenTaskDialog from './AufgabenTaskDialog.svelte';
  import AufgabenAktionen from './AufgabenAktionen.svelte';
  let sourceId = $state('');
  let projectFilter = $state('alle');
  let ownOnly = $state(false);
  let target = $state<Task | null>(null);
  let editing = $state(false);
  let recognizing = $state(false);
  let recognitionMessage = $state<string | null>(null);
  let recognitionError = $state<string | null>(null);
  let recognitionRequest = 0;
  const data = $derived(aufgabenStore.data);
  let focusHeading = $state<HTMLHeadingElement | null>(null);
  const actions = createTaskActions(() => focusHeading?.focus());
  const busy = $derived(recognizing || actions.state.busy);
  const eligible = $derived(
    (aufgabenStore.protocols?.items ?? [])
      .filter(
        (protocol) =>
          ['Freigegeben', 'Verschickt', 'Archiv'].includes(protocol.status) &&
          !protocol.changedSinceApproval
      )
      .sort((a, b) => b.date.localeCompare(a.date))
  );
  const source = $derived(eligible.find((protocol) => protocol.id === sourceId));
  const visible = $derived(
    sortTasks(
      (data?.tasks ?? []).filter(
        (task) =>
          pendingTask(task) &&
          (!sourceId || task.sourceId === sourceId) &&
          matchesTaskFilters(task, { project: projectFilter, own: ownOnly, login: data?.login })
      )
    )
  );
  function clearRecognition(): void {
    recognitionRequest++;
    recognitionMessage = null;
    recognitionError = null;
  }
  function edit(task: Task): void {
    clearRecognition();
    target = task;
    editing = true;
  }
  onMount(() => {
    sourceId = new URLSearchParams(location.search).get('protokoll') ?? '';
    void loadTasks();
    void loadTaskUsers();
    void loadTaskProtocols();
  });
  async function recognize(): Promise<void> {
    if (!source) return;
    recognizing = true;
    actions.state.error = null;
    actions.state.message = null;
    clearRecognition();
    const sequence = recognitionRequest;
    try {
      const result = await sendApi<{ count: number; assignmentUnavailable?: boolean }>(
        'POST',
        `${TASK_ENDPOINT}/protokolle/${encodeURIComponent(source.id)}/erkennen`,
        { etag: source.etag }
      );
      await loadTasks();
      await loadTaskProtocols();
      if (sequence !== recognitionRequest) return;
      recognitionMessage = result.count
        ? `${result.count} ${result.count === 1 ? 'neuer Vorschlag' : 'neue Vorschläge'} erkannt. Bitte Fundstellen, Zuständigkeit und Fristen prüfen.`
        : 'Keine neuen Aufgabenvorschläge gefunden.';
      if (result.assignmentUnavailable)
        recognitionMessage +=
          ' Die Personenzuordnung ist nicht verfügbar; bitte Zuständigkeiten prüfen.';
    } catch (e) {
      if (sequence === recognitionRequest) recognitionError = taskProblem(e);
      await loadTaskProtocols();
    } finally {
      recognizing = false;
    }
  }
</script>

<StatusNotice kind="error" message={actions.state.error ?? aufgabenStore.error} popup />
<a
  class="inline-flex min-h-11 items-center text-link"
  href="/leitendenbereich/aufgaben"
  data-astro-reload>Zur Aufgabenliste</a
>
{#if data}
  <section aria-labelledby="recognize-heading" class="my-5 surface-muted rounded-lg p-4">
    <h2 id="recognize-heading" bind:this={focusHeading} tabindex="-1" class="text-lg font-semibold">
      Aufgaben aus Protokollen
    </h2>
    <p class="my-2 text-sm text-neutral-700">
      Reviewende können freigegebene oder archivierte Protokolle auswerten. Die KI schlägt nur vor;
      ihr prüft und übernehmt die Aufgaben einzeln.
    </p>
    <StatusNotice kind="error" message={aufgabenStore.protocolError} />
    <FormField id="task-protocol" label="Protokoll"
      >{#snippet children(attrs)}
        <select {...attrs} class="form-input" bind:value={sourceId} onchange={clearRecognition}
          ><option value="">Bitte auswählen</option
          >{#each eligible as protocol (protocol.id)}<option value={protocol.id}
              >{protocolLabel(protocol.date)} · {protocol.title}</option
            >{/each}</select
        >
      {/snippet}</FormField
    >
    {#if !data.extractionConfigured}<p class="my-2 text-sm">
        Die KI-Erkennung ist nicht eingerichtet. Aufgaben können manuell angelegt werden.
      </p>{/if}
    {#if !source && data.reviewer && data.extractionConfigured}<p
        class="mt-2 text-sm text-neutral-700"
      >
        Wähle zuerst ein Protokoll.
      </p>{:else if !data.reviewer}<p class="mt-2 text-sm text-neutral-700">
        Die Erkennung ist nur für Reviewende verfügbar.
      </p>{/if}
    <ActionButton
      type="button"
      class="mt-3"
      onclick={recognize}
      disabled={busy || !source || !data?.reviewer || !data.extractionConfigured}
      aria-busy={busy}>{busy ? 'Wird verarbeitet …' : 'Aufgaben erkennen'}</ActionButton
    >
    <div role="status" aria-live="polite" aria-label="Erkennungsergebnis">
      {#if recognitionMessage || recognitionError}
        <div
          class="mt-4 flex items-start gap-3 rounded-md border border-neutral-300 bg-surface p-3"
        >
          <p class={recognitionError ? 'text-sm text-danger' : 'text-sm text-neutral-700'}>
            {recognitionError ?? recognitionMessage}
          </p>
          <button
            type="button"
            class="ml-auto min-h-11 min-w-11 shrink-0 text-neutral-700"
            aria-label="Erkennungsergebnis ausblenden"
            onclick={clearRecognition}>×</button
          >
        </div>
      {/if}
    </div>
  </section>
  <AufgabenFilter bind:projectFilter bind:ownOnly onchange={clearRecognition} />
  <AufgabenListe
    {visible}
    view="vorschlag"
    {projectFilter}
    {ownOnly}
    {busy}
    onopen={edit}
    onreject={(task) => {
      clearRecognition();
      void actions.taskAction(task, 'reject');
    }}
  />
  <AufgabenNavigation area="vorschlag" />{/if}
{#if editing}<AufgabenTaskDialog
    {target}
    onclose={() => (editing = false)}
    onsaved={(message) => {
      editing = false;
      actions.state.message = message;
    }}
  />{/if}
<AufgabenAktionen {actions} onedit={edit} />
