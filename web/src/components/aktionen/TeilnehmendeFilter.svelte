<script lang="ts">
  import { PERSON_STATUS_LABEL } from '../../lib/campflowFields';
  import type { PersonColumn, PersonStatus } from '../../lib/campflowFields';

  interface Props {
    search: string;
    statuses: PersonStatus[];
    available: PersonColumn[];
    shownColumns: PersonColumn[];
    ontogglecolumn: (key: string) => void;
    onresetcolumns: () => void;
  }

  let {
    search = $bindable(),
    statuses = $bindable(),
    available,
    shownColumns,
    ontogglecolumn,
    onresetcolumns,
  }: Props = $props();

  const STATUS_ORDER: PersonStatus[] = ['confirmed', 'registered', 'cancelled'];

  function toggleStatus(status: PersonStatus): void {
    statuses = statuses.includes(status)
      ? statuses.filter((s) => s !== status)
      : [...statuses, status];
  }
</script>

<form
  class="relative z-30 grid gap-4 md:grid-cols-[1fr_auto_auto] md:items-end"
  role="search"
  aria-label="Teilnehmende filtern"
  onsubmit={(e) => e.preventDefault()}
>
  <label class="block text-sm">
    <span class="form-label">Suche</span>
    <input type="search" bind:value={search} placeholder="Suchen …" class="form-input" />
  </label>

  <fieldset class="text-sm">
    <legend class="form-label">Status</legend>
    <div class="mt-1 flex flex-wrap gap-x-5">
      {#each STATUS_ORDER as status (status)}
        <button
          type="button"
          aria-pressed={statuses.includes(status)}
          onclick={() => toggleStatus(status)}
          class="py-2 font-semibold decoration-2 underline-offset-[6px] {statuses.includes(status)
            ? 'underline text-brand-900'
            : 'text-neutral-700 hover:text-brand-900 hover:underline'}"
        >
          {PERSON_STATUS_LABEL[status]}
        </button>
      {/each}
    </div>
  </fieldset>

  <details class="relative text-sm">
    <summary class="btn-secondary cursor-pointer list-none tabular-nums">
      Spalten ({shownColumns.length}/{available.length})
    </summary>
    <div
      class="absolute right-0 z-20 mt-2 max-h-80 w-72 overflow-y-auto rounded-md border border-neutral-200 bg-surface p-3 shadow-lift"
    >
      <ul class="space-y-1">
        {#each available as column (column.key)}
          <li>
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                checked={shownColumns.some((c) => c.key === column.key)}
                onchange={() => ontogglecolumn(column.key)}
              />
              <span>{column.label}</span>
            </label>
          </li>
        {/each}
      </ul>
      <button
        type="button"
        class="mt-3 border-t border-neutral-200 pt-2 text-sm font-semibold text-brand-800 underline"
        onclick={onresetcolumns}
      >
        Standardauswahl
      </button>
    </div>
  </details>
</form>
