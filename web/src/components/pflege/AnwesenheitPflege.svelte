<script lang="ts">
  import { untrack } from 'svelte';
  import { ApiError, fetchApi } from '../../lib/api';
  import { suggestedDate } from '../../lib/anwesenheit';
  import type { AnwesenheitOverview } from '../../lib/types';
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
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

  async function loadOverview(): Promise<void> {
    overviewError = null;
    try {
      const loaded = await fetchApi<AnwesenheitOverview>('/intern/anwesenheit');
      overview = loaded;
      const own = loaded.stufen.find((s) => loaded.ownStufen.includes(s.stufe));
      selectStufe((own ?? loaded.stufen[0]).slug);
    } catch (error: unknown) {
      overviewError =
        error instanceof ApiError ? error.message : 'Die Anwesenheit konnte nicht geladen werden.';
    }
  }

  function selectStufe(next: string): void {
    slug = next;
    const stufe = overview?.stufen.find((s) => s.slug === next);
    date = suggestedDate(stufe?.weekday ?? '', overview?.today ?? date);
  }

  function changeDate(value: string): void {
    if (!overview || !value || value > overview.today) return;
    date = value;
  }

  $effect(() => {
    untrack(() => void loadOverview());
  });
</script>

{#if overviewError}
  <div class="space-y-3">
    <p class="text-sm font-semibold text-danger" role="alert">{overviewError}</p>
    <ActionButton onclick={loadOverview}>Erneut laden</ActionButton>
  </div>
{:else if !overview || !selected}
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
      <AnwesenheitVerlauf stufe={selected.stufe} meetings={overview.meetings} />
    {/if}
  </div>
{/if}
