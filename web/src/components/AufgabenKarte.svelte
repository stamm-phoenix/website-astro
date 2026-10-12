<script lang="ts">
  import { onMount } from 'svelte';
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
    reviewer: boolean;
    onopen: () => void;
    ontoggle: () => void;
    onreview: () => void;
    onreject: () => void;
    ondelete: () => void;
  }
  let {
    task,
    project,
    people,
    deadline,
    urgent,
    kanban,
    busy,
    reviewer,
    onopen,
    ontoggle,
    onreview,
    onreject,
    ondelete,
  }: Props = $props();
  let menu = $state<HTMLDetailsElement | null>(null);
  function closeMenu(): void {
    if (menu) menu.open = false;
  }
  function remove(): void {
    closeMenu();
    menu?.querySelector('summary')?.focus();
    ondelete();
  }
  onMount(() => {
    function outside(event: PointerEvent): void {
      if (event.target instanceof Node && !menu?.contains(event.target)) closeMenu();
    }
    function escape(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || !menu?.open) return;
      event.preventDefault();
      closeMenu();
      menu.querySelector('summary')?.focus();
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  });
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

<li id="aufgabe-{task.id}" class="relative {kanban ? 'surface rounded-lg p-4' : 'py-4'}">
  <div class="flex items-start gap-2">
    <svelte:element
      this={kanban ? 'h3' : 'h2'}
      class="min-w-0 flex-1 text-lg font-semibold break-words"
    >
      {#if task.state === 'vorschlag'}{task.title}
      {:else}<button
          type="button"
          class="task-open text-left before:absolute before:inset-0 before:z-[1] before:content-['']"
          aria-describedby="aufgabe-{task.id}-open-hint"
          aria-haspopup="dialog"
          disabled={busy}
          onclick={onopen}>{task.title}</button
        >{/if}
    </svelte:element>
    {#if task.state !== 'vorschlag'}
      <button
        type="button"
        class="relative z-10 flex min-h-11 min-w-11 items-center justify-center rounded-full text-link hover:bg-neutral-100"
        aria-label={task.state === 'erledigt' ? 'Wieder öffnen' : 'Als erledigt markieren'}
        aria-pressed={task.state === 'erledigt'}
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
          ><circle cx="12" cy="12" r="9" />{#if task.state === 'erledigt'}<path
              d="m7 12 3 3 7-7"
              stroke-linecap="round"
              stroke-linejoin="round"
            />{/if}</svg
        >
      </button>
      {#if !task.sourceId}
        <details bind:this={menu} class="relative z-10 shrink-0">
          <summary
            class="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100"
            aria-label="Weitere Aktionen: {task.title}"
            title="Weitere Aktionen"
          >
            <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"
              ><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle
                cx="19"
                cy="12"
                r="2"
              /></svg
            >
          </summary>
          <div class="absolute right-0 top-full z-20 min-w-40 surface rounded-lg p-2 shadow-lg">
            <ActionButton
              type="button"
              variant="danger"
              class="w-full"
              disabled={busy}
              onclick={remove}>Löschen</ActionButton
            >
          </div>
        </details>
      {/if}
    {/if}
  </div>
  {#if task.state !== 'vorschlag'}<span id="aufgabe-{task.id}-open-hint" class="sr-only"
      >Aufgabe öffnen und bearbeiten</span
    >{/if}
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
      class="flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 {urgent
        ? 'bg-[var(--color-warning-soft)]'
        : 'bg-neutral-100'}"
    >
      {@render icon(
        'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'
      )}
      <dt class="sr-only">Fälligkeit</dt>
      <dd
        class={urgent ? 'font-semibold text-warning' : ''}
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
      <ActionButton type="button" variant="primary" disabled={busy || !reviewer} onclick={onreview}
        >Prüfen und annehmen</ActionButton
      >
      <ActionButton
        type="button"
        variant="secondary"
        disabled={busy || !reviewer}
        onclick={onreject}>Ablehnen</ActionButton
      >
    </div>
  {/if}
</li>

<style>
  /* A transform would make the stretched hit area relative to the title during a press. */
  button.task-open:not(:disabled):active {
    transform: none;
    filter: none;
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
