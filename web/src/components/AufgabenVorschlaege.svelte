<script lang="ts">
  import AufgabenLadestatus from './AufgabenLadestatus.svelte';
  import { onMount, tick } from 'svelte';
  import { taskFocusReturn } from '../lib/aufgabenFocus';
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
  import ConfirmDialog from './ui/ConfirmDialog.svelte';
  let sourceId = $state('');
  let protocolSearch = $state('');
  let rejectTarget = $state<Task | null>(null);
  let rejectFocus = () => {};
  let rejectReloading = $state(false);
  let rejectReloadError = $state<string | null>(null);
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
  const protocolOptions = $derived(
    eligible.filter(
      (protocol) =>
        protocol.id === sourceId ||
        `${protocolLabel(protocol.date)} ${protocol.date} ${protocol.title} ${protocol.fileName}`
          .toLocaleLowerCase('de')
          .includes(protocolSearch.trim().toLocaleLowerCase('de'))
    )
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
    actions.clearError();
    actions.showMessage(null);
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

  async function closeReject(): Promise<void> {
    rejectTarget = null;
    rejectReloadError = null;
    actions.clearError();
    await tick();
    rejectFocus();
  }

  /** After a conflict: shows the current suggestion, or closes if it is no longer one. */
  async function reloadReject(): Promise<void> {
    if (rejectReloading || actions.state.busy || !rejectTarget) return;
    const id = rejectTarget.id;
    rejectReloading = true;
    rejectReloadError = null;
    try {
      if (!(await loadTasks())) {
        rejectReloadError =
          'Der Vorschlag konnte nicht neu geladen werden. Prüfe deine Internetverbindung und tippe noch einmal auf „Aktuelle Fassung laden“.';
        return;
      }
      actions.clearError();
      const fresh = aufgabenStore.data?.tasks.find((task) => task.id === id);
      if (fresh?.state === 'vorschlag') rejectTarget = fresh;
      else await closeReject();
    } finally {
      rejectReloading = false;
    }
  }
</script>

<AufgabenLadestatus />
<StatusNotice kind="error" message={rejectTarget ? null : actions.state.error} popup />
<a class="inline-flex min-h-11 items-center text-link" href="/leitendenbereich/aufgaben"
  >Zur Aufgabenliste</a
>
{#if data}
  <section aria-labelledby="recognize-heading" class="my-5 surface-muted rounded-lg p-4">
    <h2
      id="recognize-heading"
      data-focus-fallback
      bind:this={focusHeading}
      tabindex="-1"
      class="text-lg font-semibold"
    >
      Aufgaben aus Protokollen
    </h2>
    <p class="my-2 text-sm text-neutral-700">
      Du kannst freigegebene oder archivierte Protokolle auswerten. Die automatische Erkennung
      schlägt Aufgaben vor; ihr prüft und übernehmt die Aufgaben einzeln.
    </p>
    <StatusNotice kind="error" message={aufgabenStore.protocolError} />
    {#if aufgabenStore.protocolError}<ActionButton onclick={loadTaskProtocols}
        >Protokolle neu laden</ActionButton
      >{/if}
    <FormField id="task-protocol-search" label="Protokoll suchen" optional>
      {#snippet children(attrs)}<input
          {...attrs}
          type="search"
          class="form-input"
          placeholder="Datum, Titel oder Dateiname"
          bind:value={protocolSearch}
        />{/snippet}
    </FormField>
    <FormField id="task-protocol" label="Protokoll"
      >{#snippet children(attrs)}
        <select {...attrs} class="form-input" bind:value={sourceId} onchange={clearRecognition}
          ><option value="">Bitte auswählen</option
          >{#each protocolOptions as protocol (protocol.id)}<option value={protocol.id}
              >{protocolLabel(protocol.date)} · {protocol.title
                .replace(/^(?:\d{4}-\d{2}-\d{2}|YYYY-MM-DD)[_ -]+/, '')
                .replace(/_/g, ' ')} · {protocol.status} · {protocol.fileName}</option
            >{/each}</select
        >
      {/snippet}</FormField
    >
    {#if !data.extractionConfigured}<p class="my-2 text-sm">
        Die automatische Erkennung ist nicht eingerichtet. Aufgaben können manuell angelegt werden.
      </p>{/if}
    {#if !source && data.extractionConfigured}<p class="mt-2 text-sm text-neutral-700">
        Wähle zuerst ein Protokoll.
      </p>{/if}
    <ActionButton
      type="button"
      class="mt-3"
      onclick={recognize}
      disabled={busy || !source || !data?.extractionConfigured}
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
  <p class="mt-4 text-sm text-neutral-700">
    {visible.length}
    {visible.length === 1 ? 'Vorschlag' : 'Vorschläge'}
    {sourceId ? 'für dieses Protokoll' : 'aus allen Protokollen'}
  </p>
  {#if recognizing && !visible.length}<p role="status" class="my-3">
      Das Protokoll wird ausgewertet …
    </p>{:else}
    <AufgabenListe
      {visible}
      view="vorschlag"
      {busy}
      onopen={edit}
      onreject={(task) => {
        clearRecognition();
        rejectFocus = taskFocusReturn(task.id);
        rejectTarget = task;
      }}
    />
  {/if}
  <AufgabenNavigation area="vorschlag" />{/if}
{#if editing}<AufgabenTaskDialog
    {target}
    onclose={() => (editing = false)}
    onsaved={(message) => {
      editing = false;
      actions.showMessage(
        message,
        message.startsWith('Aufgabe angenommen')
          ? `/leitendenbereich/aufgaben#aufgabe-${target?.id}`
          : undefined
      );
    }}
  />{/if}
<AufgabenAktionen {actions} onedit={edit} />

<ConfirmDialog
  open={rejectTarget !== null}
  title={`Vorschlag „${rejectTarget?.title ?? ''}“ ablehnen?`}
  busy={rejectReloading || actions.state.busy}
  error={rejectReloadError || actions.state.error}
  submitLabel="Ablehnen"
  onclose={() => void closeReject()}
  onreload={reloadReject}
  onconfirm={async () => {
    if (!rejectTarget) return;
    await actions.taskAction(rejectTarget, 'reject');
    if (!actions.state.error) await closeReject();
  }}
>
  <p>„{rejectTarget?.title}“ ablehnen? Dieser Vorschlag wird nicht als Aufgabe übernommen.</p>
</ConfirmDialog>
