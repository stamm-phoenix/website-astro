<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import { tick, untrack } from 'svelte';
  import { ApiError, sanitizeDescription, sendApi } from '../../lib/api';
  import { createDialogForm, dialogMessage } from '../../lib/dialogForm.svelte';
  import { FAQ_PFLEGE } from '../../lib/pflegeStore.svelte';
  import type { StaffQuestionAndAnswer } from '../../lib/types';
  import EditDialog from './EditDialog.svelte';
  import FormField from './FormField.svelte';
  import RichTextEditor from './RichTextEditor.svelte';
  import StatusNotice from './StatusNotice.svelte';

  interface Form {
    id: string | null;
    etag: string;
    question: string;
    answer: string;
    category: string;
    published: boolean;
  }

  const store = FAQ_PFLEGE.state;
  let form = $state<Form | null>(null);
  let search = $state('');
  // A missing version has no field of its own
  const dialog = createDialogForm(
    (error, fallback) =>
      (error instanceof ApiError && error.fields?.etag) || dialogMessage(error, fallback)
  );
  const errors = $derived(dialog.state.fields);
  const busy = $derived(dialog.state.busy);
  let message = $state<string | null>(null);

  const categories = $derived(
    [
      ...new Set([
        ...(store.data?.categories ?? []),
        ...(store.data?.items ?? []).map((item) => item.category),
      ]),
    ].sort((a, b) => a.localeCompare(b, 'de'))
  );
  const groups = $derived.by(() => {
    const query = search.trim().toLocaleLowerCase('de');
    const items = [...(store.data?.items ?? [])]
      .filter((item) => `${item.question} ${item.category}`.toLocaleLowerCase('de').includes(query))
      .sort(
        (a, b) =>
          a.category.localeCompare(b.category, 'de') || a.question.localeCompare(b.question, 'de')
      );
    const grouped: Record<string, StaffQuestionAndAnswer[]> = Object.create(null);
    for (const item of items) {
      (grouped[item.category] ??= []).push(item);
    }
    return Object.entries(grouped).map(([category, items]) => ({ category, items }));
  });

  $effect(() => {
    untrack(() => {
      void FAQ_PFLEGE.load().then(openFromUrl);
    });
  });

  /** Reloads the list; a successful retry also opens the dialog a link asked for. */
  async function reload(): Promise<void> {
    await FAQ_PFLEGE.load({ force: true });
    openFromUrl();
  }

  /** Opens the dialog for `?neu` or `?bearbeiten=<id>`, as linked from the public FAQ page. */
  function openFromUrl(): void {
    // Without loaded data there are no categories; the parameters stay for a later retry
    if (!store.data) return;
    const params = new URLSearchParams(window.location.search);
    const editId = params.get('bearbeiten');
    const item = editId ? store.data?.items.find((entry) => entry.id === editId) : undefined;
    if (item) open(item);
    else if (params.has('neu')) open();
    else return;
    window.history.replaceState(null, '', window.location.pathname);
  }

  function open(item?: StaffQuestionAndAnswer): void {
    form = item
      ? { ...item }
      : {
          id: null,
          etag: '',
          question: '',
          answer: '',
          published: false,
          category: store.data?.allowCustomCategories ? '' : (store.data?.categories[0] ?? ''),
        };
    dialog.reset();
  }

  /** After a conflict: replaces the input with the current version of the question. */
  async function reloadCurrent(): Promise<boolean> {
    const id = form?.id;
    await FAQ_PFLEGE.load({ force: true });
    const fresh = store.data?.items.find((item) => item.id === id);
    if (!fresh) {
      form = null;
      message = 'Die Frage wurde inzwischen gelöscht.';
      return false;
    }
    open(fresh);
    return true;
  }

  function close(): void {
    if (!busy) form = null;
  }

  function validate(f: Form): Record<string, string> {
    const result: Record<string, string> = {};
    if (!f.question.trim()) result.question = 'Bitte eine Frage angeben.';
    if (f.published && !sanitizeDescription(f.answer))
      result.answer = 'Bitte eine Antwort angeben.';
    return result;
  }

  async function save(): Promise<void> {
    if (!form || busy) return;
    if (dialog.invalid(validate(form))) {
      await tick();
      document.getElementById(errors.question ? 'faq-question' : 'faq-answer')?.focus();
      return;
    }

    const { id, ...body } = form;
    await dialog.run(async () => {
      if (id) await sendApi('PATCH', `/intern/pflege/qa/${id}`, body);
      else await sendApi('POST', '/intern/pflege/qa', body);
      message = body.published
        ? 'Frage gespeichert. Die Antwort ist jetzt öffentlich sichtbar.'
        : 'Entwurf gespeichert. Die Frage ist nicht öffentlich sichtbar.';
      form = null;
      await FAQ_PFLEGE.load({ force: true });
    }, 'Die Frage wurde nicht gespeichert. Deine Eingaben sind noch da. Tippe noch einmal auf „Speichern“.');
  }

  async function remove(): Promise<void> {
    const current = form;
    if (!current?.id || busy) return;
    await dialog.run(async () => {
      await sendApi('DELETE', `/intern/pflege/qa/${current.id}`, undefined, {
        etag: current.etag,
      });
      message = 'Frage gelöscht. Sie erscheint nicht mehr in der öffentlichen FAQ.';
      form = null;
      await FAQ_PFLEGE.load({ force: true });
    }, 'Die Frage wurde nicht gelöscht. Tippe noch einmal auf „Löschen“.');
  }
</script>

<div class="space-y-6">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div class="w-full sm:max-w-sm">
      <label for="faq-search" class="form-label">Frage oder Thema suchen</label>
      <input id="faq-search" type="search" class="form-input" bind:value={search} />
    </div>
    <div class="flex flex-wrap gap-2">
      <ActionButton
        variant="secondary"
        type="button"
        disabled={store.loading || busy}
        onclick={() => void reload()}>Neu laden</ActionButton
      >
      <ActionButton
        variant="primary"
        type="button"
        disabled={!store.data || busy}
        onclick={() => open()}>Neue Frage</ActionButton
      >
    </div>
  </div>

  <StatusNotice {message} popup />

  <LoadState
    data={store.data}
    loading={store.loading}
    error={store.error}
    loadingText="Fragen werden geladen …"
    onretry={() => void reload()}
    isEmpty={() => groups.length === 0}
  >
    {#snippet empty()}
      {#if store.data?.items.length === 0}
        <div class="border-t border-neutral-200 pt-5">
          <h2 class="font-serif text-xl text-brand-900">Noch keine Fragen angelegt</h2>
          <p class="mt-2 text-sm text-neutral-700">
            Lege die erste Frage als Entwurf an und veröffentliche sie, sobald die Antwort fertig
            ist.
          </p>
        </div>
      {:else}
        <div class="border-t border-neutral-200 pt-5" role="status">
          <p>Keine Frage passt zu deiner Suche.</p>
          <ActionButton variant="secondary" type="button" class="mt-3" onclick={() => (search = '')}
            >Suche zurücksetzen</ActionButton
          >
        </div>
      {/if}
    {/snippet}
    {#each groups as group (group.category)}
      <section class="pt-2" aria-label={`Thema ${group.category}`}>
        <h2
          class="break-words border-b border-neutral-300 pb-2 font-serif text-xl font-semibold text-brand-900 [overflow-wrap:anywhere]"
        >
          {group.category}
        </h2>
        <ul class="divide-y divide-neutral-200 border-b border-neutral-200">
          {#each group.items as item (item.id)}
            <li
              class="flex flex-col items-start gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="min-w-0">
                <p class="font-semibold text-brand-900 [overflow-wrap:anywhere]">
                  {item.question || 'Frage ohne Titel'}
                </p>
                <p
                  class="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold {item.published
                    ? 'text-success'
                    : 'text-neutral-700'}"
                >
                  <span
                    aria-hidden="true"
                    class="size-2 rounded-full {item.published
                      ? 'bg-success'
                      : 'border border-neutral-500'}"
                  ></span>
                  {item.published ? 'Veröffentlicht' : 'Entwurf'}
                </p>
                {#if !item.question.trim() || !item.answer}
                  <p class="mt-1 text-sm text-danger">
                    Unvollständig – bitte Frage und Antwort ergänzen.
                  </p>
                {/if}
              </div>
              <ActionButton
                variant="secondary"
                type="button"
                class="shrink-0"
                aria-label={`Bearbeiten: ${item.question || 'Frage ohne Titel'}`}
                disabled={busy}
                onclick={() => open(item)}
              >
                Bearbeiten
              </ActionButton>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </LoadState>
</div>

<EditDialog
  open={form !== null}
  title={form?.id ? 'Frage bearbeiten' : 'Neue Frage'}
  {busy}
  error={dialog.state.error}
  onreload={dialog.state.conflict ? reloadCurrent : undefined}
  onsubmit={save}
  onclose={close}
  ondelete={form?.id ? remove : undefined}
  deleteQuestion="Die Frage und ihre Antwort endgültig löschen?"
>
  {#if form}
    <p class="text-sm text-neutral-700">
      Nur veröffentlichte Fragen und Antworten sind in der öffentlichen FAQ sichtbar.
    </p>
    <fieldset disabled={busy} class="min-w-0 space-y-4">
      <legend class="sr-only">Frage und Antwort</legend>
      <FormField id="faq-published" label="Status" error={errors.published}>
        {#snippet children(attrs)}
          <label class="flex items-center gap-2 text-sm font-semibold text-neutral-800">
            <input {...attrs} type="checkbox" bind:checked={form!.published} />
            Veröffentlicht (auf der Website sichtbar)
          </label>
        {/snippet}
      </FormField>
      <FormField id="faq-question" label="Frage" error={errors.question}>
        {#snippet children(attrs)}<textarea
            {...attrs}
            class="form-input resize-y"
            rows="2"
            maxlength="255"
            bind:value={form!.question}></textarea>{/snippet}
      </FormField>
      <FormField
        id="faq-category"
        label="Thema"
        optional={store.data?.allowCustomCategories}
        hint={store.data?.allowCustomCategories
          ? 'Wähle ein vorhandenes Thema oder gib ein neues ein. Ohne Thema wird die Frage unter „Allgemein“ angezeigt.'
          : 'Wähle eines der vorhandenen Themen.'}
        error={errors.category}
      >
        {#snippet children(attrs)}
          {#if store.data?.allowCustomCategories}
            <input
              {...attrs}
              class="form-input"
              list="faq-categories"
              maxlength="100"
              bind:value={form!.category}
            />
          {:else}
            <select {...attrs} class="form-input" bind:value={form!.category}>
              <option value="" disabled>Bitte wählen</option>
              {#each store.data?.categories ?? [] as category (category)}
                <option value={category}>{category}</option>
              {/each}
            </select>
          {/if}
        {/snippet}
      </FormField>
      <datalist id="faq-categories"
        >{#each categories as category (category)}<option value={category}
          ></option>{/each}</datalist
      >
      <div inert={busy}>
        <span id="faq-answer-label" class="form-label">Antwort</span>
        <RichTextEditor
          id="faq-answer"
          labelledBy="faq-answer-label"
          describedBy={errors.answer ? 'faq-answer-hint faq-answer-error' : 'faq-answer-hint'}
          invalid={!!errors.answer}
          bind:value={form.answer}
        />
        <p id="faq-answer-hint" class="mt-1 text-xs text-neutral-700">
          Bis zu 5000 Zeichen. Fett, kursiv und Listen sind möglich. Für Entwürfe kann die Antwort
          noch leer bleiben.
        </p>
        {#if errors.answer}<p id="faq-answer-error" class="mt-1 text-sm text-danger">
            {errors.answer}
          </p>{/if}
      </div>
    </fieldset>
  {/if}
</EditDialog>
