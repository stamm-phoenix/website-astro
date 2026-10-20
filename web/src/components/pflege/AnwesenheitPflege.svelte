<script lang="ts">
  import { untrack } from 'svelte';
  import { errorMessage, fetchApi } from '../../lib/api';
  import { suggestedDate } from '../../lib/anwesenheit';
  import type { AnwesenheitMeeting, AnwesenheitOverview } from '../../lib/types';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import AnwesenheitTermin from './AnwesenheitTermin.svelte';
  import AnwesenheitVerlauf from './AnwesenheitVerlauf.svelte';
  import FormField from './FormField.svelte';

  type View = 'erfassen' | 'verlauf';

  let overview = $state.raw<AnwesenheitOverview | null>(null);
  let overviewError = $state<string | null>(null);
  let view = $state<View>('erfassen');
  let slug = $state('');
  let date = $state('');

  const selected = $derived(overview?.stufen.find((s) => s.slug === slug));
  const loaded = $derived(overview && selected ? { overview, selected } : null);

  async function loadOverview(): Promise<void> {
    overviewError = null;
    try {
      const loaded = await fetchApi<AnwesenheitOverview>('/intern/anwesenheit');
      overview = loaded;
      const own = loaded.stufen.find((s) => loaded.ownStufen.includes(s.stufe));
      selectStufe((own ?? loaded.stufen[0]).slug);
    } catch (error: unknown) {
      overviewError = errorMessage(
        error,
        'Die Anwesenheit konnte nicht geladen werden. Prüfe deine Internetverbindung und lade die Seite neu.'
      );
    }
  }

  function selectStufe(next: string): void {
    slug = next;
    const stufe = overview?.stufen.find((s) => s.slug === next);
    date = suggestedDate(stufe?.weekday ?? '', overview?.today ?? date);
  }

  /** Loads the recorded Termine again; the ones loaded before stay visible on failure. */
  async function refreshOverview(): Promise<void> {
    try {
      overview = await fetchApi<AnwesenheitOverview>('/intern/anwesenheit');
    } catch {
      // The statistics loaded before stay visible
    }
  }

  function updateMeeting(meeting: AnwesenheitMeeting): void {
    if (!overview) return;
    overview = {
      ...overview,
      meetings: overview.meetings.map((previous) =>
        previous.stufe === meeting.stufe && previous.date === meeting.date ? meeting : previous
      ),
    };
  }

  /** Removes a deleted Termin at once, also if loading the Termine again fails. */
  function removeMeeting(stufe: string, date: string): void {
    if (overview) {
      overview = {
        ...overview,
        meetings: overview.meetings.filter((m) => m.stufe !== stufe || m.date !== date),
      };
    }
    void refreshOverview();
  }

  /** Shows a view; the statistics are loaded again, as the Termin may have changed. */
  async function showView(next: View): Promise<void> {
    view = next;
    if (next === 'verlauf') await refreshOverview();
  }

  function changeDate(value: string): void {
    if (!overview || !value || value > overview.today) return;
    date = value;
  }

  $effect(() => {
    untrack(() => void loadOverview());
  });
</script>

<LoadState
  data={loaded}
  loading={!loaded && !overviewError}
  error={overviewError}
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
                onchange={(event) => changeDate(event.currentTarget.value)}
              />
            {/snippet}
          </FormField>
        </div>

        <AnwesenheitTermin stufe={selected.stufe} slug={selected.slug} {date} />
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
