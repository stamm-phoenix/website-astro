<script lang="ts">
  import { untrack } from 'svelte';
  import { gruppenstundenStore, fetchGruppenstunden } from '../lib/gruppenstundenStore.svelte';
  import { sanitizeDescription } from '../lib/api';
  import { STUFE_TO_KEY, GROUP_CONFIG } from '../lib/types';
  import { stufeToFilterKey } from '../lib/events';
  import type { GroupKey, Gruppenstunde } from '../lib/types';
  import LeaderAvatar from './LeaderAvatar.svelte';

  let expandedGruppe = $state<string | null>(null);

  $effect(() => {
    untrack(() => {
      fetchGruppenstunden();
    });
  });

  function getGroupKey(stufe: string): GroupKey {
    return STUFE_TO_KEY[stufe] ?? 'Woelflinge';
  }

  function getConfig(gruppe: Gruppenstunde) {
    const key = getGroupKey(gruppe.stufe);
    return GROUP_CONFIG[key];
  }

  function toggleExpand(id: string) {
    expandedGruppe = expandedGruppe === id ? null : id;
  }

  function hasExpandableContent(gruppe: Gruppenstunde): boolean {
    return gruppe.leitende?.length > 0 || !!gruppe.description;
  }
</script>

<div class="grid items-start gap-6 md:grid-cols-2">
  {#if gruppenstundenStore.loading}
    <div role="status" aria-live="polite" class="sr-only">Gruppenstunden werden geladen...</div>
    {#each [1, 2, 3, 4] as i (i)}
      <article
        class="skeleton-card surface border-l-4 border-l-[var(--color-neutral-300)] p-5"
        aria-hidden="true"
      >
        <div class="flex items-center gap-3">
          <div class="skeleton-element h-10 w-10 rounded-md"></div>
          <div class="skeleton-element h-6 w-32 rounded"></div>
        </div>
        <div class="mt-4 space-y-2">
          <div class="skeleton-element h-4 w-44 rounded"></div>
          <div class="skeleton-element h-4 w-28 rounded"></div>
          <div class="skeleton-element h-4 w-36 rounded"></div>
        </div>
      </article>
    {/each}
  {:else if gruppenstundenStore.error}
    <article
      role="alert"
      class="border-l-4 border-l-[var(--color-dpsg-red)] py-2 pl-5 md:col-span-2"
      aria-labelledby="gruppenstunden-error-heading"
    >
      <h3 id="gruppenstunden-error-heading" class="text-lg font-semibold text-brand-900">
        Daten konnten nicht geladen werden
      </h3>
      <p class="mt-1 text-neutral-700">
        Die Gruppenstunden konnten leider nicht abgerufen werden. Bitte versuche es später erneut.
      </p>
    </article>
  {:else}
    {#each gruppenstundenStore.data as gruppe (gruppe.id)}
      {@const config = getConfig(gruppe)}
      {@const isExpanded = expandedGruppe === gruppe.id}
      {@const hasDetails = hasExpandableContent(gruppe)}
      <article
        class="gruppe-card surface border-l-4 p-5"
        style="border-left-color: {config.color};"
        aria-labelledby="gruppe-{gruppe.id}-heading"
      >
        <h2 id="gruppe-{gruppe.id}-heading" class="text-xl font-semibold text-brand-900">
          {#if hasDetails}
            <button
              type="button"
              class="group flex w-full items-center gap-3 text-left"
              onclick={() => toggleExpand(gruppe.id)}
              aria-expanded={isExpanded}
              aria-controls="gruppe-{gruppe.id}-details"
            >
              <img
                src={config.logo}
                alt=""
                aria-hidden="true"
                width="40"
                height="40"
                class="h-10 w-10 object-contain"
                loading="lazy"
                decoding="async"
              />
              <span class="min-w-0 flex-1">{gruppe.stufe}</span>
              <span
                class="flex flex-shrink-0 items-center gap-1 font-sans text-sm font-semibold text-brand-900 group-hover:underline"
              >
                {isExpanded ? 'Weniger' : 'Details'}
                <svg
                  class="h-4 w-4 transition-transform duration-200"
                  class:rotate-180={isExpanded}
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2.5"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </span>
            </button>
          {:else}
            <span class="flex items-center gap-3">
              <img
                src={config.logo}
                alt=""
                aria-hidden="true"
                width="40"
                height="40"
                class="h-10 w-10 object-contain"
                loading="lazy"
                decoding="async"
              />
              {gruppe.stufe}
            </span>
          {/if}
        </h2>

        <dl class="facts mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-neutral-900">
          <dt class="text-neutral-700">Gruppenstunde</dt>
          <dd>{gruppe.weekday}, {gruppe.time}</dd>
          <dt class="text-neutral-700">Alter</dt>
          <dd>{gruppe.ageRange}</dd>
          {#if gruppe.location}
            <dt class="text-neutral-700">Ort</dt>
            <dd>{gruppe.location}</dd>
          {/if}
        </dl>

        <a
          href="/aktionen?gruppe={stufeToFilterKey[gruppe.stufe]}"
          class="mt-4 inline-flex items-center gap-2 font-semibold text-brand-900 underline decoration-neutral-300 underline-offset-4 hover:decoration-current"
        >
          <svg
            class="h-4 w-4"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          Termine der {gruppe.stufe}
        </a>

        {#if isExpanded && hasDetails}
          <div id="gruppe-{gruppe.id}-details" class="mt-5 border-t border-neutral-200 pt-4">
            {#if gruppe.leitende?.length > 0}
              <h3 class="font-semibold text-neutral-900">Leitende</h3>
              <ul class="mt-1 divide-y divide-neutral-200">
                {#each gruppe.leitende as leiter (leiter.id)}
                  <li class="flex items-center gap-3 py-2">
                    <LeaderAvatar
                      id={leiter.id}
                      name={leiter.name}
                      hasImage={leiter.hasImage}
                      size="md"
                    />
                    <span class="text-neutral-900">{leiter.name}</span>
                  </li>
                {/each}
              </ul>
            {/if}

            {#if gruppe.description}
              <div
                class="description text-neutral-900"
                class:mt-4={gruppe.leitende?.length > 0}
                class:border-t={gruppe.leitende?.length > 0}
                class:border-neutral-200={gruppe.leitende?.length > 0}
                class:pt-4={gruppe.leitende?.length > 0}
              >
                <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized via sanitizeDescription -->
                {@html sanitizeDescription(gruppe.description)}
              </div>
            {/if}
          </div>
        {/if}
      </article>
    {:else}
      <p class="border-y border-neutral-200 py-6 text-neutral-700 md:col-span-2">
        Aktuell sind keine Gruppenstunden eingetragen.
      </p>
    {/each}
  {/if}
</div>

<style>
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
