<script lang="ts">
  import { untrack } from 'svelte';
  import { sanitizeDescription } from '../lib/api';
  import { fetchQuestionsAndAnswers, QA_STORE } from '../lib/qaStore.svelte';
  import type { QuestionAndAnswer } from '../lib/types';

  let expandedId = $state<string | null>(null);

  const groupedQuestions = $derived.by(() => {
    const groups: Record<string, QuestionAndAnswer[]> = Object.create(null);

    for (const item of QA_STORE.data ?? []) {
      (groups[item.category] ??= []).push(item);
    }

    return Object.entries(groups).map(([category, questions]) => ({ category, questions }));
  });

  $effect(() => {
    untrack(() => fetchQuestionsAndAnswers());
  });

  /** Builds a readable, collision-free DOM id for a category heading. */
  function categoryId(category: string): string {
    const slug = category
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const losslessKey = Array.from(category, (character) =>
      character.codePointAt(0)?.toString(16)
    ).join('-');

    return `kategorie-${slug || 'thema'}-${losslessKey}`;
  }

  /** Expands the selected answer or collapses it when selected again. */
  function toggleAnswer(id: string): void {
    expandedId = expandedId === id ? null : id;
  }
</script>

{#if QA_STORE.loading}
  <div role="status" aria-live="polite">
    <span class="sr-only">Fragen und Antworten werden geladen...</span>
    <div class="grid gap-4 lg:grid-cols-[13rem_1fr]" aria-hidden="true">
      <div class="skeleton-card surface h-40 p-5">
        <div class="skeleton-element h-4 w-24 rounded"></div>
        <div class="mt-5 space-y-3">
          <div class="skeleton-element h-5 w-full rounded"></div>
          <div class="skeleton-element h-5 w-4/5 rounded"></div>
          <div class="skeleton-element h-5 w-3/4 rounded"></div>
        </div>
      </div>
      <div class="space-y-4">
        {#each [1, 2, 3] as item (item)}
          <div class="skeleton-card surface p-5">
            <div class="skeleton-element h-5 w-3/4 rounded"></div>
          </div>
        {/each}
      </div>
    </div>
  </div>
{:else if QA_STORE.error}
  <article class="surface border-l-4 border-l-[var(--color-dpsg-red)] p-6" role="alert">
    <h2 class="font-serif text-xl text-brand-900">Fragen konnten nicht geladen werden</h2>
    <p class="mt-2 text-neutral-700">
      Lade die Fragen erneut oder schreib uns deine Frage über die Kontaktseite.
    </p>
    <div class="mt-4 flex flex-wrap items-center gap-4">
      <button
        type="button"
        class="rounded-md bg-brand-900 px-4 py-2 font-semibold text-white hover:bg-brand-800"
        onclick={() => fetchQuestionsAndAnswers()}>Erneut laden</button
      >
      <a class="inline-flex font-semibold text-brand-800" href="/kontakt">Zur Kontaktseite</a>
    </div>
  </article>
{:else if groupedQuestions.length > 0}
  <div class="grid items-start gap-6 lg:grid-cols-[13rem_1fr] lg:gap-8">
    <nav
      class="surface border-t-[3px] border-t-[var(--color-dpsg-red)] p-4 lg:sticky lg:top-36"
      aria-label="Themen auf dieser Seite"
    >
      <p class="px-2 text-sm font-semibold text-brand-900">Themen</p>
      <ul class="mt-3 flex flex-wrap gap-2 lg:flex-col">
        {#each groupedQuestions as group (group.category)}
          <li class="lg:w-full">
            <a
              class="group flex items-center justify-between gap-3 rounded-md bg-[var(--color-brand-50)] px-2.5 py-2 text-sm font-semibold text-brand-800 no-underline hover:bg-[var(--color-brand-50)] lg:bg-transparent"
              href={`#${categoryId(group.category)}`}
            >
              <span class="min-w-0 [overflow-wrap:anywhere]">{group.category}</span>
              <span
                class="text-xs font-normal text-neutral-700 group-hover:text-brand-900"
                aria-label={`${group.questions.length} ${group.questions.length === 1 ? 'Frage' : 'Fragen'}`}
              >
                {group.questions.length}
              </span>
            </a>
          </li>
        {/each}
      </ul>
    </nav>

    <div class="min-w-0 space-y-10">
      {#each groupedQuestions as group (group.category)}
        <section
          class="scroll-mt-36"
          id={categoryId(group.category)}
          aria-labelledby={`${categoryId(group.category)}-heading`}
        >
          <div
            class="mb-3 flex items-end justify-between gap-4 border-b border-[var(--color-neutral-200)] pb-2"
          >
            <h2
              id={`${categoryId(group.category)}-heading`}
              class="min-w-0 font-serif text-2xl text-brand-900 [overflow-wrap:anywhere]"
            >
              {group.category}
            </h2>
            <span class="shrink-0 text-sm text-neutral-700">
              {group.questions.length}
              {group.questions.length === 1 ? 'Frage' : 'Fragen'}
            </span>
          </div>

          <div class="space-y-3">
            {#each group.questions as item (item.id)}
              {@const isExpanded = expandedId === item.id}
              <article class="surface overflow-hidden" class:border-brand-200={isExpanded}>
                <h3>
                  <button
                    type="button"
                    class="flex w-full items-center justify-between gap-4 p-5 text-left font-semibold text-brand-900 focus-visible:outline-offset-[-3px]!"
                    aria-expanded={isExpanded}
                    aria-controls={isExpanded ? `antwort-${item.id}` : undefined}
                    onclick={() => toggleAnswer(item.id)}
                  >
                    <span class="min-w-0 [overflow-wrap:anywhere]">{item.question}</span>
                    <span
                      class="answer-toggle grid size-7 shrink-0 place-items-center rounded-full bg-[var(--color-brand-50)] text-brand-800"
                      aria-hidden="true"
                    >
                      <svg
                        class="size-4 transition-transform duration-200 motion-reduce:transition-none"
                        class:rotate-180={isExpanded}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2.5"
                          d="m6 9 6 6 6-6"
                        />
                      </svg>
                    </span>
                  </button>
                </h3>

                {#if isExpanded}
                  <div
                    id={`antwort-${item.id}`}
                    class="answer leading-relaxed border-t border-[var(--color-neutral-100)] px-5 pb-5 pt-4 text-neutral-700 [overflow-wrap:anywhere]"
                  >
                    <!-- The SharePoint rich text is allow-listed and stripped of attributes before rendering. -->
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    {@html sanitizeDescription(item.answer)}
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  </div>
{:else}
  <article class="surface p-6">
    <h2 class="font-serif text-xl text-brand-900">Noch keine Fragen eingetragen</h2>
    <p class="mt-2 text-neutral-700">
      Du kannst uns deine Frage jederzeit über die Kontaktseite schicken.
    </p>
    <a class="mt-4 inline-flex font-semibold text-brand-800" href="/kontakt">Frage stellen</a>
  </article>
{/if}

<style>
  .answer :global(p),
  .answer :global(ul),
  .answer :global(ol) {
    max-width: 70ch;
  }

  .answer :global(p) {
    margin-bottom: 0.75rem;
  }

  .answer :global(p:last-child),
  .answer :global(ul:last-child),
  .answer :global(ol:last-child) {
    margin-bottom: 0;
  }

  .answer :global(ul),
  .answer :global(ol) {
    margin: 0.5rem 0 0.75rem 1.25rem;
  }

  .answer :global(ul) {
    list-style: disc;
  }

  .answer :global(ol) {
    list-style: decimal;
  }

  .answer :global(strong),
  .answer :global(b) {
    font-weight: 600;
    color: var(--color-neutral-800);
  }
</style>
