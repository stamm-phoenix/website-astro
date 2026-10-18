<script lang="ts">
  import { taskToday } from '../lib/aufgabenView';
  import type { Task } from '../lib/types';
  import ActionButton from './ui/ActionButton.svelte';

  interface Props {
    task: Task;
    project: string;
    people: string;
    deadline: string;
    urgent: boolean;
    kanban: boolean;
    busy: boolean;
    onopen: () => void;
    ontoggle: () => void;
    onreject: () => void;
    onmenu: () => void;
  }
  let {
    task,
    project,
    people,
    deadline,
    urgent,
    kanban,
    busy,
    onopen,
    ontoggle,
    onreject,
    onmenu,
  }: Props = $props();
  const overdue = $derived(task.state === 'offen' && !!task.dueDate && task.dueDate < taskToday());
</script>

{#snippet icon(path: string)}
  <svg
    aria-hidden="true"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    class="shrink-0"><path d={path} stroke-linecap="round" stroke-linejoin="round" /></svg
  >
{/snippet}

<li
  id="aufgabe-{task.id}"
  data-focus-item
  class="relative {kanban ? 'surface rounded-lg p-4' : 'py-4'}"
>
  <div class="flex items-start gap-2">
    {#if task.state !== 'vorschlag'}
      <button
        type="button"
        class="relative z-10 flex min-h-11 min-w-11 items-center justify-center rounded-sm text-link hover:bg-neutral-100"
        aria-label={task.state === 'erledigt' ? 'Wieder öffnen' : 'Als erledigt markieren'}
        title={task.state === 'erledigt' ? 'Wieder öffnen' : 'Als erledigt markieren'}
        disabled={busy}
        onclick={ontoggle}
      >
        <svg
          aria-hidden="true"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          ><rect x="4" y="4" width="16" height="16" rx="3" />{#if task.state === 'erledigt'}<path
              d="m7 12 3 3 7-7"
              stroke-linecap="round"
              stroke-linejoin="round"
            />{/if}</svg
        >
        <span class="sr-only">{task.state === 'erledigt' ? 'Wieder öffnen' : 'Erledigen'}</span>
      </button>
    {/if}
    <svelte:element
      this={kanban ? 'h3' : 'h2'}
      class="min-w-0 flex-1 text-lg font-semibold break-words"
      class:accepted-title={task.state !== 'vorschlag'}
    >
      {#if task.state === 'vorschlag'}{task.title}
      {:else}<button
          type="button"
          class="task-open text-left before:absolute before:inset-0 before:z-[1] before:content-['']"
          class:completed={task.state === 'erledigt'}
          aria-describedby="aufgabe-{task.id}-open-hint"
          aria-haspopup="dialog"
          disabled={busy}
          onclick={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            onopen();
          }}>{task.title}</button
        >{/if}
    </svelte:element>
    {#if task.state !== 'vorschlag'}
      <button
        type="button"
        class="relative z-10 ml-4 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100"
        aria-label="Weitere Aktionen: {task.title}"
        aria-haspopup="dialog"
        disabled={busy}
        onclick={onmenu}
      >
        <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"
          ><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle
            cx="19"
            cy="12"
            r="2"
          /></svg
        >
      </button>
    {/if}
  </div>
  {#if task.state !== 'vorschlag'}<span id="aufgabe-{task.id}-open-hint" class="sr-only"
      >Aufgabe öffnen und bearbeiten</span
    >{/if}
  {#if task.state === 'vorschlag' && task.suggestedAssigneeName}
    <p class="text-sm text-neutral-700">
      Zuordnungsvorschlag: {task.suggestedAssigneeName} → {people}
    </p>
  {/if}
  {#if task.description}<p
      class="mt-1 whitespace-pre-wrap break-words"
      class:line-clamp-2={task.state !== 'vorschlag'}
    >
      {task.description}
    </p>{/if}
  <dl class="mt-2 flex flex-wrap gap-2 text-sm text-neutral-700 break-words">
    <div class="flex max-w-full items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1">
      {@render icon('M3 7h7l2 2h9v11H3zM3 7V4h7l2 3')}
      <dt class="sr-only">Projekt</dt>
      <dd class="min-w-0">{project}</dd>
    </div>
    <div class="flex max-w-full items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1">
      {@render icon(
        'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M18 8a3 3 0 0 1 0 6M22 21v-2a4 4 0 0 0-3-3.9'
      )}
      <dt class="sr-only">Zuständigkeit</dt>
      <dd class="min-w-0">{people}</dd>
    </div>
    <div
      class="flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 {overdue
        ? 'bg-[var(--color-danger-soft)]'
        : urgent
          ? 'bg-[var(--color-warning-soft)]'
          : 'bg-neutral-100'}"
    >
      {@render icon(
        'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'
      )}
      <dt class="sr-only">Fälligkeit</dt>
      <dd
        class={overdue ? 'font-semibold text-danger' : urgent ? 'font-semibold text-warning' : ''}
        title={task.dueDate?.split('-').reverse().join('.')}
      >
        {deadline}
      </dd>
    </div>
  </dl>
  {#if task.sourceId}
    <a
      class="relative z-10 inline-flex min-h-11 items-center text-link text-sm"
      href="/leitendenbereich/protokolle#protokoll-{encodeURIComponent(task.sourceId)}"
      >Quellprotokoll öffnen</a
    >
    {#if task.state === 'vorschlag'}<blockquote
        class="my-2 border-l-2 border-neutral-300 pl-3 text-sm break-words"
      >
        {task.quote}
      </blockquote>{/if}
  {/if}
  {#if task.state === 'vorschlag'}
    <div class="mt-3 flex flex-wrap gap-2">
      <ActionButton
        type="button"
        variant="primary"
        disabled={busy}
        onclick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          onopen();
        }}>Prüfen und annehmen</ActionButton
      >
      <ActionButton type="button" variant="secondary" disabled={busy} onclick={onreject}
        >Ablehnen</ActionButton
      >
    </div>
  {/if}
</li>

<style>
  /* Keep the first 28px title line centered on the 44px checkbox/menu targets. */
  .accepted-title {
    padding-block: 0.5rem;
    line-height: 1.75rem;
  }
  .task-open {
    display: block;
    width: 100%;
  }

  /* A transform would make the stretched hit area relative to the title during a press. */
  button.task-open:not(:disabled):active {
    transform: none;
    filter: none;
  }

  button.task-open:focus-visible {
    outline: none;
  }
  .task-open.completed {
    color: var(--color-neutral-700);
    text-decoration: line-through;
    text-decoration-thickness: 1px;
  }
  .task-open:focus-visible::before {
    outline: 3px solid var(--color-focus);
    outline-offset: -3px;
    border-radius: 0.5rem;
  }
  summary::-webkit-details-marker {
    display: none;
  }
</style>
