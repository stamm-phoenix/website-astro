<script lang="ts">
  import { untrack } from 'svelte';
  import { sanitizeDescription } from '../lib/api';
  import { fetchQuestionsAndAnswers, qaStore } from '../lib/qaStore.svelte';
  import type { QuestionAndAnswer } from '../lib/types';

  let expandedId = $state<string | null>(null);

  const groupedQuestions = $derived.by(() => {
    const groups: Record<string, QuestionAndAnswer[]> = {};

    for (const item of qaStore.data ?? []) {
      groups[item.category] = [...(groups[item.category] ?? []), item];
    }

    return Object.entries(groups).map(([category, questions]) => ({ category, questions }));
  });

  $effect(() => {
    untrack(() => fetchQuestionsAndAnswers());
  });

  function categoryId(category: string): string {
    const slug = category
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    return `kategorie-${slug || 'allgemein'}`;
  }

  function toggleAnswer(id: string): void {
    expandedId = expandedId === id ? null : id;
  }
</script>

{#if qaStore.loading}
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
{:else if qaStore.error}
  <article class="surface border-l-4 border-l-[var(--color-dpsg-red)] p-6" role="alert">
    <h2 class="font-serif text-xl text-brand-900">Fragen konnten nicht geladen werden</h2>
    <p class="mt-2 text-neutral-700">
      Versuch es später erneut oder schreib uns deine Frage direkt über die Kontaktseite.
    </p>
    <a class="mt-4 inline-flex font-semibold text-brand-800" href="/kontakt">Zur Kontaktseite</a>
  </article>
{:else if groupedQuestions.length > 0}
  <div class="grid items-start gap-6 lg:grid-cols-[13rem_1fr] lg:gap-8">
    <nav class="category-index surface p-4 lg:sticky lg:top-6" aria-label="Themen auf dieser Seite">
      <p
        class="px-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-dpsg-red)]"
      >
        Themen
      </p>
      <ul class="mt-3 flex flex-wrap gap-2 lg:flex-col">
        {#each groupedQuestions as group (group.category)}
          <li class="lg:w-full">
            <a
              class="category-link flex items-center justify-between gap-3 rounded-md px-2.5 py-2 text-sm font-semibold text-brand-800 no-underline hover:bg-[var(--color-brand-50)]"
              href={`#${categoryId(group.category)}`}
            >
              <span>{group.category}</span>
              <span
                class="text-xs font-normal text-neutral-700"
                aria-label={`${group.questions.length} ${group.questions.length === 1 ? 'Frage' : 'Fragen'}`}
              >
                {group.questions.length}
              </span>
            </a>
          </li>
        {/each}
      </ul>
    </nav>

    <div class="space-y-10">
      {#each groupedQuestions as group (group.category)}
        <section
          class="scroll-mt-6"
          id={categoryId(group.category)}
          aria-labelledby={`${categoryId(group.category)}-heading`}
        >
          <div
            class="mb-3 flex items-end justify-between gap-4 border-b border-[var(--color-neutral-200)] pb-2"
          >
            <h2
              id={`${categoryId(group.category)}-heading`}
              class="font-serif text-2xl text-brand-900"
            >
              {group.category}
            </h2>
            <span class="text-sm text-neutral-700">
              {group.questions.length}
              {group.questions.length === 1 ? 'Frage' : 'Fragen'}
            </span>
          </div>

          <div class="space-y-3">
            {#each group.questions as item (item.id)}
              {@const isExpanded = expandedId === item.id}
              <article class="question-card surface overflow-hidden" class:expanded={isExpanded}>
                <h3>
                  <button
                    type="button"
                    class="flex w-full items-center justify-between gap-4 p-5 text-left font-semibold text-brand-900"
                    aria-expanded={isExpanded}
                    aria-controls={`antwort-${item.id}`}
                    onclick={() => toggleAnswer(item.id)}
                  >
                    <span>{item.question}</span>
                    <span
                      class="answer-toggle grid size-7 shrink-0 place-items-center rounded-full bg-[var(--color-brand-50)] text-brand-800"
                      aria-hidden="true"
                    >
                      <svg
                        class="size-4"
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
                    class="answer border-t border-[var(--color-neutral-100)] px-5 pb-5 pt-4 text-neutral-700"
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
  .category-index {
    border-top: 3px solid var(--color-dpsg-red);
  }

  .category-link:hover span:last-child {
    color: var(--color-brand-900);
  }

  @media (max-width: 63.999rem) {
    .category-link {
      background: var(--color-brand-50);
    }
  }

  .question-card {
    transition:
      transform 0.2s ease,
      box-shadow 0.2s ease,
      border-color 0.2s ease;
  }

  .question-card:hover,
  .question-card.expanded {
    border-color: var(--color-brand-200);
    box-shadow: var(--shadow-lift);
  }

  .question-card:hover {
    transform: translateY(-1px);
  }

  .answer-toggle svg {
    transition: transform 0.2s ease;
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
