<script lang="ts">
  import type { Task } from '../lib/types';
  import { aufgabenStore } from '../lib/aufgabenStore.svelte';
  import { dueLabel, dueSoon } from '../lib/aufgabenView';
  import { taskAssigneeNames } from '../../../api/lib/aufgaben-zuordnung';
  import AufgabenKarte from './AufgabenKarte.svelte';
  let {
    visible,
    presentation = 'liste',
    statusFilter = 'offen',
    view = statusFilter,
    projectFilter = 'alle',
    ownOnly = false,
    busy = false,
    onopen,
    ontoggle = () => {},
    onreject = () => {},
    onmenu = () => {},
  }: {
    visible: Task[];
    presentation?: string;
    statusFilter?: string;
    view?: string;
    projectFilter?: string;
    ownOnly?: boolean;
    busy?: boolean;
    onopen: (task: Task) => void;
    ontoggle?: (task: Task) => void;
    onreject?: (task: Task) => void;
    onmenu?: (task: Task) => void;
  } = $props();
  const data = $derived(aufgabenStore.data);
  const users = $derived(aufgabenStore.users);
  const boardColumns = [
    { value: 'offen', label: 'Offen' },
    { value: 'erledigt', label: 'Erledigt' },
  ];
</script>

{#snippet taskRow(task: Task)}
  <AufgabenKarte
    {task}
    project={data?.projects.find((p) => p.id === task.projectId)?.title ??
      (task.state === 'vorschlag' && task.suggestedProjectTitle
        ? `Projektvorschlag: ${task.suggestedProjectTitle}`
        : 'Ohne Projekt')}
    people={taskAssigneeNames(task, users)}
    deadline={dueLabel(task)}
    urgent={dueSoon(task)}
    kanban={presentation === 'kanban'}
    {busy}
    reviewer={data?.reviewer ?? false}
    onopen={() => onopen(task)}
    ontoggle={() => ontoggle(task)}
    onreview={() => onopen(task)}
    onreject={() => onreject(task)}
    onmenu={() => onmenu(task)}
  />
{/snippet}
{#if presentation === 'kanban'}
  <div
    class="grid min-w-0 gap-5 {statusFilter === 'alle' ? 'lg:grid-cols-2' : ''}"
    aria-label="Kanban-Ansicht"
  >
    {#each boardColumns.filter((column) => statusFilter === 'alle' || column.value === statusFilter) as column (column.value)}
      {@const tasks = visible.filter((task) => task.state === column.value)}
      <section class="min-w-0 surface-muted rounded-lg p-3" aria-labelledby="kanban-{column.value}">
        <h2 id="kanban-{column.value}" class="mb-3 text-lg font-semibold">
          {column.label}
          <span class="text-sm font-normal text-neutral-700">({tasks.length})</span>
        </h2>
        <ul class="space-y-3">
          {#each tasks as task (task.id)}
            {@render taskRow(task)}
          {:else}
            <li class="py-3 text-sm text-neutral-700">
              {projectFilter !== 'alle' || ownOnly
                ? 'Keine passenden Aufgaben. Passe die Filter an.'
                : column.value === 'offen'
                  ? 'Noch keine offenen Aufgaben. Lege eine Aufgabe an.'
                  : 'Noch nichts erledigt. Markiere fertige Aufgaben als erledigt.'}
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
{:else}
  <ul class="divide-y divide-neutral-200">
    {#each visible as task (task.id)}
      {@render taskRow(task)}
    {:else}<li class="py-3 text-neutral-700">
        Keine {view === 'vorschlag'
          ? 'Vorschläge'
          : view === 'erledigt'
            ? 'erledigten Aufgaben'
            : view === 'alle'
              ? 'Aufgaben'
              : 'offenen Aufgaben'} für diese Auswahl.
        {#if view === 'vorschlag'}<p class="mt-1 text-sm">
            {data?.extractionConfigured && data?.reviewer
              ? 'Wähle ein Protokoll und tippe auf Aufgaben erkennen.'
              : 'Lege eine Aufgabe an oder prüfe die gewählten Filter.'}
          </p>{:else if view === 'offen'}<p class="mt-1 text-sm">
            Lege eine Aufgabe an oder ändere die Filter.
          </p>{/if}
      </li>{/each}
  </ul>
{/if}
