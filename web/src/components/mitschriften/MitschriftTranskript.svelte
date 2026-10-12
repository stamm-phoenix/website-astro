<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import EditDialog from '../pflege/EditDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { ApiError, sendApi } from '../../lib/api';
  import { formatClock, sprecherLabel } from '../../lib/mitschriften';
  import type { MitschriftAbschnitt, MitschriftDetail, MitschriftSprecher } from '../../lib/types';

  interface Props {
    mitschrift: MitschriftDetail;
    /** Sentences of the live recording that are not in `mitschrift` yet. */
    pending?: {
      key: string;
      source: 'raum' | 'teams';
      speakerKey: string | null;
      startMs: number;
      text: string;
      saved: boolean;
    }[];
    /** Text that is being recognized right now, per source. */
    partials?: { source: 'raum' | 'teams'; text: string }[];
    sprecher?: MitschriftSprecher[];
    onchange: () => Promise<void>;
    /** Called after sentences were deleted; the notes have to be generated again. */
    ondeleted: () => Promise<void>;
    notify: (text: string, kind?: 'success' | 'warning' | 'error') => void;
  }
  let {
    mitschrift,
    pending = [],
    partials = [],
    sprecher = mitschrift.sprecher,
    onchange,
    ondeleted,
    notify,
  }: Props = $props();

  const labels = $derived(
    new Map(sprecher.map((s) => [s.id, sprecherLabel(s.source, s.number, s.name)]))
  );
  const labelsByKey = $derived(
    new Map(
      sprecher.map((s) => [`${s.source}|${s.key}`, sprecherLabel(s.source, s.number, s.name)])
    )
  );

  interface Line {
    key: string;
    abschnitt: MitschriftAbschnitt | null;
    speaker: string;
    startMs: number;
    text: string;
    saved: boolean;
  }

  const lines = $derived.by((): Line[] => {
    const stored = new Set(mitschrift.abschnitte.map((a) => a.text + a.startMs));
    const all: Line[] = mitschrift.abschnitte.map((a) => ({
      key: `a${a.id}`,
      abschnitt: a,
      speaker: (a.sprecherId !== null && labels.get(a.sprecherId)) || 'Unbekannt',
      startMs: a.startMs,
      text: a.text,
      saved: true,
    }));
    for (const p of pending) {
      if (stored.has(p.text + p.startMs)) continue;
      all.push({
        key: p.key,
        abschnitt: null,
        speaker: (p.speakerKey && labelsByKey.get(`${p.source}|${p.speakerKey}`)) || '…',
        startMs: p.startMs,
        text: p.text,
        saved: p.saved,
      });
    }
    return all.sort((a, b) => a.startMs - b.startMs);
  });

  let selecting = $state(false);
  let selected = $state<number[]>([]);
  let confirmDelete = $state(false);
  let deleteBusy = $state(false);
  let deleteError = $state<string | null>(null);

  let editing = $state<{ abschnitt: MitschriftAbschnitt; text: string; sprecherId: string } | null>(
    null
  );
  let editErrors = $state<Record<string, string>>({});
  let editError = $state<string | null>(null);
  let editBusy = $state(false);

  let renaming = $state<{ sprecher: MitschriftSprecher; name: string; into: string } | null>(null);
  let renameErrors = $state<Record<string, string>>({});
  let renameError = $state<string | null>(null);
  let renameBusy = $state(false);

  function errorText(error: unknown, fallback: string): string {
    return error instanceof ApiError ? error.message : fallback;
  }

  function toggle(id: number, on: boolean): void {
    selected = on ? [...selected, id] : selected.filter((s) => s !== id);
  }

  async function removeSelected(): Promise<void> {
    deleteBusy = true;
    deleteError = null;
    try {
      const { deleted } = await sendApi<{ deleted: number }>(
        'POST',
        `/intern/pflege/mitschriften/${mitschrift.id}/abschnitte-loeschen`,
        { ids: selected }
      );
      confirmDelete = false;
      selecting = false;
      selected = [];
      notify(`${deleted} ${deleted === 1 ? 'Abschnitt' : 'Abschnitte'} endgültig gelöscht.`);
      await ondeleted();
    } catch (error: unknown) {
      deleteError = errorText(error, 'Das Löschen hat nicht geklappt.');
    } finally {
      deleteBusy = false;
    }
  }

  async function saveEdit(): Promise<void> {
    if (!editing) return;
    editBusy = true;
    editErrors = {};
    editError = null;
    try {
      await sendApi(
        'PATCH',
        `/intern/pflege/mitschriften/${mitschrift.id}/abschnitte/${editing.abschnitt.id}`,
        {
          text: editing.text,
          sprecherId: editing.sprecherId ? Number(editing.sprecherId) : null,
          etag: editing.abschnitt.etag,
        }
      );
      editing = null;
      notify('Abschnitt gespeichert.');
      await onchange();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) editErrors = error.fields;
      editError = errorText(error, 'Der Abschnitt konnte nicht gespeichert werden.');
    } finally {
      editBusy = false;
    }
  }

  async function saveSprecher(): Promise<void> {
    if (!renaming) return;
    renameBusy = true;
    renameErrors = {};
    renameError = null;
    const base = `/intern/pflege/mitschriften/${mitschrift.id}/sprecher/${renaming.sprecher.id}`;
    try {
      if (renaming.into) {
        await sendApi('POST', `${base}/zusammenlegen`, { into: Number(renaming.into) });
        notify('Sprecher zusammengelegt.');
      } else {
        await sendApi('PATCH', base, { name: renaming.name, etag: renaming.sprecher.etag });
        notify('Sprecher umbenannt.');
      }
      renaming = null;
      await onchange();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) renameErrors = error.fields;
      renameError = errorText(error, 'Das hat nicht geklappt.');
    } finally {
      renameBusy = false;
    }
  }
</script>

<section aria-labelledby="transkript-heading" class="space-y-4">
  <div class="flex flex-wrap items-baseline justify-between gap-3">
    <h2 id="transkript-heading" class="font-serif text-2xl text-brand-900">Transkript</h2>
    {#if mitschrift.abschnitte.length > 0}
      <div class="flex flex-wrap gap-2">
        {#if selecting}
          <ActionButton
            variant="danger"
            disabled={selected.length === 0}
            onclick={() => {
              confirmDelete = true;
              deleteError = null;
            }}
          >
            {selected.length} endgültig löschen
          </ActionButton>
          <ActionButton
            onclick={() => {
              selecting = false;
              selected = [];
            }}
          >
            Abbrechen
          </ActionButton>
        {:else}
          <ActionButton onclick={() => (selecting = true)}>Abschnitte löschen</ActionButton>
        {/if}
      </div>
    {/if}
  </div>

  {#if sprecher.length > 0}
    <div>
      <h3 class="text-sm font-semibold text-neutral-800">Sprecher</h3>
      <p class="text-xs text-neutral-700">
        Zum Umbenennen oder Zusammenlegen anklicken. Namen gelten nur für diese Mitschrift.
      </p>
      <ul class="mt-2 flex flex-wrap gap-2">
        {#each sprecher as person (person.id)}
          <li>
            <button
              type="button"
              class="btn-secondary text-sm"
              onclick={() => {
                renaming = { sprecher: person, name: person.name, into: '' };
                renameErrors = {};
                renameError = null;
              }}
            >
              {sprecherLabel(person.source, person.number, person.name)}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if lines.length === 0 && partials.length === 0}
    <p class="text-sm text-neutral-700">Noch kein Transkript.</p>
  {:else}
    <ol class="divide-y divide-neutral-200 border-y border-neutral-200" aria-live="off">
      {#each lines as line, index (line.key)}
        {@const same = index > 0 && lines[index - 1].speaker === line.speaker}
        <li class="flex gap-3 py-2">
          {#if selecting && line.abschnitt}
            <input
              type="checkbox"
              class="mt-1"
              aria-label="Abschnitt ab {formatClock(line.startMs)} auswählen"
              checked={selected.includes(line.abschnitt.id)}
              onchange={(event) => toggle(line.abschnitt!.id, event.currentTarget.checked)}
            />
          {/if}
          <div class="min-w-0 flex-1">
            {#if !same}
              <p class="text-sm font-semibold text-brand-900">
                {line.speaker}
                <span class="font-normal text-neutral-700">{formatClock(line.startMs)}</span>
              </p>
            {/if}
            {#if line.abschnitt && !selecting}
              <button
                type="button"
                class="w-full text-left hover:underline focus-visible:underline"
                onclick={() => {
                  editing = {
                    abschnitt: line.abschnitt!,
                    text: line.abschnitt!.text,
                    sprecherId:
                      line.abschnitt!.sprecherId === null ? '' : String(line.abschnitt!.sprecherId),
                  };
                  editErrors = {};
                  editError = null;
                }}
              >
                {line.text}<span class="sr-only"> (bearbeiten)</span>
              </button>
            {:else}
              <p class={line.saved ? '' : 'text-neutral-700'}>
                {line.text}
                {#if !line.saved}<span class="sr-only"> (noch nicht gespeichert)</span>{/if}
              </p>
            {/if}
          </div>
        </li>
      {/each}
      {#each partials as partial (partial.source)}
        <li class="py-2 text-neutral-700 italic">
          <span class="text-sm font-semibold not-italic">
            {partial.source === 'teams' ? 'Teams' : 'Raum'} …
          </span>
          {partial.text}
        </li>
      {/each}
    </ol>
  {/if}
</section>

<EditDialog
  open={confirmDelete}
  title="Abschnitte endgültig löschen"
  busy={deleteBusy}
  error={deleteError}
  submitLabel="Endgültig löschen"
  busyLabel="Wird gelöscht …"
  onsubmit={removeSelected}
  onclose={() => (confirmDelete = false)}
>
  <div class="space-y-2 text-sm text-neutral-800">
    <p>
      {selected.length}
      {selected.length === 1 ? 'Abschnitt wird' : 'Abschnitte werden'} endgültig gelöscht. Das lässt sich
      nicht rückgängig machen.
    </p>
    <p>
      Die Notizen werden danach aus dem verbleibenden Transkript neu erzeugt, damit nichts davon in
      der Zusammenfassung bleibt.
      {#if mitschrift.notesEdited}
        <strong>Die Notizen wurden von Hand geändert; diese Änderungen gehen dabei verloren.</strong
        >
      {/if}
    </p>
  </div>
</EditDialog>

<EditDialog
  open={editing !== null}
  title="Abschnitt bearbeiten"
  busy={editBusy}
  error={editError}
  onsubmit={saveEdit}
  onclose={() => (editing = null)}
>
  {#if editing}
    <div class="space-y-4">
      <FormField id="abschnitt-sprecher" label="Sprecher" error={editErrors.sprecherId}>
        {#snippet children(attrs)}
          <select {...attrs} class="form-input" bind:value={editing!.sprecherId}>
            <option value="">Unbekannt</option>
            {#each sprecher as person (person.id)}
              <option value={String(person.id)}>
                {sprecherLabel(person.source, person.number, person.name)}
              </option>
            {/each}
          </select>
        {/snippet}
      </FormField>
      <FormField id="abschnitt-text" label="Text" error={editErrors.text}>
        {#snippet children(attrs)}
          <textarea
            {...attrs}
            class="form-input"
            rows="4"
            maxlength="4000"
            bind:value={editing!.text}></textarea>
        {/snippet}
      </FormField>
    </div>
  {/if}
</EditDialog>

<EditDialog
  open={renaming !== null}
  title="Sprecher bearbeiten"
  busy={renameBusy}
  error={renameError}
  submitLabel={renaming?.into ? 'Zusammenlegen' : 'Speichern'}
  onsubmit={saveSprecher}
  onclose={() => (renaming = null)}
>
  {#if renaming}
    <div class="space-y-4">
      <FormField
        id="sprecher-name"
        label="Name"
        optional
        hint="Leer lassen für „{sprecherLabel(
          renaming.sprecher.source,
          renaming.sprecher.number,
          ''
        )}“."
        error={renameErrors.name}
      >
        {#snippet children(attrs)}
          <input
            {...attrs}
            class="form-input"
            maxlength="100"
            disabled={renaming!.into !== ''}
            bind:value={renaming!.name}
          />
        {/snippet}
      </FormField>
      <FormField
        id="sprecher-into"
        label="Oder zusammenlegen mit"
        optional
        hint="Alle Sätze gehen an den gewählten Sprecher, dieser Sprecher verschwindet."
        error={renameErrors.into}
      >
        {#snippet children(attrs)}
          <select {...attrs} class="form-input" bind:value={renaming!.into}>
            <option value="">Nicht zusammenlegen</option>
            {#each sprecher.filter((s) => s.id !== renaming!.sprecher.id) as person (person.id)}
              <option value={String(person.id)}>
                {sprecherLabel(person.source, person.number, person.name)}
              </option>
            {/each}
          </select>
        {/snippet}
      </FormField>
    </div>
  {/if}
</EditDialog>
