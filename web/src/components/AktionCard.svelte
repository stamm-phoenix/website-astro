<script lang="ts">
  import AktionUnterlagen from './AktionUnterlagen.svelte';
  import type { Aktion } from '../lib/types';
  import { GROUP_EMOJIS, GROUP_LABELS, stufeToFilterKeys } from '../lib/events';
  import { formatDateRange, localDate } from '../lib/dateUtils';
  import { berlinDay, formatDay } from '../lib/format';
  import { sanitizeDescription } from '../lib/api';
  interface Props {
    aktion: Aktion;
    isExpanded: boolean;
    now: Date;
    ontoggle: () => void;
  }
  let { aktion, isExpanded, now, ontoggle }: Props = $props();
  function hasText(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.trim().length > 0;
  }
  function isMultiDay(aktion: Aktion): boolean {
    return berlinDay(aktion.start) !== berlinDay(aktion.end);
  }
  function isRegistrationOpen(aktion: Aktion): boolean {
    const start = berlinDay(aktion.start);
    return start !== null && start >= localDate(now);
  }
</script>

{#snippet content()}
  {@const filterKeys = stufeToFilterKeys(aktion.stufen)}
  {@const sanitizedDescription = sanitizeDescription(aktion.description ?? '')}
  {@const hasDescription = hasText(sanitizedDescription)}
  {@const hasRegistrationLink = hasText(aktion.campflow_link) && isRegistrationOpen(aktion)}
  {@const hasDetails =
    hasDescription ||
    hasRegistrationLink ||
    !!aktion.meetingPoint ||
    !!aktion.packingList?.length ||
    !!aktion.downloads?.length}
  <li class="event-item">
    <article
      class="event-card overflow-hidden py-4"
      class:expanded={isExpanded}
      data-groups={filterKeys.join(' ')}
    >
      <button
        type="button"
        class="w-full text-left p-4 flex gap-4 items-start"
        onclick={() => hasDetails && ontoggle()}
        aria-expanded={isExpanded}
        disabled={!hasDetails}
      >
        <div
          class="date-badge flex-shrink-0 w-14 h-14 rounded-md bg-neutral-100 border border-[var(--color-neutral-200)] flex flex-col items-center justify-center"
        >
          <span class="text-xs font-semibold text-brand-900">
            {formatDay(aktion.start, { month: 'short' })}
          </span>
          <span class="text-xl font-bold text-[var(--color-brand-900)] leading-none">
            {formatDay(aktion.start, { day: 'numeric' })}
          </span>
        </div>

        <div class="flex-1 min-w-0">
          <h3 class="text-base font-semibold text-[var(--color-brand-900)] leading-snug">
            {aktion.title}
          </h3>
          <p class="text-sm text-[var(--color-neutral-700)] mt-1">
            {formatDateRange(aktion)}
          </p>
          <div class="flex flex-wrap gap-1.5 mt-2">
            {#each filterKeys as key (key)}
              <span
                class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[var(--color-brand-50)] text-[var(--color-brand-800)]"
              >
                {GROUP_EMOJIS[key]}
                {GROUP_LABELS[key]}
              </span>
            {/each}
            {#if isMultiDay(aktion)}
              <span
                class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[var(--color-neutral-100)] text-[var(--color-neutral-700)]"
              >
                Mehrtägig
              </span>
            {/if}
          </div>
        </div>

        {#if hasDetails}
          <div
            class="flex-shrink-0 w-6 h-6 rounded-sm bg-[var(--color-brand-50)] flex items-center justify-center disclosure-icon"
            class:rotate-180={isExpanded}
          >
            <svg
              class="w-4 h-4 text-[var(--color-brand-700)]"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        {/if}
      </button>

      {#if isExpanded && hasDetails}
        <div class="event-details px-4 pb-4 pt-0 border-t border-[var(--color-neutral-100)] mt-0">
          <div class="ml-[4.5rem]">
            {#if hasDescription}
              <div class="description text-sm text-[var(--color-neutral-700)] mt-3">
                <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized via sanitizeDescription -->
                {@html sanitizedDescription}
              </div>
            {/if}
            <AktionUnterlagen {aktion} />
            {#if hasRegistrationLink}
              <a
                href={aktion.campflow_link}
                target="_blank"
                rel="noopener noreferrer"
                class="btn-primary mt-4 w-fit"
              >
                Zur Anmeldung
                <span class="sr-only">(öffnet in neuem Tab)</span>
                <svg
                  class="w-4 h-4"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              </a>
            {/if}
          </div>
        </div>
      {/if}
    </article>
  </li>
{/snippet}
{@render content()}

<style>
  .event-card {
    border-left: 3px solid var(--color-neutral-200);
  }
  .event-card:hover,
  .event-card.expanded {
    border-left-color: var(--color-accent-500);
  }
  .event-card button:disabled {
    cursor: default;
  }
  .description :global(p) {
    margin-bottom: 0.5rem;
  }
  .description :global(p:last-child) {
    margin-bottom: 0;
  }
  .description :global(b),
  .description :global(strong) {
    font-weight: 600;
  }
</style>
