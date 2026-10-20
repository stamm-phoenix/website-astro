<script lang="ts">
  import { untrack } from 'svelte';
  import { ApiError, errorMessage, fetchApi, sendApi } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import type {
    AnwesenheitChild,
    AnwesenheitGuest,
    AnwesenheitStatus,
    AnwesenheitTermin,
  } from '../../lib/types';
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import FormField from './FormField.svelte';
  import StatusNotice from './StatusNotice.svelte';

  interface Props {
    stufe: string;
    slug: string;
    date: string;
  }
  let { stufe, slug, date }: Props = $props();

  const STATUS_OPTIONS: {
    value: AnwesenheitStatus;
    label: string;
    tone: 'success' | 'warning' | 'neutral';
  }[] = [
    { value: 'anwesend', label: 'Anwesend', tone: 'success' },
    { value: 'entschuldigt', label: 'Entschuldigt', tone: 'warning' },
    { value: 'abwesend', label: 'Abwesend', tone: 'neutral' },
  ];

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
  let savingCancelled = $state(false);
  let guestName = $state('');
  let addingGuest = $state(false);
  let busy = $state<string[]>([]);
  let message = $state<string | null>(null);
  let messageKind = $state<'success' | 'error'>('success');
  /** Briefly confirms next to the count that the last choice was saved. */
  let tickSaved = $state(false);
  let tickSavedTimer: ReturnType<typeof setTimeout> | undefined;
  let terminRequest: AbortController | null = null;

  const path = $derived(`/anwesenheit/${slug}/${date}`);
  const memberCount = $derived(
    termin
      ? termin.children.filter((child) => child.status === 'anwesend').length + termin.anonymized
      : 0
  );
  const excusedCount = $derived(
    termin
      ? termin.children.filter((child) => child.status === 'entschuldigt').length +
          termin.anonymizedExcused
      : 0
  );
  const guestCount = $derived(termin ? termin.guests.length + termin.anonymizedGuests : 0);
  const ownStufe = $derived(termin?.children.filter((child) => child.kind === 'stufe') ?? []);
  const absentCount = $derived(ownStufe.filter((child) => child.status === 'abwesend').length);
  /** What is recorded, which a cancellation would delete. */
  const recordedLabel = $derived(
    [
      `${memberCount} anwesend`,
      `${excusedCount} entschuldigt`,
      ...(guestCount > 0 ? [`${guestCount} ${guestCount === 1 ? 'Gast' : 'Gäste'}`] : []),
    ].join(', ')
  );
  /** Everybody of the Stufe, so it shows at once who is still missing. */
  const countParts = $derived([
    `${memberCount} anwesend`,
    `${excusedCount} entschuldigt`,
    ...(termin?.editable ? [`${absentCount} abwesend`] : []),
    ...(guestCount > 0 ? [`${guestCount} ${guestCount === 1 ? 'Gast' : 'Gäste'}`] : []),
  ]);
  const visitors = $derived(termin?.children.filter((child) => child.kind !== 'stufe') ?? []);
  const notesChanged = $derived(termin !== null && notes.trim() !== termin.notes);

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
    // Unsaved notes of the same Termin survive the reload, e.g. after a failed choice
    const previous = termin;
    const draft = previous && notes.trim() !== previous.notes ? notes : null;
    loading = true;
    loadError = null;
    message = null;
    try {
      const loaded = await fetchApi<AnwesenheitTermin>(`/intern${path}`, request.signal);
      // Notes changed by someone else keep the old version, so saving the draft conflicts
      if (previous && draft !== null && loaded.notes !== previous.notes) {
        loaded.etag = previous.etag;
      }
      termin = loaded;
      notes = draft ?? loaded.notes;
    } catch (error: unknown) {
      if (request.signal.aborted) return;
      termin = null;
      loadError = errorMessage(
        error,
        'Der Termin konnte nicht geladen werden. Prüfe deine Internetverbindung und tippe auf „Erneut versuchen“.'
      );
    } finally {
      if (terminRequest === request) loading = false;
    }
  }

  async function setStatus(child: AnwesenheitChild, status: AnwesenheitStatus): Promise<void> {
    if (!termin?.editable || savingCancelled || busy.includes(child.id) || child.status === status)
      return;
    child.status = status;
    busy = [...busy, child.id];
    tickSaved = false;
    try {
      const url = `/intern/pflege${path}/kinder/${child.id}`;
      if (status === 'abwesend') await sendApi('DELETE', url);
      else await sendApi('PUT', url, { status });
      tickSaved = true;
      clearTimeout(tickSavedTimer);
      tickSavedTimer = setTimeout(() => (tickSaved = false), 3000);
    } catch (error: unknown) {
      // An earlier tick's confirmation must not stand next to this failure
      clearTimeout(tickSavedTimer);
      tickSaved = false;
      // Show what is saved instead of guessing
      void load();
      const name = child.kind === 'unbekannt' ? 'diesem Kind' : child.firstName;
      show(
        errorMessage(
          error,
          `Die Anwesenheit von ${name} wurde nicht gespeichert. Tippe noch einmal auf deine Auswahl.`
        ),
        'error'
      );
    } finally {
      busy = busy.filter((id) => id !== child.id);
    }
  }

  /**
   * Marks the Gruppenstunde as cancelled or as held. Cancelling removes the attendance, so it
   * asks first when anything is recorded.
   */
  async function setCancelled(cancelled: boolean): Promise<void> {
    const target = termin;
    if (!target?.editable || target.cancelled === cancelled || savingCancelled) return;
    const recorded = memberCount + excusedCount + guestCount;
    if (
      cancelled &&
      recorded > 0 &&
      !(await confirmAction({
        title: `Gruppenstunde ${stufe} als ausgefallen markieren?`,
        message: `Die Einträge werden dabei gelöscht (${recordedLabel}). Der Text bleibt.`,
        confirmLabel: 'Als ausgefallen markieren',
      }))
    ) {
      return;
    }
    savingCancelled = true;
    try {
      const saved = await sendApi<{ etag: string }>('PUT', `/intern/pflege${path}/ausgefallen`, {
        cancelled,
        etag: target.etag,
        entries: recorded,
      });
      target.etag = saved.etag;
      target.cancelled = cancelled;
      if (cancelled) {
        target.children = target.children
          .filter((child) => child.kind === 'stufe')
          .map((child) => ({ ...child, status: 'abwesend' }));
        target.guests = [];
      }
      show(
        cancelled
          ? 'Gruppenstunde als ausgefallen markiert.'
          : 'Gruppenstunde als stattgefunden markiert. Du kannst jetzt eintragen, wer da war.'
      );
    } catch (error: unknown) {
      const conflict = error instanceof ApiError && [409, 412].includes(error.status);
      show(
        conflict
          ? 'Jemand anderes hat diese Gruppenstunde inzwischen geändert. „Ausgefallen“ wurde nicht gespeichert. Dein Text steht noch im Feld. Kopiere ihn, lade die Seite neu und wähle dann noch einmal.'
          : errorMessage(
              error,
              'Die Angabe „Ausgefallen“ wurde nicht gespeichert. Tippe noch einmal auf deine Auswahl.'
            ),
        'error'
      );
    } finally {
      savingCancelled = false;
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
      if (error instanceof ApiError && error.fields?.cancelled) {
        // Retrying cannot help; show the Termin as it is now (loading clears the message first)
        await load();
        show(
          `${name} wurde nicht als Gast eingetragen, weil jemand anderes die Gruppenstunde inzwischen als ausgefallen markiert hat. Nimm „Ausgefallen“ zurück, wenn sie doch stattgefunden hat, und trage ${name} dann noch einmal ein.`,
          'error'
        );
      } else {
        show(
          errorMessage(
            error,
            `${name} wurde nicht als Gast eingetragen. Der Name steht noch im Feld. Tippe noch einmal auf „Eintragen“.`
          ),
          'error'
        );
      }
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
      show(
        errorMessage(
          error,
          `${guest.name} wurde nicht entfernt. Tippe noch einmal auf „Entfernen“.`
        ),
        'error'
      );
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
      show('Notiz gespeichert.');
    } catch (error: unknown) {
      const conflict = error instanceof ApiError && [409, 412].includes(error.status);
      show(
        conflict
          ? 'Jemand anderes hat die Notiz inzwischen geändert. Dein Text steht noch im Feld. Kopiere ihn, lade die Seite neu und füge ihn wieder ein.'
          : errorMessage(
              error,
              'Die Notiz wurde nicht gespeichert. Dein Text steht noch im Feld. Tippe noch einmal auf „Notiz speichern“.'
            ),
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

{#snippet childRow(child: AnwesenheitChild)}
  {@const name =
    child.kind === 'unbekannt' ? 'Nicht mehr in CampFlow' : `${child.firstName} ${child.lastName}`}
  <li class="child" data-status={child.status}>
    <span class="child-name">{name}</span>
    <FilterTabs
      label="Anwesenheit von {name}"
      variant="segmented"
      options={STATUS_OPTIONS}
      value={child.status}
      disabled={!termin?.editable || savingCancelled || busy.includes(child.id)}
      onselect={(status) => setStatus(child, status)}
    />
  </li>
{/snippet}

<StatusNotice {message} kind={messageKind} popup />

<LoadState
  data={termin}
  {loading}
  error={loadError}
  loadingText="Wird geladen …"
  onretry={() => void load()}
>
  {#snippet skeleton()}
    <p aria-hidden="true" class="text-sm text-neutral-700">Wird geladen …</p>
  {/snippet}
  {#snippet children(termin)}
    <section aria-labelledby="anwesenheit-termin" class="space-y-6" aria-busy={loading}>
      <div>
        <h2 id="anwesenheit-termin" class="font-serif text-2xl text-brand-900">
          {stufe} am {formatDate(termin.date)}
        </h2>
        {#if termin.editable}
          <p class="mt-1 text-sm text-neutral-700">Jede Auswahl wird sofort gespeichert.</p>
        {/if}
        <p
          class="mt-2 text-base font-semibold text-brand-900"
          aria-live="polite"
          data-testid="anwesenheit-counts"
        >
          {#if termin.cancelled}
            Die Gruppenstunde ist ausgefallen.
          {:else}
            {#each countParts as part, index (part)}<span class="whitespace-nowrap">{part}</span
              >{index < countParts.length - 1 ? ', ' : ''}{/each}
          {/if}
          {#if busy.length > 0}
            <span class="ml-2">Wird gespeichert …</span>
          {:else if tickSaved}
            <span class="ml-2 font-semibold text-success">Gespeichert</span>
          {/if}
        </p>
        {#if !termin.editable}
          <p class="mt-2 text-sm text-neutral-700">
            Dieser Termin liegt vor der Aufbewahrungsfrist. Die Namen sind gelöscht, er lässt sich
            nur noch ansehen.
          </p>
        {/if}
      </div>

      {#if termin.editable || termin.cancelled}
        <div class="surface-muted space-y-2 p-3">
          <FilterTabs
            label="Gruppenstunde"
            showLabel
            variant="segmented"
            options={[
              { value: 'statt', label: 'Fand statt', tone: 'success' },
              { value: 'ausgefallen', label: 'Ausgefallen', tone: 'warning' },
            ]}
            value={termin.cancelled ? 'ausgefallen' : 'statt'}
            disabled={!termin.editable || savingCancelled}
            onselect={(value) => setCancelled(value === 'ausgefallen')}
          />
          {#if termin.editable}
            <p class="text-sm text-neutral-700">
              {termin.cancelled
                ? 'Mit „Fand statt“ kannst du wieder eintragen, wer da war.'
                : 'Fällt die Gruppenstunde aus, wähle „Ausgefallen“. Die Einträge darunter werden dann gelöscht.'}
            </p>
          {/if}
        </div>
      {/if}

      {#if !termin.cancelled}
        {#if ownStufe.length > 0}
          <ul class="child-list" aria-label="Kinder der Stufe">
            {#each ownStufe as child (child.id)}
              {@render childRow(child)}
            {/each}
          </ul>
        {:else if termin.editable}
          <p class="text-sm text-neutral-700">In CampFlow stehen keine Kinder in dieser Stufe.</p>
        {/if}

        {#if visitors.length > 0}
          <div>
            <h3 class="font-semibold text-brand-900">Aus anderen Stufen</h3>
            <ul class="child-list mt-2" aria-label="Kinder aus anderen Stufen">
              {#each visitors as child (child.id)}
                {@render childRow(child)}
              {/each}
            </ul>
          </div>
        {/if}

        {#if termin.anonymized > 0 || termin.anonymizedExcused > 0}
          <p class="text-sm text-neutral-700">
            Nach der Aufbewahrungsfrist sind die Namen gelöscht. Erhalten ist: {termin.anonymized}
            {termin.anonymized === 1 ? 'Kind war' : 'Kinder waren'} da, {termin.anonymizedExcused}
            entschuldigt.
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
      {/if}

      <form class="space-y-3" onsubmit={saveNotes}>
        <FormField
          id="anwesenheit-inhalt"
          label={termin.cancelled ? 'Warum ist sie ausgefallen?' : 'Was habt ihr gemacht?'}
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
            Notiz speichern
          </ActionButton>
        {/if}
      </form>
    </section>
  {/snippet}
</LoadState>

<style>
  .child-list {
    display: grid;
    gap: 0 1.5rem;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr));
  }
  .child {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.25rem 0.75rem;
    border-bottom: 1px solid var(--color-neutral-200);
    padding: 0.5rem 0;
  }
  .child-name {
    color: var(--color-brand-900);
  }
  .child[data-status='anwesend'] .child-name {
    font-weight: 600;
  }
</style>
