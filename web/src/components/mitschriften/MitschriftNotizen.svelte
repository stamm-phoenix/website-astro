<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import EditDialog from '../pflege/EditDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { ApiError, sendApi } from '../../lib/api';
  import type { MitschriftDetail, MitschriftNotizen, MitschriftTodo } from '../../lib/types';

  interface Props {
    mitschrift: MitschriftDetail;
    /** The running notes during the recording, shown instead of the stored ones. */
    running?: boolean;
    preview?: MitschriftNotizen | null;
    /** Generating is running in the parent (e.g. right after the recording). */
    generating?: boolean;
    onchange: () => Promise<void>;
    notify: (text: string, kind?: 'success' | 'warning' | 'error') => void;
  }
  let {
    mitschrift,
    running = false,
    preview = null,
    generating = false,
    onchange,
    notify,
  }: Props = $props();

  const notes = $derived(running ? preview : mitschrift.notes);
  const editable = $derived(mitschrift.status !== 'live' && !running);
  const empty = $derived(
    notes !== null &&
      notes.beschluesse.length === 0 &&
      notes.todos.length === 0 &&
      notes.offenePunkte.length === 0 &&
      !notes.naechsterTermin
  );

  let busy = $state(false);
  let confirmOverwrite = $state(false);

  interface Draft {
    beschluesse: string;
    offenePunkte: string;
    naechsterTermin: string;
    todos: { aufgabe: string; verantwortlich: string; frist: string }[];
  }
  let draft = $state<Draft | null>(null);
  let draftErrors = $state<Record<string, string>>({});
  let draftError = $state<string | null>(null);
  let draftBusy = $state(false);

  function errorText(error: unknown, fallback: string): string {
    return error instanceof ApiError ? error.message : fallback;
  }

  /** Lets the model write the notes again; asks first if they were changed by hand. */
  export async function regenerate(overwrite = false): Promise<void> {
    if (mitschrift.notesEdited && !overwrite) {
      confirmOverwrite = true;
      return;
    }
    confirmOverwrite = false;
    busy = true;
    try {
      await sendApi('POST', `/intern/pflege/mitschriften/${mitschrift.id}/notizen`, {
        pass: 'abschluss',
        etag: mitschrift.etag,
        overwrite: true,
      });
      notify('Die Notizen wurden neu erzeugt.');
      await onchange();
    } catch (error: unknown) {
      notify(errorText(error, 'Die Notizen konnten nicht erzeugt werden.'), 'error');
    } finally {
      busy = false;
    }
  }

  function startEdit(): void {
    const current = mitschrift.notes;
    draft = {
      beschluesse: current?.beschluesse.join('\n') ?? '',
      offenePunkte: current?.offenePunkte.join('\n') ?? '',
      naechsterTermin: current?.naechsterTermin ?? '',
      todos: (current?.todos ?? []).map((todo) => ({
        aufgabe: todo.aufgabe,
        verantwortlich: todo.verantwortlich ?? '',
        frist: todo.frist ?? '',
      })),
    };
    draftErrors = {};
    draftError = null;
  }

  function lines(text: string): string[] {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async function save(): Promise<void> {
    if (!draft) return;
    draftBusy = true;
    draftErrors = {};
    draftError = null;
    try {
      const value: MitschriftNotizen = {
        beschluesse: lines(draft.beschluesse),
        offenePunkte: lines(draft.offenePunkte),
        naechsterTermin: draft.naechsterTermin.trim() || null,
        todos: draft.todos
          .filter((todo) => todo.aufgabe.trim())
          .map((todo): MitschriftTodo => ({
            aufgabe: todo.aufgabe.trim(),
            verantwortlich: todo.verantwortlich.trim() || null,
            frist: todo.frist.trim() || null,
          })),
      };
      await sendApi('PUT', `/intern/pflege/mitschriften/${mitschrift.id}/notizen`, {
        notes: value,
        etag: mitschrift.etag,
      });
      draft = null;
      notify('Notizen gespeichert.');
      await onchange();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) draftErrors = error.fields;
      draftError = errorText(error, 'Die Notizen konnten nicht gespeichert werden.');
    } finally {
      draftBusy = false;
    }
  }
</script>

<section aria-labelledby="notizen-heading" class="space-y-4">
  <div class="flex flex-wrap items-baseline justify-between gap-3">
    <h2 id="notizen-heading" class="font-serif text-2xl text-brand-900">
      {running ? 'Laufende Notizen' : 'Notizen'}
    </h2>
    {#if editable}
      <div class="flex flex-wrap gap-2">
        <ActionButton onclick={startEdit} disabled={busy || generating}
          >Notizen bearbeiten</ActionButton
        >
        <ActionButton
          onclick={() => regenerate()}
          disabled={busy || generating || mitschrift.abschnitte.length === 0}
          aria-busy={busy || generating}
        >
          {busy || generating ? 'Notizen werden erzeugt …' : 'Notizen neu erzeugen'}
        </ActionButton>
      </div>
    {/if}
  </div>

  {#if running}
    <p class="text-sm text-neutral-700">
      Werden alle paar Minuten aus dem bisherigen Transkript erzeugt und nur auf diesem Rechner
      angezeigt. Am Ende entstehen die Notizen in einem gründlicheren Durchlauf.
    </p>
  {/if}

  {#if editable && mitschrift.notesStale && mitschrift.notes}
    <p class="border-l-2 border-warning py-1 pl-4 text-sm text-warning">
      Notizen sind nicht mehr aktuell: Das Transkript wurde danach geändert.
    </p>
  {/if}

  {#if confirmOverwrite}
    <div class="border-l-2 border-danger py-1 pl-4 text-sm" role="alert">
      <p class="text-neutral-800">
        Die Notizen wurden von Hand geändert. Beim Neu-Erzeugen gehen diese Änderungen verloren.
      </p>
      <div class="mt-2 flex flex-wrap gap-2">
        <ActionButton variant="danger" onclick={() => regenerate(true)}
          >Trotzdem neu erzeugen</ActionButton
        >
        <ActionButton onclick={() => (confirmOverwrite = false)}>Abbrechen</ActionButton>
      </div>
    </div>
  {/if}

  {#if !notes}
    <p class="text-sm text-neutral-700">
      {#if generating}
        Die Notizen werden erzeugt …
      {:else if running}
        Die ersten Notizen erscheinen nach ein paar Minuten.
      {:else if mitschrift.abschnitte.length === 0}
        Noch kein Transkript.
      {:else}
        Noch keine Notizen.
      {/if}
    </p>
  {:else if empty}
    <p class="text-sm text-neutral-700">
      Im Transkript wurden keine Beschlüsse, To-dos oder offenen Punkte erkannt.
    </p>
  {:else}
    <dl class="space-y-4">
      <div>
        <dt class="font-semibold text-brand-900">Beschlüsse</dt>
        <dd>
          {#if notes.beschluesse.length === 0}
            <p class="text-sm text-neutral-700">Keine.</p>
          {:else}
            <ul class="list-disc space-y-1 pl-5">
              {#each notes.beschluesse as item, index (index)}<li>{item}</li>{/each}
            </ul>
          {/if}
        </dd>
      </div>
      <div>
        <dt class="font-semibold text-brand-900">To-dos</dt>
        <dd>
          {#if notes.todos.length === 0}
            <p class="text-sm text-neutral-700">Keine.</p>
          {:else}
            <ul class="list-disc space-y-1 pl-5">
              {#each notes.todos as todo, index (index)}
                <li>
                  {todo.aufgabe}
                  {#if todo.verantwortlich || todo.frist}
                    <span class="text-neutral-700">
                      – {[todo.verantwortlich, todo.frist ? `bis ${todo.frist}` : null]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </dd>
      </div>
      <div>
        <dt class="font-semibold text-brand-900">Offene Punkte</dt>
        <dd>
          {#if notes.offenePunkte.length === 0}
            <p class="text-sm text-neutral-700">Keine.</p>
          {:else}
            <ul class="list-disc space-y-1 pl-5">
              {#each notes.offenePunkte as item, index (index)}<li>{item}</li>{/each}
            </ul>
          {/if}
        </dd>
      </div>
      <div>
        <dt class="font-semibold text-brand-900">Nächster Termin</dt>
        <dd>{notes.naechsterTermin ?? 'Nicht besprochen.'}</dd>
      </div>
    </dl>
  {/if}
</section>

<EditDialog
  open={draft !== null}
  title="Notizen bearbeiten"
  busy={draftBusy}
  error={draftError}
  onsubmit={save}
  onclose={() => (draft = null)}
>
  {#if draft}
    <div class="space-y-4">
      <FormField
        id="notizen-beschluesse"
        label="Beschlüsse"
        hint="Ein Beschluss pro Zeile."
        error={draftErrors.beschluesse}
      >
        {#snippet children(attrs)}
          <textarea {...attrs} class="form-input" rows="4" bind:value={draft!.beschluesse}
          ></textarea>
        {/snippet}
      </FormField>

      <fieldset class="space-y-3">
        <legend class="form-label">To-dos</legend>
        {#each draft.todos as todo, index (index)}
          <div
            class="grid gap-2 border-b border-neutral-200 pb-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
          >
            <FormField id="todo-{index}-aufgabe" label="Aufgabe">
              {#snippet children(attrs)}
                <input {...attrs} class="form-input" maxlength="500" bind:value={todo.aufgabe} />
              {/snippet}
            </FormField>
            <FormField id="todo-{index}-wer" label="Verantwortlich" optional>
              {#snippet children(attrs)}
                <input
                  {...attrs}
                  class="form-input"
                  maxlength="500"
                  bind:value={todo.verantwortlich}
                />
              {/snippet}
            </FormField>
            <FormField id="todo-{index}-frist" label="Frist" optional>
              {#snippet children(attrs)}
                <input {...attrs} class="form-input" maxlength="500" bind:value={todo.frist} />
              {/snippet}
            </FormField>
            <ActionButton variant="danger" onclick={() => draft!.todos.splice(index, 1)}>
              Entfernen<span class="sr-only"> (To-do {index + 1})</span>
            </ActionButton>
          </div>
        {/each}
        {#if draftErrors.todos}<p class="text-sm text-danger">{draftErrors.todos}</p>{/if}
        <ActionButton
          onclick={() => draft!.todos.push({ aufgabe: '', verantwortlich: '', frist: '' })}
        >
          To-do hinzufügen
        </ActionButton>
      </fieldset>

      <FormField
        id="notizen-offen"
        label="Offene Punkte"
        hint="Ein Punkt pro Zeile."
        error={draftErrors.offenePunkte}
      >
        {#snippet children(attrs)}
          <textarea {...attrs} class="form-input" rows="3" bind:value={draft!.offenePunkte}
          ></textarea>
        {/snippet}
      </FormField>

      <FormField
        id="notizen-termin"
        label="Nächster Termin"
        optional
        error={draftErrors.naechsterTermin}
      >
        {#snippet children(attrs)}
          <input
            {...attrs}
            class="form-input"
            maxlength="500"
            bind:value={draft!.naechsterTermin}
          />
        {/snippet}
      </FormField>
    </div>
  {/if}
</EditDialog>
