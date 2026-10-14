<script lang="ts">
  import { tick, untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import EditDialog from '../pflege/EditDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { ApiError, errorMessage, fetchApi, sendApi } from '../../lib/api';
  import { todayIso } from '../../lib/format';
  import { formatDateTime, formatMeetingDate, protokollEditorUrl } from '../../lib/protokollEditor';
  import type { ProtokollEditorOverview, ProtokollEditorStatus } from '../../lib/types';

  const STATUS: Record<
    ProtokollEditorStatus,
    { label: string; tone: 'neutral' | 'warning' | 'success' }
  > = {
    entwurf: { label: 'Entwurf', tone: 'neutral' },
    review: { label: 'Im Review', tone: 'warning' },
    freigegeben: { label: 'Freigegeben', tone: 'success' },
    verschickt: { label: 'Verschickt', tone: 'success' },
  };

  let overview = $state.raw<ProtokollEditorOverview | null>(null);
  let loadError = $state<string | null>(null);

  let draft = $state<{ title: string; date: string } | null>(null);
  let draftErrors = $state<Record<string, string>>({});
  let draftError = $state<string | null>(null);
  let draftBusy = $state(false);

  async function load(): Promise<void> {
    loadError = null;
    try {
      overview = await fetchApi<ProtokollEditorOverview>('/intern/protokoll-editor');
    } catch (error: unknown) {
      loadError = errorMessage(error, 'Die Protokolle konnten nicht geladen werden.');
    }
  }

  function startCreate(): void {
    draft = {
      title: overview?.defaultTitle ?? 'Leitendenrunde',
      date: overview?.today ?? todayIso(),
    };
    draftErrors = {};
    draftError = null;
  }

  async function create(): Promise<void> {
    if (!draft) return;
    draftBusy = true;
    draftErrors = {};
    draftError = null;
    try {
      const { id } = await sendApi<{ id: number }>(
        'POST',
        '/intern/pflege/protokoll-editor',
        draft
      );
      draft = null;
      await tick();
      window.location.href = protokollEditorUrl(id, true);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) draftErrors = error.fields;
      draftError = errorMessage(error, 'Das Protokoll konnte nicht angelegt werden.');
      draftBusy = false;
    }
  }

  $effect(() => {
    untrack(() => void load());
  });
</script>

<section class="space-y-4" aria-labelledby="editor-protokolle">
  <div class="flex flex-wrap items-baseline justify-between gap-3">
    <h2 id="editor-protokolle" class="font-serif text-2xl text-brand-900">Im Editor</h2>
    <ActionButton variant="primary" onclick={startCreate} disabled={!overview}>
      Neues Protokoll schreiben
    </ActionButton>
  </div>
  <p class="max-w-prose text-sm text-neutral-700">
    Neu: Protokolle direkt hier schreiben, ohne Word. Eine Person schreibt, alle anderen lesen live
    mit. Gespeichert wird laufend, frühere Fassungen bleiben erhalten.
  </p>

  <LoadState
    data={overview}
    loading={!overview && !loadError}
    error={loadError}
    loadingText="Protokolle werden geladen …"
    onretry={load}
    isEmpty={(data) => data.protokolle.length === 0}
  >
    {#snippet skeleton()}
      <div class="skeleton-element h-14 rounded-[var(--radius-lg)]"></div>
    {/snippet}
    {#snippet empty()}
      <p class="border-y border-neutral-200 py-4 text-sm text-neutral-700">
        Noch kein Protokoll im Editor.
      </p>
    {/snippet}
    {#snippet children(overview)}
      <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
        {#each overview.protokolle as protokoll (protokoll.id)}
          <li class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
            <div class="min-w-0">
              <a href={protokollEditorUrl(protokoll.id)} class="text-link font-semibold">
                {protokoll.title}
              </a>
              <span class="text-neutral-700">· {formatMeetingDate(protokoll.date)}</span>
              <p class="text-sm text-neutral-700">
                {#if protokoll.writer}
                  <span class="font-semibold text-warning">{protokoll.writer} schreibt gerade</span>
                {:else}
                  Zuletzt geändert {formatDateTime(protokoll.updatedAt)}
                {/if}
              </p>
            </div>
            <StatusLabel
              label={STATUS[protokoll.status].label}
              tone={STATUS[protokoll.status].tone}
            />
          </li>
        {/each}
      </ul>
    {/snippet}
  </LoadState>
</section>

<EditDialog
  open={draft !== null}
  title="Neues Protokoll"
  submitLabel="Anlegen und schreiben"
  busyLabel="Wird angelegt …"
  busy={draftBusy}
  error={draftError}
  onsubmit={create}
  onclose={() => (draft = null)}
>
  {#if draft}
    <div class="space-y-4">
      <FormField id="neu-titel" label="Titel" error={draftErrors.title}>
        {#snippet children(attrs)}
          <input
            {...attrs}
            type="text"
            class="form-input"
            maxlength="200"
            bind:value={draft!.title}
          />
        {/snippet}
      </FormField>
      <FormField id="neu-datum" label="Datum der Sitzung" error={draftErrors.date}>
        {#snippet children(attrs)}
          <input {...attrs} type="date" class="form-input" bind:value={draft!.date} />
        {/snippet}
      </FormField>
      <p class="text-sm text-neutral-700">
        Die Tagesordnung startet mit Stufenberichten, Reflexion, Planung und Sonstigem; alles lässt
        sich ändern.
      </p>
    </div>
  {/if}
</EditDialog>
