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
    <div class="grid gap-6 lg:grid-cols-[13rem_1fr] lg:gap-8" aria-hidden="true">
      <div class="skeleton-card space-y-3 border-l-2 border-neutral-200 pl-4">
        <div class="skeleton-element h-4 w-24 rounded-sm"></div>
        <div class="skeleton-element h-5 w-full rounded-sm"></div>
        <div class="skeleton-element h-5 w-4/5 rounded-sm"></div>
      </div>
      <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
        {#each [1, 2, 3] as item (item)}
          <li class="skeleton-card py-5">
            <div class="skeleton-element h-5 w-3/4 rounded-sm"></div>
          </li>
        {/each}
      </ul>
    </div>
  </div>
{:else if QA_STORE.error}
  <div class="border-l-4 border-l-[var(--color-dpsg-red)] py-2 pl-5" role="alert">
    <h2 class="font-serif text-xl text-brand-900">Fragen konnten nicht geladen werden</h2>
    <p class="mt-2 text-neutral-700">
      Lade die Fragen erneut oder schreib uns deine Frage über die Kontaktseite.
    </p>
    <div class="mt-4 flex flex-wrap items-center gap-4">
      <button type="button" class="btn-primary" onclick={() => fetchQuestionsAndAnswers()}
        >Erneut laden</button
      >
      <a class="font-semibold text-brand-800 underline underline-offset-4" href="/kontakt"
        >Zur Kontaktseite</a
      >
    </div>
  </div>
{:else if groupedQuestions.length > 0}
  <div class="grid items-start gap-8 lg:grid-cols-[13rem_1fr]">
    <!-- Table of contents: plain links with the number of questions, no boxes -->
    <nav class="lg:sticky lg:top-36" aria-label="Themen auf dieser Seite">
      <p class="text-sm font-semibold text-brand-900">Themen</p>
      <ul
        class="mt-2 flex flex-wrap gap-x-5 gap-y-1 lg:flex-col lg:border-l-2 lg:border-[var(--color-dpsg-red)] lg:pl-4"
      >
        {#each groupedQuestions as group (group.category)}
          <li>
            <a
              class="inline-flex items-baseline gap-1.5 py-1 text-sm font-semibold text-brand-800 underline decoration-transparent underline-offset-4 hover:decoration-current"
              href={`#${categoryId(group.category)}`}
            >
              <span class="min-w-0 [overflow-wrap:anywhere]">{group.category}</span>
              <span
                class="font-normal text-neutral-700 tabular-nums"
                aria-label={`${group.questions.length} ${group.questions.length === 1 ? 'Frage' : 'Fragen'}`}
              >
                ({group.questions.length})
              </span>
            </a>
          </li>
        {/each}
      </ul>
    </nav>

    <div class="min-w-0 space-y-12">
      {#each groupedQuestions as group (group.category)}
        <section
          class="scroll-mt-36"
          id={categoryId(group.category)}
          aria-labelledby={`${categoryId(group.category)}-heading`}
        >
          <div class="mb-1 flex items-baseline justify-between gap-4">
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

          <!-- Questions as a ruled list; the open answer follows directly under its question -->
          <ul class="divide-y divide-neutral-200 border-y border-neutral-300">
            {#each group.questions as item (item.id)}
              {@const isExpanded = expandedId === item.id}
              <li>
                <h3>
                  <button
                    type="button"
                    class="flex w-full items-center justify-between gap-4 py-4 text-left font-semibold text-brand-900 hover:text-brand-700 focus-visible:outline-offset-2!"
                    aria-expanded={isExpanded}
                    aria-controls={isExpanded ? `antwort-${item.id}` : undefined}
                    onclick={() => toggleAnswer(item.id)}
                  >
                    <span class="min-w-0 [overflow-wrap:anywhere]">{item.question}</span>
                    <svg
                      class="answer-toggle size-5 shrink-0 text-brand-800 transition-transform duration-200 motion-reduce:transition-none"
                      class:rotate-180={isExpanded}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2.5"
                        d="m6 9 6 6 6-6"
                      />
                    </svg>
                  </button>
                </h3>

                {#if isExpanded}
                  <div
                    id={`antwort-${item.id}`}
                    class="answer pb-5 leading-relaxed text-neutral-800 [overflow-wrap:anywhere]"
                  >
                    <!-- The SharePoint rich text is allow-listed and stripped of attributes before rendering. -->
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    {@html sanitizeDescription(item.answer)}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  </div>
{:else}
  <div class="border-y border-neutral-200 py-6">
    <h2 class="font-serif text-xl text-brand-900">Noch keine Fragen eingetragen</h2>
    <p class="mt-2 text-neutral-700">
      Du kannst uns deine Frage jederzeit über die Kontaktseite schicken.
    </p>
    <a
      class="mt-4 inline-flex font-semibold text-brand-800 underline underline-offset-4"
      href="/kontakt">Frage stellen</a
    >
  </div>
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
