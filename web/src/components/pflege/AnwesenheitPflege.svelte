<script lang="ts">
  import { untrack } from 'svelte';
  import { ApiError, fetchApi, sendApi } from '../../lib/api';
  import { monthlyStats, suggestedDate } from '../../lib/anwesenheit';
  import type {
    AnwesenheitChild,
    AnwesenheitGuest,
    AnwesenheitOverview,
    AnwesenheitTermin,
  } from '../../lib/types';
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import FormField from './FormField.svelte';
  import StatusNotice from './StatusNotice.svelte';

  type View = 'erfassen' | 'verlauf';

  const DATE_LABEL = new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const MONTH_LABEL = new Intl.DateTimeFormat('de-DE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  let overview = $state.raw<AnwesenheitOverview | null>(null);
  let overviewError = $state<string | null>(null);
  let view = $state<View>('erfassen');
  let slug = $state('');
  let date = $state('');
  let termin = $state<AnwesenheitTermin | null>(null);
  let terminLoading = $state(false);
  let terminError = $state<string | null>(null);
  let notes = $state('');
  let savingNotes = $state(false);
  let guestName = $state('');
  let addingGuest = $state(false);
  let busy = $state<string[]>([]);
  let message = $state<string | null>(null);
  let messageKind = $state<'success' | 'error'>('success');
  let terminRequest: AbortController | null = null;

  const selected = $derived(overview?.stufen.find((s) => s.slug === slug));
  const memberCount = $derived(
    termin ? termin.children.filter((child) => child.present).length + termin.anonymized : 0
  );
  const guestCount = $derived(termin ? termin.guests.length + termin.anonymizedGuests : 0);
  const countLabel = $derived(
    `${memberCount} ${memberCount === 1 ? 'Kind' : 'Kinder'} da` +
      (guestCount > 0 ? `, dazu ${guestCount} ${guestCount === 1 ? 'Gast' : 'Gäste'}` : '') +
      '.'
  );
  const ownStufe = $derived(termin?.children.filter((child) => !child.otherStufe) ?? []);
  const visitors = $derived(termin?.children.filter((child) => child.otherStufe) ?? []);
  const notesChanged = $derived(termin !== null && notes.trim() !== termin.notes);
  const stats = $derived(overview ? monthlyStats(overview.meetings, selected?.stufe ?? '') : []);

  function messageOf(error: unknown, fallback: string): string {
    return error instanceof ApiError ? error.message : fallback;
  }

  function show(text: string, kind: 'success' | 'error' = 'success'): void {
    message = text;
    messageKind = kind;
  }

  function terminPath(suffix = ''): string {
    return `/anwesenheit/${slug}/${date}${suffix}`;
  }

  function formatDate(value: string): string {
    return DATE_LABEL.format(new Date(`${value}T00:00:00Z`));
  }

  async function loadOverview(): Promise<void> {
    overviewError = null;
    try {
      const loaded = await fetchApi<AnwesenheitOverview>('/intern/anwesenheit');
      overview = loaded;
      const own = loaded.stufen.find((s) => loaded.ownStufen.includes(s.stufe));
      selectStufe((own ?? loaded.stufen[0]).slug);
    } catch (error: unknown) {
      overviewError = messageOf(error, 'Die Anwesenheit konnte nicht geladen werden.');
    }
  }

  function selectStufe(next: string): void {
    slug = next;
    const stufe = overview?.stufen.find((s) => s.slug === next);
    date = suggestedDate(stufe?.weekday ?? '', overview?.today ?? date);
    void loadTermin();
  }

  async function loadTermin(): Promise<void> {
    terminRequest?.abort();
    const request = new AbortController();
    terminRequest = request;
    terminLoading = true;
    terminError = null;
    message = null;
    try {
      const loaded = await fetchApi<AnwesenheitTermin>(`/intern${terminPath()}`, request.signal);
      termin = loaded;
      notes = loaded.notes;
    } catch (error: unknown) {
      if (request.signal.aborted) return;
      termin = null;
      terminError = messageOf(error, 'Der Termin konnte nicht geladen werden.');
    } finally {
      if (terminRequest === request) terminLoading = false;
    }
  }

  function changeDate(value: string): void {
    if (!overview || !value || value > overview.today) return;
    date = value;
    void loadTermin();
  }

  async function toggle(child: AnwesenheitChild): Promise<void> {
    if (!termin?.editable || busy.includes(child.id)) return;
    const present = !child.present;
    child.present = present;
    busy = [...busy, child.id];
    try {
      await sendApi('PUT', `/intern/pflege${terminPath(`/kinder/${child.id}`)}`, { present });
    } catch (error: unknown) {
      child.present = !present;
      show(messageOf(error, 'Die Anwesenheit konnte nicht gespeichert werden.'), 'error');
    } finally {
      busy = busy.filter((id) => id !== child.id);
    }
  }

  async function addGuest(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const name = guestName.trim();
    if (!termin || !name) return;
    addingGuest = true;
    try {
      const guest = await sendApi<AnwesenheitGuest>(
        'POST',
        `/intern/pflege${terminPath('/gaeste')}`,
        { name }
      );
      termin.guests.push(guest);
      guestName = '';
      show(`${guest.name} ist als Gast eingetragen.`);
    } catch (error: unknown) {
      show(messageOf(error, 'Der Gast konnte nicht eingetragen werden.'), 'error');
    } finally {
      addingGuest = false;
    }
  }

  async function removeGuest(guest: AnwesenheitGuest): Promise<void> {
    if (!termin) return;
    try {
      await sendApi('DELETE', `/intern/pflege${terminPath(`/gaeste/${guest.id}`)}`);
      termin.guests = termin.guests.filter((g) => g.id !== guest.id);
      show(`${guest.name} ist nicht mehr eingetragen.`);
    } catch (error: unknown) {
      show(messageOf(error, 'Der Gast konnte nicht entfernt werden.'), 'error');
    }
  }

  async function saveNotes(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!termin) return;
    savingNotes = true;
    try {
      const saved = await sendApi<{ etag: string }>('PUT', `/intern/pflege${terminPath()}`, {
        notes,
        etag: termin.etag,
      });
      termin.etag = saved.etag;
      termin.notes = notes.trim();
      notes = termin.notes;
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

  $effect(() => {
    untrack(() => void loadOverview());
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
        {child.known ? `${child.firstName} ${child.lastName}` : 'Nicht mehr in CampFlow'}
      </span>
    </button>
  </li>
{/snippet}

{#if overviewError}
  <div class="space-y-3">
    <p class="text-sm font-semibold text-danger" role="alert">{overviewError}</p>
    <ActionButton onclick={loadOverview}>Erneut laden</ActionButton>
  </div>
{:else if !overview}
  <p role="status" aria-live="polite" class="text-sm text-neutral-700">Wird geladen …</p>
{:else}
  <div class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <FilterTabs
        label="Stufe"
        options={overview.stufen.map((s) => ({ value: s.slug, label: s.stufe }))}
        value={slug}
        onselect={selectStufe}
      />
      <FilterTabs
        label="Ansicht"
        options={[
          { value: 'erfassen', label: 'Erfassen' },
          { value: 'verlauf', label: 'Verlauf & Statistik' },
        ]}
        value={view}
        onselect={(next: View) => (view = next)}
      />
    </div>

    {#if view === 'erfassen'}
      <div class="flex flex-wrap items-end gap-4">
        <FormField
          id="anwesenheit-datum"
          label="Datum"
          hint={selected?.weekday
            ? `Gruppenstunde: ${selected.weekday} ${selected.time}`.trim()
            : undefined}
        >
          {#snippet children(attrs)}
            <input
              {...attrs}
              type="date"
              class="form-input"
              max={overview!.today}
              value={date}
              onchange={(event) => changeDate(event.currentTarget.value)}
            />
          {/snippet}
        </FormField>
      </div>

      <StatusNotice {message} kind={messageKind} popup />

      {#if terminLoading && !termin}
        <p role="status" aria-live="polite" class="text-sm text-neutral-700">Wird geladen …</p>
      {:else if terminError}
        <div class="space-y-3">
          <p class="text-sm font-semibold text-danger" role="alert">{terminError}</p>
          <ActionButton onclick={loadTermin}>Erneut laden</ActionButton>
        </div>
      {:else if termin}
        <section aria-labelledby="anwesenheit-termin" class="space-y-6" aria-busy={terminLoading}>
          <div>
            <h2 id="anwesenheit-termin" class="font-serif text-2xl text-brand-900">
              {selected?.stufe} am {formatDate(termin.date)}
            </h2>
            <p class="mt-1 text-sm text-neutral-700" aria-live="polite">{countLabel}</p>
            {#if !termin.editable}
              <p class="mt-2 text-sm text-neutral-700">
                Dieser Termin liegt vor der Aufbewahrungsfrist. Die Namen sind gelöscht, er lässt
                sich nur noch ansehen.
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
    {:else}
      <section aria-labelledby="anwesenheit-verlauf" class="space-y-3">
        <h2 id="anwesenheit-verlauf" class="font-serif text-2xl text-brand-900">
          {selected?.stufe}: Verlauf & Statistik
        </h2>
        {#if stats.length === 0}
          <p class="text-sm text-neutral-700">Für diese Stufe ist noch nichts erfasst.</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="border-b border-neutral-300 text-neutral-700">
                <tr>
                  <th scope="col" class="py-2 pr-4 font-semibold">Monat</th>
                  <th scope="col" class="py-2 pr-4 text-right font-semibold">Termine</th>
                  <th scope="col" class="py-2 pr-4 text-right font-semibold">Kinder im Schnitt</th>
                  <th scope="col" class="py-2 text-right font-semibold">Gäste</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-neutral-200">
                {#each stats as row (row.month)}
                  <tr>
                    <th scope="row" class="py-2 pr-4 font-normal">
                      {MONTH_LABEL.format(new Date(`${row.month}-01T00:00:00Z`))}
                    </th>
                    <td class="py-2 pr-4 text-right tabular-nums">{row.termine}</td>
                    <td class="py-2 pr-4 text-right tabular-nums">
                      {(row.members / row.termine).toLocaleString('de-DE', {
                        maximumFractionDigits: 1,
                      })}
                    </td>
                    <td class="py-2 text-right tabular-nums">{row.guests}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>
    {/if}
  </div>
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
