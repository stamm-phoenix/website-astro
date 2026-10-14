<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import EditDialog from '../pflege/EditDialog.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { errorMessage, sendApi } from '../../lib/api';
  import { createDialogForm } from '../../lib/dialogForm.svelte';
  import { formatClock, joinSentences, sprecherLabel } from '../../lib/mitschriften';
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
    /** Speakers of the live recording; otherwise those of `mitschrift`. */
    sprecher?: MitschriftSprecher[];
    onchange: () => Promise<void>;
    /** Called after sentences were deleted; the notes have to be generated again. */
    ondeleted: () => Promise<void>;
    /** Joins sentences cut apart at a pause; not offered during the live recording. */
    onsmooth?: () => Promise<void>;
    smoothing?: boolean;
    notify: (text: string, kind?: 'success' | 'warning' | 'error') => void;
  }
  let {
    mitschrift,
    pending = [],
    partials = [],
    sprecher: liveSprecher,
    onchange,
    ondeleted,
    onsmooth,
    smoothing = false,
    notify,
  }: Props = $props();

  // Derived, so the list follows every reload of the Mitschrift (renamed or merged speakers)
  const sprecher = $derived(liveSprecher ?? mitschrift.sprecher);

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
  /** Text of the selected sentences joined, as the person checks it before saving. */
  let merging = $state<{ text: string } | null>(null);
  // A conflict cannot be reloaded here, so the dialogs show the API's own message
  const mergeForm = createDialogForm(errorMessage);

  /** The selected sentences in the order they were said. */
  const selectedAbschnitte = $derived(
    mitschrift.abschnitte
      .filter((a) => selected.includes(a.id))
      .sort((a, b) => a.startMs - b.startMs || a.id - b.id)
  );

  function startMerge(): void {
    merging = { text: joinSentences(selectedAbschnitte.map((a) => a.text)) };
    mergeForm.reset();
  }

  async function mergeSelected(): Promise<void> {
    if (!merging) return;
    const current = merging;
    await mergeForm.run(async () => {
      await sendApi(
        'POST',
        `/intern/pflege/mitschriften/${mitschrift.id}/abschnitte-zusammenfuegen`,
        {
          abschnitte: selectedAbschnitte.map((a) => ({ id: a.id, etag: a.etag })),
          text: current.text,
        }
      );
      merging = null;
      selecting = false;
      selected = [];
      notify('Abschnitte zusammengefügt.');
      await onchange();
    }, 'Die Abschnitte konnten nicht zusammengefügt werden.');
  }
  const deleteForm = createDialogForm(errorMessage);

  let editing = $state<{ abschnitt: MitschriftAbschnitt; text: string; sprecherId: string } | null>(
    null
  );
  const editForm = createDialogForm(errorMessage);

  let renaming = $state<{ sprecher: MitschriftSprecher; name: string; into: string } | null>(null);
  const renameForm = createDialogForm(errorMessage);

  function toggle(id: number, on: boolean): void {
    selected = on ? [...selected, id] : selected.filter((s) => s !== id);
  }

  async function removeSelected(): Promise<void> {
    await deleteForm.run(async () => {
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
    }, 'Das Löschen hat nicht geklappt.');
  }

  async function saveEdit(): Promise<void> {
    if (!editing) return;
    const current = editing;
    await editForm.run(async () => {
      await sendApi(
        'PATCH',
        `/intern/pflege/mitschriften/${mitschrift.id}/abschnitte/${current.abschnitt.id}`,
        {
          text: current.text,
          sprecherId: current.sprecherId ? Number(current.sprecherId) : null,
          etag: current.abschnitt.etag,
        }
      );
      editing = null;
      notify('Abschnitt gespeichert.');
      await onchange();
    }, 'Der Abschnitt konnte nicht gespeichert werden.');
  }

  async function saveSprecher(): Promise<void> {
    if (!renaming) return;
    const current = renaming;
    const base = `/intern/pflege/mitschriften/${mitschrift.id}/sprecher/${current.sprecher.id}`;
    await renameForm.run(async () => {
      if (current.into) {
        await sendApi('POST', `${base}/zusammenlegen`, { into: Number(current.into) });
        notify('Sprecher zusammengelegt.');
      } else {
        await sendApi('PATCH', base, { name: current.name, etag: current.sprecher.etag });
        notify('Sprecher umbenannt.');
      }
      renaming = null;
      await onchange();
    }, 'Das hat nicht geklappt.');
  }
</script>

<section aria-labelledby="transkript-heading" class="space-y-4">
  <div class="flex flex-wrap items-baseline justify-between gap-3">
    <h2 id="transkript-heading" class="font-serif text-2xl text-brand-900">Transkript</h2>
    {#if mitschrift.abschnitte.length > 0}
      <div class="flex flex-wrap gap-2">
        {#if selecting}
          <ActionButton disabled={selected.length < 2} onclick={startMerge}>
            Zusammenfügen
          </ActionButton>
          <ActionButton
            variant="danger"
            disabled={selected.length === 0}
            onclick={() => {
              confirmDelete = true;
              deleteForm.reset();
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
          {#if onsmooth}
            <ActionButton disabled={smoothing} aria-busy={smoothing} onclick={onsmooth}>
              {smoothing ? 'Wird zusammengefügt …' : 'Getrennte Sätze zusammenfügen'}
            </ActionButton>
          {/if}
          <ActionButton onclick={() => (selecting = true)}>Abschnitte auswählen</ActionButton>
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
                renameForm.reset();
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
                  editForm.reset();
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
  open={merging !== null}
  title="Abschnitte zusammenfügen"
  busy={mergeForm.state.busy}
  error={mergeForm.state.error}
  submitLabel="Zusammenfügen"
  busyLabel="Wird zusammengefügt …"
  onsubmit={mergeSelected}
  onclose={() => (merging = null)}
>
  {#if merging}
    <FormField
      id="abschnitte-text"
      label="Text"
      hint="{selectedAbschnitte.length} Abschnitte werden zu einem; er behält den Sprecher des ersten. Punkte und Großschreibung an den Schnitten sind schon angepasst, bitte prüfen."
      error={mergeForm.state.fields.text ?? mergeForm.state.fields.abschnitte}
    >
      {#snippet children(attrs)}
        <textarea {...attrs} class="form-input" rows="6" maxlength="4000" bind:value={merging!.text}
        ></textarea>
      {/snippet}
    </FormField>
  {/if}
</EditDialog>

<ConfirmDialog
  open={confirmDelete}
  title="Abschnitte endgültig löschen"
  busy={deleteForm.state.busy}
  error={deleteForm.state.error}
  submitLabel="Endgültig löschen"
  busyLabel="Wird gelöscht …"
  onconfirm={removeSelected}
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
</ConfirmDialog>

<EditDialog
  open={editing !== null}
  title="Abschnitt bearbeiten"
  busy={editForm.state.busy}
  error={editForm.state.error}
  onsubmit={saveEdit}
  onclose={() => (editing = null)}
>
  {#if editing}
    <div class="space-y-4">
      <FormField id="abschnitt-sprecher" label="Sprecher" error={editForm.state.fields.sprecherId}>
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
      <FormField id="abschnitt-text" label="Text" error={editForm.state.fields.text}>
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
  busy={renameForm.state.busy}
  error={renameForm.state.error}
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
        error={renameForm.state.fields.name}
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
        error={renameForm.state.fields.into}
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
