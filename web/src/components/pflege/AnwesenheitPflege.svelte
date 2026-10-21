<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { confirmAction } from '../../lib/confirm';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { fetchApi } from '../../lib/api';
  import { suggestedDate } from '../../lib/anwesenheit';
  import { anwesenheitOverview } from '../../lib/pflegeStore.svelte';
  import type { AnwesenheitMeeting, AnwesenheitOverview } from '../../lib/types';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import AnwesenheitTermin from './AnwesenheitTermin.svelte';
  import AnwesenheitVerlauf from './AnwesenheitVerlauf.svelte';
  import FormField from './FormField.svelte';

  type View = 'erfassen' | 'verlauf';

  // Kept across pages: a revisit shows the last loaded Termine at once while they load again
  const store = anwesenheitOverview.state;
  const overview = $derived(store.data);
  let view = $state<View>('erfassen');
  let slug = $state('');
  let date = $state('');
  let dirty = $state(false);
  onMount(() => guardUnsavedChanges(() => dirty));
  async function mayChange(): Promise<boolean> {
    if (!dirty) return true;
    const discard = await confirmAction({
      title: 'Ungespeicherte Eingaben verwerfen?',
      message:
        'Die Notiz oder der Gastname ist noch nicht gespeichert. Möchtest du den Termin trotzdem wechseln?',
      confirmLabel: 'Eingaben verwerfen',
      cancelLabel: 'Weiter bearbeiten',
    });
    if (discard) dirty = false;
    return discard;
  }

  const selected = $derived(overview?.stufen.find((s) => s.slug === slug));
  const loaded = $derived(overview && selected ? { overview, selected } : null);

  /** Selects the own Stufe (or the first one) once the Stufen are there. */
  function selectInitialStufe(): void {
    const data = store.data;
    if (slug || !data) return;
    const own = data.stufen.find((s) => data.ownStufen.includes(s.stufe));
    void selectStufe((own ?? data.stufen[0]).slug);
  }

  async function loadOverview(): Promise<void> {
    selectInitialStufe();
    const before = store.data;
    await anwesenheitOverview.load({ force: true });
    const fresh = store.data;
    const stufe = fresh?.stufen.find((s) => s.slug === slug);
    if (!stufe) {
      // Nothing shown yet, or the Stufe shown from the last visit is gone
      slug = '';
      selectInitialStufe();
      return;
    }
    // A day passed since the last visit: the suggested date moves along, unless it was changed
    if (
      before &&
      fresh &&
      fresh.today !== before.today &&
      !dirty &&
      date === suggestedDate(stufe.weekday, before.today)
    ) {
      date = suggestedDate(stufe.weekday, fresh.today);
    }
  }

  async function selectStufe(next: string): Promise<void> {
    if (next === slug || !(await mayChange())) return;
    slug = next;
    const stufe = overview?.stufen.find((s) => s.slug === next);
    date = suggestedDate(stufe?.weekday ?? '', overview?.today ?? date);
  }

  /** Loads the recorded Termine again; the ones loaded before stay visible on failure. */
  async function refreshOverview(): Promise<void> {
    try {
      store.data = await fetchApi<AnwesenheitOverview>('/intern/anwesenheit');
    } catch {
      // The statistics loaded before stay visible
    }
  }

  function updateMeeting(meeting: AnwesenheitMeeting): void {
    if (!overview) return;
    store.data = {
      ...overview,
      meetings: overview.meetings.map((previous) =>
        previous.stufe === meeting.stufe && previous.date === meeting.date ? meeting : previous
      ),
    };
  }

  /** Removes a deleted Termin at once, also if loading the Termine again fails. */
  function removeMeeting(stufe: string, date: string): void {
    if (overview) {
      store.data = {
        ...overview,
        meetings: overview.meetings.filter((m) => m.stufe !== stufe || m.date !== date),
      };
    }
    void refreshOverview();
  }

  /** Shows a view; the statistics are loaded again, as the Termin may have changed. */
  async function showView(next: View): Promise<void> {
    if (next === view || !(await mayChange())) return;
    view = next;
    if (next === 'verlauf') await refreshOverview();
  }

  async function changeDate(value: string): Promise<void> {
    if (!overview || !value || value === date || value > overview.today || !(await mayChange()))
      return;
    date = value;
  }

  $effect(() => {
    untrack(() => void loadOverview());
  });
</script>

<LoadState
  data={loaded}
  loading={store.loading || (store.data !== null && !loaded)}
  error={store.error}
  loadingText="Wird geladen …"
  onretry={() => void loadOverview()}
>
  {#snippet skeleton()}
    <p aria-hidden="true" class="text-sm text-neutral-700">Wird geladen …</p>
  {/snippet}
  {#snippet children({ overview, selected })}
    <div class="space-y-6">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <FilterTabs
          label="Stufe"
          showLabel
          options={overview.stufen.map((s) => ({ value: s.slug, label: s.stufe }))}
          value={slug}
          onselect={selectStufe}
        />
        <FilterTabs
          label="Ansicht"
          variant="segmented"
          showLabel
          options={[
            { value: 'erfassen', label: 'Erfassen' },
            { value: 'verlauf', label: 'Verlauf & Statistik' },
          ]}
          value={view}
          onselect={showView}
        />
      </div>

      {#if view === 'erfassen'}
        <div class="flex flex-wrap items-end gap-4">
          <FormField
            id="anwesenheit-datum"
            label="Datum"
            hint={selected.weekday
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
                onchange={async (event) => {
                  const input = event.currentTarget;
                  await changeDate(input.value);
                  input.value = date;
                }}
              />
            {/snippet}
          </FormField>
        </div>

        <AnwesenheitTermin
          stufe={selected.stufe}
          slug={selected.slug}
          {date}
          ondirty={(value) => (dirty = value)}
        />
      {:else}
        {#key selected.slug}
          <AnwesenheitVerlauf
            stufe={selected.stufe}
            slug={selected.slug}
            meetings={overview.meetings}
            onload={updateMeeting}
            onselect={(selectedDate) => {
              changeDate(selectedDate);
              view = 'erfassen';
            }}
            ondelete={(deleted) => removeMeeting(selected.stufe, deleted)}
          />
        {/key}
      {/if}
    </div>
  {/snippet}
</LoadState>
