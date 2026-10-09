<script lang="ts">
  import { untrack } from 'svelte';
  import { ApiError, fetchApi, sendApi } from '../../lib/api';
  import type { AnwesenheitChild, AnwesenheitGuest, AnwesenheitTermin } from '../../lib/types';
  import ActionButton from '../ui/ActionButton.svelte';
  import FormField from './FormField.svelte';
  import StatusNotice from './StatusNotice.svelte';

  interface Props {
    stufe: string;
    slug: string;
    date: string;
  }
  let { stufe, slug, date }: Props = $props();

  const DATE_LABEL = new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  let termin = $state<AnwesenheitTermin | null>(null);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let notes = $state('');
  let savingNotes = $state(false);
  let guestName = $state('');
  let addingGuest = $state(false);
  let busy = $state<string[]>([]);
  let message = $state<string | null>(null);
  let messageKind = $state<'success' | 'error'>('success');
  let terminRequest: AbortController | null = null;

  const path = $derived(`/anwesenheit/${slug}/${date}`);
  const memberCount = $derived(
    termin ? termin.children.filter((child) => child.present).length + termin.anonymized : 0
  );
  const guestCount = $derived(termin ? termin.guests.length + termin.anonymizedGuests : 0);
  const countLabel = $derived(
    `${memberCount} ${memberCount === 1 ? 'Kind' : 'Kinder'} da` +
      (guestCount > 0 ? `, dazu ${guestCount} ${guestCount === 1 ? 'Gast' : 'Gäste'}` : '') +
      '.'
  );
  const ownStufe = $derived(termin?.children.filter((child) => child.kind === 'stufe') ?? []);
  const visitors = $derived(termin?.children.filter((child) => child.kind !== 'stufe') ?? []);
  const notesChanged = $derived(termin !== null && notes.trim() !== termin.notes);

  function messageOf(error: unknown, fallback: string): string {
    return error instanceof ApiError ? error.message : fallback;
  }

  function show(text: string, kind: 'success' | 'error' = 'success'): void {
    message = text;
    messageKind = kind;
  }

  function formatDate(value: string): string {
    return DATE_LABEL.format(new Date(`${value}T00:00:00Z`));
  }

  async function load(): Promise<void> {
    terminRequest?.abort();
    const request = new AbortController();
    terminRequest = request;
    // Controls of another Termin would already write to the new path
    if (termin && (termin.date !== date || termin.stufe !== stufe)) termin = null;
    loading = true;
    loadError = null;
    message = null;
    try {
      const loaded = await fetchApi<AnwesenheitTermin>(`/intern${path}`, request.signal);
      termin = loaded;
      notes = loaded.notes;
    } catch (error: unknown) {
      if (request.signal.aborted) return;
      termin = null;
      loadError = messageOf(error, 'Der Termin konnte nicht geladen werden.');
    } finally {
      if (terminRequest === request) loading = false;
    }
  }

  async function toggle(child: AnwesenheitChild): Promise<void> {
    if (!termin?.editable || busy.includes(child.id)) return;
    child.present = !child.present;
    busy = [...busy, child.id];
    try {
      await sendApi(child.present ? 'PUT' : 'DELETE', `/intern/pflege${path}/kinder/${child.id}`);
    } catch (error: unknown) {
      // Show what is saved instead of guessing
      void load();
      show(messageOf(error, 'Die Anwesenheit konnte nicht gespeichert werden.'), 'error');
    } finally {
      busy = busy.filter((id) => id !== child.id);
    }
  }

  async function addGuest(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const name = guestName.trim();
    const target = termin;
    if (!target || !name) return;
    addingGuest = true;
    try {
      const guest = await sendApi<AnwesenheitGuest>('POST', `/intern/pflege${path}/gaeste`, {
        name,
      });
      // `target` stays the Termin of the request, also if another one was opened meanwhile
      target.guests.push(guest);
      if (target === termin) guestName = '';
      show(`${guest.name} ist als Gast eingetragen.`);
    } catch (error: unknown) {
      show(messageOf(error, 'Der Gast konnte nicht eingetragen werden.'), 'error');
    } finally {
      addingGuest = false;
    }
  }

  async function removeGuest(guest: AnwesenheitGuest): Promise<void> {
    const target = termin;
    if (!target) return;
    try {
      await sendApi('DELETE', `/intern/pflege${path}/gaeste/${guest.id}`);
      target.guests = target.guests.filter((g) => g.id !== guest.id);
      show(`${guest.name} ist nicht mehr eingetragen.`);
    } catch (error: unknown) {
      show(messageOf(error, 'Der Gast konnte nicht entfernt werden.'), 'error');
    }
  }

  async function saveNotes(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const target = termin;
    if (!target) return;
    const text = notes.trim();
    savingNotes = true;
    try {
      const saved = await sendApi<{ etag: string }>('PUT', `/intern/pflege${path}`, {
        notes: text,
        etag: target.etag,
      });
      target.etag = saved.etag;
      target.notes = text;
      if (target === termin) notes = text;
      show('Der Inhalt ist gespeichert.');
    } catch (error: unknown) {
      const conflict = error instanceof ApiError && [409, 412].includes(error.status);
      show(
        conflict
          ? 'Jemand anderes hat den Inhalt inzwischen geändert. Bitte neu laden und erneut eintragen.'
          : messageOf(error, 'Der Inhalt konnte nicht gespeichert werden.'),
        'error'
      );
    } finally {
      savingNotes = false;
    }
  }

  // Loads the Termin whenever the Stufe or the date changes
  $effect(() => {
    void path;
    untrack(() => void load());
  });
</script>

{#snippet childButton(child: AnwesenheitChild)}
  <li>
    <button
      type="button"
      class="child"
      aria-pressed={child.present}
      disabled={!termin?.editable || busy.includes(child.id)}
      onclick={() => toggle(child)}
    >
      <span class="mark" aria-hidden="true">{child.present ? '✓' : ''}</span>
      <span>
        {child.kind === 'unbekannt'
          ? 'Nicht mehr in CampFlow'
          : `${child.firstName} ${child.lastName}`}
      </span>
    </button>
  </li>
{/snippet}

<StatusNotice {message} kind={messageKind} popup />

{#if loading && !termin}
  <p role="status" aria-live="polite" class="text-sm text-neutral-700">Wird geladen …</p>
{:else if loadError}
  <div class="space-y-3">
    <p class="text-sm font-semibold text-danger" role="alert">{loadError}</p>
    <ActionButton onclick={load}>Erneut laden</ActionButton>
  </div>
{:else if termin}
  <section aria-labelledby="anwesenheit-termin" class="space-y-6" aria-busy={loading}>
    <div>
      <h2 id="anwesenheit-termin" class="font-serif text-2xl text-brand-900">
        {stufe} am {formatDate(termin.date)}
      </h2>
      <p class="mt-1 text-sm text-neutral-700" aria-live="polite">{countLabel}</p>
      {#if !termin.editable}
        <p class="mt-2 text-sm text-neutral-700">
          Dieser Termin liegt vor der Aufbewahrungsfrist. Die Namen sind gelöscht, er lässt sich nur
          noch ansehen.
        </p>
      {/if}
    </div>

    {#if ownStufe.length > 0}
      <ul class="child-grid" aria-label="Kinder der Stufe">
        {#each ownStufe as child (child.id)}
          {@render childButton(child)}
        {/each}
      </ul>
    {:else if termin.editable}
      <p class="text-sm text-neutral-700">In CampFlow stehen keine Kinder in dieser Stufe.</p>
    {/if}

    {#if visitors.length > 0}
      <div>
        <h3 class="font-semibold text-brand-900">Aus anderen Stufen</h3>
        <ul class="child-grid mt-2" aria-label="Kinder aus anderen Stufen">
          {#each visitors as child (child.id)}
            {@render childButton(child)}
          {/each}
        </ul>
      </div>
    {/if}

    {#if termin.anonymized > 0}
      <p class="text-sm text-neutral-700">
        {termin.anonymized}
        {termin.anonymized === 1 ? 'Kind war' : 'Kinder waren'} da, deren Namen nach der Aufbewahrungsfrist
        gelöscht sind.
      </p>
    {/if}

    <div>
      <h3 class="font-semibold text-brand-900">Gäste</h3>
      {#if termin.guests.length > 0 || termin.anonymizedGuests > 0}
        <ul class="mt-2 divide-y divide-neutral-200 border-y border-neutral-200">
          {#each termin.guests as guest (guest.id)}
            <li class="flex items-center justify-between gap-3 py-2">
              <span>{guest.name}</span>
              {#if termin.editable}
                <ActionButton
                  variant="danger"
                  aria-label="{guest.name} entfernen"
                  onclick={() => removeGuest(guest)}>Entfernen</ActionButton
                >
              {/if}
            </li>
          {/each}
          {#if termin.anonymizedGuests > 0}
            <li class="py-2 text-sm text-neutral-700">
              {termin.anonymizedGuests}
              {termin.anonymizedGuests === 1 ? 'Gast' : 'Gäste'} ohne Namen
            </li>
          {/if}
        </ul>
      {:else}
        <p class="mt-1 text-sm text-neutral-700">Keine Gäste.</p>
      {/if}
      {#if termin.editable}
        <form class="mt-3 flex flex-wrap items-end gap-3" onsubmit={addGuest}>
          <FormField
            id="anwesenheit-gast"
            label="Gast hinzufügen"
            hint="Kinder, die nicht in CampFlow stehen, z. B. zum Schnuppern."
            class="min-w-0 flex-1"
          >
            {#snippet children(attrs)}
              <input
                {...attrs}
                class="form-input"
                maxlength="100"
                autocomplete="off"
                bind:value={guestName}
              />
            {/snippet}
          </FormField>
          <ActionButton type="submit" disabled={addingGuest || !guestName.trim()}>
            Eintragen
          </ActionButton>
        </form>
      {/if}
    </div>

    <form class="space-y-3" onsubmit={saveNotes}>
      <FormField
        id="anwesenheit-inhalt"
        label="Was habt ihr gemacht?"
        hint="Ohne Namen von Kindern."
        optional
      >
        {#snippet children(attrs)}
          <textarea
            {...attrs}
            class="form-input"
            rows="3"
            maxlength="2000"
            readonly={!termin!.editable}
            bind:value={notes}></textarea>
        {/snippet}
      </FormField>
      {#if termin.editable}
        <ActionButton type="submit" variant="primary" disabled={savingNotes || !notesChanged}>
          Inhalt speichern
        </ActionButton>
      {/if}
    </form>
  </section>
{/if}

<style>
  .child-grid {
    display: grid;
    gap: 0.5rem;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 12rem), 1fr));
  }
  .child {
    display: flex;
    width: 100%;
    min-height: 3rem;
    align-items: center;
    gap: 0.75rem;
    border: 1px solid var(--color-neutral-300);
    padding: 0.5rem 0.75rem;
    text-align: left;
    color: var(--color-brand-900);
  }
  .child[aria-pressed='true'] {
    border-color: var(--color-success);
    font-weight: 600;
  }
  .child:disabled {
    cursor: default;
  }
  .mark {
    display: inline-flex;
    width: 1.5rem;
    height: 1.5rem;
    flex: none;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--color-neutral-300);
    color: var(--color-success);
  }
  .child[aria-pressed='true'] .mark {
    border-color: var(--color-success);
  }
</style>
