<script lang="ts">
  import { onMount } from 'svelte';
  import { sanitizeDescription } from '../lib/api';
  import { fetchQuestionsAndAnswers, QA_STORE } from '../lib/qaStore.svelte';
  import { createQuestionIndex, suggestQuestions } from '../lib/qaSearch';
  import { withBaked } from '../lib/storeView';
  import type { QuestionAndAnswer } from '../../../api/lib/qa-model';

  interface Props {
    message: string;
    initial?: QuestionAndAnswer[] | null;
  }
  let { message, initial = null }: Props = $props();
  const view = $derived(withBaked(QA_STORE, initial));
  const index = $derived(createQuestionIndex(view.data ?? []));
  const suggestions = $derived(suggestQuestions(index, message));

  onMount(() => {
    fetchQuestionsAndAnswers();
  });
</script>

<div aria-live="polite" aria-atomic="true" class="sr-only">
  {#if suggestions.length}{suggestions.length} passende Antworten verfügbar.{/if}
</div>
{#if suggestions.length}
  <section aria-labelledby="kontakt-antworten">
    <h2 id="kontakt-antworten" class="font-serif text-xl text-brand-900">Passende Antworten</h2>
    <div class="mt-3 divide-y divide-neutral-200 border-y border-neutral-300">
      {#each suggestions as item (item.id)}
        <details>
          <summary
            class="min-h-11 cursor-pointer py-3 font-semibold text-brand-900 [overflow-wrap:anywhere]"
            >{item.question}</summary
          >
          <div class="answer prose max-w-none pb-4 text-neutral-800 [overflow-wrap:anywhere]">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html sanitizeDescription(item.answer, 'public')}
          </div>
        </details>
      {/each}
    </div>
  </section>
{/if}

<style>
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
</style>
