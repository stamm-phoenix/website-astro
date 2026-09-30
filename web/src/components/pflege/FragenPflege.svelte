<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { ApiError, sanitizeDescription, sendApi } from '../../lib/api';
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
  }

  const store = FAQ_PFLEGE.state;
  let form = $state<Form | null>(null);
  let search = $state('');
  let busy = $state(false);
  let errors = $state<Record<string, string>>({});
  let dialogError = $state<string | null>(null);
  let confirmDelete = $state(false);
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
    untrack(() => FAQ_PFLEGE.load());
  });

  function open(item?: StaffQuestionAndAnswer): void {
    form = item
      ? { ...item }
      : {
          id: null,
          etag: '',
          question: '',
          answer: '',
          category: store.data?.allowCustomCategories ? '' : (store.data?.categories[0] ?? ''),
        };
    errors = {};
    dialogError = null;
    confirmDelete = false;
  }

  function close(): void {
    if (!busy) form = null;
  }

  function handleError(error: unknown, fallback: string): void {
    if (error instanceof ApiError) {
      errors = { ...errors, ...error.fields };
      dialogError =
        error.code === 'CONFLICT'
          ? 'Der Eintrag wurde inzwischen geändert. Deine Eingaben bleiben hier erhalten. Bitte kopiere sie bei Bedarf, schließe den Dialog und lade die Liste neu.'
          : (error.fields?.etag ?? error.message);
    } else dialogError = fallback;
  }

  async function save(): Promise<void> {
    if (!form || busy) return;
    errors = {};
    dialogError = null;
    if (!form.question.trim()) errors.question = 'Bitte eine Frage angeben.';
    if (!sanitizeDescription(form.answer)) errors.answer = 'Bitte eine Antwort angeben.';
    if (Object.keys(errors).length) {
      await tick();
      document.getElementById(errors.question ? 'faq-question' : 'faq-answer')?.focus();
      return;
    }

    busy = true;
    const { id, ...body } = form;
    try {
      if (id) await sendApi('PATCH', `/intern/pflege/qa/${id}`, body);
      else await sendApi('POST', '/intern/pflege/qa', body);
      message = 'Frage gespeichert. Die Antwort ist jetzt öffentlich sichtbar.';
      form = null;
      await FAQ_PFLEGE.load({ force: true });
    } catch (error: unknown) {
      handleError(
        error,
        'Speichern fehlgeschlagen. Bitte prüfe deine Verbindung und versuche es erneut.'
      );
    } finally {
      busy = false;
    }
  }

  async function remove(): Promise<void> {
    if (!form?.id || busy) return;
    busy = true;
    dialogError = null;
    try {
      await sendApi('DELETE', `/intern/pflege/qa/${form.id}`, undefined, { etag: form.etag });
      message = 'Frage gelöscht. Sie erscheint nicht mehr in der öffentlichen FAQ.';
      form = null;
      await FAQ_PFLEGE.load({ force: true });
    } catch (error: unknown) {
      handleError(
        error,
        'Löschen fehlgeschlagen. Bitte prüfe deine Verbindung und versuche es erneut.'
      );
    } finally {
      busy = false;
    }
  }
</script>

<div class="space-y-6">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div class="w-full sm:max-w-sm">
      <label for="faq-search" class="form-label">Frage oder Thema suchen</label>
      <input id="faq-search" type="search" class="form-input" bind:value={search} />
    </div>
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        class="btn-secondary"
        disabled={store.loading || busy}
        onclick={() => FAQ_PFLEGE.load({ force: true })}>Neu laden</button
      >
      <button
        type="button"
        class="btn-primary"
        disabled={!store.data || busy}
        onclick={() => open()}>Neue Frage</button
      >
    </div>
  </div>

  <StatusNotice {message} />

  {#if store.error}
    <div role="alert" class="surface border-l-4! border-l-[var(--color-dpsg-red)]! p-5">
      <p class="text-sm text-neutral-700">{store.error}</p>
      {#if store.data}<p class="mt-1 text-sm text-neutral-700">
          Die angezeigte Liste konnte nicht aktualisiert werden.
        </p>{/if}
      <button
        type="button"
        class="btn-secondary mt-3"
        disabled={store.loading || busy}
        onclick={() => FAQ_PFLEGE.load({ force: true })}>Erneut versuchen</button
      >
    </div>
  {/if}

  {#if !store.data && store.loading}
    <div role="status" aria-live="polite" class="space-y-3">
      <span class="sr-only">Fragen werden geladen …</span>
      {#each [1, 2, 3] as n (n)}<div
          class="skeleton-element h-16 rounded-[var(--radius-lg)]"
        ></div>{/each}
    </div>
  {:else if store.data?.items.length === 0}
    <div class="surface p-6">
      <h2 class="font-serif text-xl text-brand-900">Noch keine Fragen angelegt</h2>
      <p class="mt-2 text-sm text-neutral-700">
        Lege die erste Frage mit einer Antwort an. Sie erscheint nach dem Speichern in der
        öffentlichen FAQ.
      </p>
    </div>
  {:else if store.data && groups.length === 0}
    <div class="surface p-6" role="status">
      <p>Keine Frage passt zu deiner Suche.</p>
      <button type="button" class="btn-secondary mt-3" onclick={() => (search = '')}
        >Suche zurücksetzen</button
      >
    </div>
  {:else}
    {#each groups as group (group.category)}
      <section class="surface overflow-hidden" aria-label={`Thema ${group.category}`}>
        <h2
          class="break-words bg-[var(--color-brand-50)] px-5 py-3 font-serif text-xl text-brand-900 [overflow-wrap:anywhere]"
        >
          {group.category}
        </h2>
        <ul class="divide-y divide-[var(--color-neutral-200)]">
          {#each group.items as item (item.id)}
            <li
              class="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="min-w-0">
                <p class="font-semibold text-brand-900 [overflow-wrap:anywhere]">
                  {item.question || 'Frage ohne Titel'}
                </p>
                {#if !item.question.trim() || !item.answer}
                  <p class="mt-1 text-sm text-[var(--color-dpsg-red)]">
                    Unvollständig – bitte Frage und Antwort ergänzen.
                  </p>
                {/if}
              </div>
              <button
                type="button"
                class="btn-secondary shrink-0"
                aria-label={`Bearbeiten: ${item.question || 'Frage ohne Titel'}`}
                disabled={busy}
                onclick={() => open(item)}
              >
                Bearbeiten
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
</div>

<EditDialog
  open={form !== null}
  title={form?.id ? 'Frage bearbeiten' : 'Neue Frage'}
  {busy}
  error={dialogError}
  onsubmit={save}
  onclose={close}
>
  {#if form}
    <p class="rounded-md bg-[var(--color-brand-50)] px-3 py-2 text-sm text-brand-900">
      Frage und Antwort sind nach dem Speichern öffentlich sichtbar.
    </p>
    <fieldset disabled={busy} class="min-w-0 space-y-4">
      <legend class="sr-only">Frage und Antwort</legend>
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
          Bis zu 5000 Zeichen. Fett, kursiv und Listen sind möglich.
        </p>
        {#if errors.answer}<p
            id="faq-answer-error"
            class="mt-1 text-sm text-[var(--color-dpsg-red)]"
          >
            {errors.answer}
          </p>{/if}
      </div>
    </fieldset>
  {/if}

  {#snippet actions()}
    {#if form?.id}
      {#if confirmDelete}
        <div class="space-y-2">
          <p class="text-sm text-neutral-700">Die Frage auch aus der öffentlichen FAQ löschen?</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn-danger" disabled={busy} onclick={remove}
              >Ja, löschen</button
            >
            <button
              type="button"
              class="btn-secondary"
              disabled={busy}
              onclick={() => (confirmDelete = false)}>Behalten</button
            >
          </div>
        </div>
      {:else}
        <button
          type="button"
          class="btn-danger"
          disabled={busy}
          onclick={() => (confirmDelete = true)}>Löschen</button
        >
      {/if}
    {/if}
  {/snippet}
</EditDialog>
