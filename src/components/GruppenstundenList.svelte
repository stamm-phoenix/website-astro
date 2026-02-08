<script lang="ts">
  import { untrack } from "svelte";
  import {
    gruppenstundenStore,
    fetchGruppenstunden,
  } from "../lib/gruppenstundenStore.svelte";
  import { sanitizeDescription } from "../lib/api";
  import { STUFE_TO_KEY, GROUP_CONFIG } from "../lib/types";
  import type { GroupKey, Gruppenstunde } from "../lib/types";
  import LeaderAvatar from "./LeaderAvatar.svelte";

  let expandedGruppe = $state<string | null>(null);

  $effect(() => {
    untrack(() => {
      fetchGruppenstunden();
    });
  });

  function getGroupKey(stufe: string): GroupKey {
    return STUFE_TO_KEY[stufe] ?? "Woelflinge";
  }

  function getConfig(gruppe: Gruppenstunde) {
    const key = getGroupKey(gruppe.stufe);
    return GROUP_CONFIG[key];
  }

  function toggleExpand(id: string) {
    expandedGruppe = expandedGruppe === id ? null : id;
  }

  function hasExpandableContent(gruppe: Gruppenstunde): boolean {
    return (gruppe.leitende?.length > 0) || !!gruppe.description;
  }
</script>

<div class="grid gap-6 md:grid-cols-2">
  {#if gruppenstundenStore.loading}
    <div role="status" aria-live="polite" class="sr-only">
      Gruppenstunden werden geladen...
    </div>
    {#each [1, 2, 3, 4] as i}
      <article class="skeleton-card surface p-5 border-l-4 border-l-[var(--color-neutral-300)]">
        <div class="flex items-center gap-3">
          <div class="skeleton-element w-10 h-10 rounded-md"></div>
          <div class="skeleton-element h-6 w-32 rounded"></div>
        </div>
        <div class="mt-3 space-y-2">
          <div class="skeleton-element h-4 w-40 rounded"></div>
          <div class="skeleton-element h-4 w-28 rounded"></div>
          <div class="skeleton-element h-4 w-36 rounded"></div>
        </div>
        <div class="mt-5 pt-4 border-t border-[var(--color-neutral-200)]">
          <div class="skeleton-element h-3 w-16 rounded mb-3"></div>
          <div class="flex flex-col gap-3">
            <div class="flex items-center gap-3">
              <div class="skeleton-element w-14 h-14 rounded-full"></div>
              <div class="skeleton-element h-4 w-32 rounded"></div>
            </div>
            <div class="flex items-center gap-3">
              <div class="skeleton-element w-14 h-14 rounded-full"></div>
              <div class="skeleton-element h-4 w-28 rounded"></div>
            </div>
          </div>
        </div>
      </article>
    {/each}
  {:else if gruppenstundenStore.error}
    <div class="md:col-span-2">
      <article role="alert" class="surface p-6 border-l-4 border-l-[var(--color-dpsg-red)]" aria-labelledby="gruppenstunden-error-heading">
        <div class="flex items-start gap-4">
          <div
            class="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--color-dpsg-red)]/10 flex items-center justify-center"
          >
            <svg
              aria-hidden="true"
              class="w-5 h-5 text-[var(--color-dpsg-red)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div>
            <h3 id="gruppenstunden-error-heading" class="text-lg font-semibold text-[var(--color-brand-900)]">
              Daten konnten nicht geladen werden
            </h3>
            <p class="mt-1 text-sm text-[var(--color-neutral-700)]">
              Die Gruppenstunden konnten leider nicht abgerufen werden. Bitte versuche es später erneut.
            </p>
          </div>
        </div>
      </article>
    </div>
  {:else}
    {#each gruppenstundenStore.data as gruppe (gruppe.id)}
      {@const config = getConfig(gruppe)}
      {@const isExpanded = expandedGruppe === gruppe.id}
      {@const hasDetails = hasExpandableContent(gruppe)}
      <article
        class="gruppe-card surface border-l-4 relative overflow-hidden transition-all duration-200"
        class:expanded={isExpanded}
        style="border-left-color: {config.color};"
        aria-labelledby="gruppe-{gruppe.id}-heading"
      >
        <div
          class="absolute top-3 right-3 opacity-[0.12] pointer-events-none"
          aria-hidden="true"
        >
          <img
            src={config.logo}
            alt=""
            aria-hidden="true"
            class="w-16 h-16 object-contain"
            loading="lazy"
            decoding="async"
          />
        </div>

        <button
          type="button"
          class="w-full text-left p-5 relative"
          onclick={() => hasDetails && toggleExpand(gruppe.id)}
          aria-expanded={isExpanded}
          disabled={!hasDetails}
        >
          <div class="flex items-center gap-3">
            <img
              src={config.logo}
              alt="{gruppe.stufe} Stufenlilie"
              class="w-10 h-10 object-contain"
              loading="lazy"
              decoding="async"
            />
            <h2 id="gruppe-{gruppe.id}-heading" class="text-lg font-semibold text-[var(--color-brand-900)]">
              {gruppe.stufe}
            </h2>
            {#if hasDetails}
              <div class="ml-auto flex-shrink-0 w-6 h-6 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center transition-transform duration-200" class:rotate-180={isExpanded}>
                <svg class="w-4 h-4 text-[var(--color-brand-700)]" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            {/if}
          </div>

          <div class="mt-3 space-y-1">
            <p class="text-sm text-[var(--color-neutral-800)]">
              <strong>Gruppenstunde:</strong>
              {gruppe.weekday}, {gruppe.time}
            </p>
            <p class="text-sm text-[var(--color-neutral-800)]">
              <strong>Alter:</strong>
              {gruppe.ageRange}
            </p>
            {#if gruppe.location}
              <p class="text-sm text-[var(--color-neutral-800)]">
                <strong>Ort:</strong>
                {gruppe.location}
              </p>
            {/if}
          </div>

          <div class="mt-4">
            <a
              href="/aktionen?gruppe={getGroupKey(gruppe.stufe)}"
              class="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-brand-700)] hover:text-[var(--color-brand-900)] transition-colors"
              onclick={(e) => e.stopPropagation()}
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Termine
            </a>
          </div>
        </button>

        {#if isExpanded && hasDetails}
          <div class="px-5 pb-5 pt-0 border-t border-[var(--color-neutral-100)]">
            {#if gruppe.leitende?.length > 0}
              <div class="mt-4">
                <p class="text-xs font-semibold text-[var(--color-neutral-600)] uppercase tracking-wide mb-3">
                  Leitende
                </p>
                <div class="flex flex-col gap-3">
                  {#each gruppe.leitende as leiter (leiter.id)}
                    <div class="flex items-center gap-3">
                      <LeaderAvatar
                        id={leiter.id}
                        name={leiter.name}
                        hasImage={leiter.hasImage}
                        size="ml"
                      />
                      <span class="text-sm font-medium text-[var(--color-neutral-800)]">
                        {leiter.name}
                      </span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            {#if gruppe.description}
              <div class="description mt-4 text-sm text-[var(--color-neutral-700)]">
                {@html sanitizeDescription(gruppe.description)}
              </div>
            {/if}
          </div>
        {/if}
      </article>
    {:else}
      <div class="md:col-span-2">
        <article class="surface p-6" aria-labelledby="no-gruppenstunden-heading">
          <p id="no-gruppenstunden-heading" class="text-[var(--color-neutral-700)]">
            Aktuell sind keine Gruppenstunden eingetragen.
          </p>
        </article>
      </div>
    {/each}
  {/if}
</div>

<style>
  .gruppe-card {
    cursor: pointer;
  }

  .gruppe-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-lift);
  }

  .gruppe-card.expanded {
    box-shadow: var(--shadow-lift);
  }

  .gruppe-card button:disabled {
    cursor: default;
  }

  .gruppe-card button:disabled + .gruppe-card:hover {
    transform: none;
  }

  .skeleton-card {
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }

  .skeleton-element {
    background: linear-gradient(
      110deg,
      var(--color-neutral-200) 0%,
      var(--color-neutral-100) 40%,
      var(--color-neutral-200) 60%,
      var(--color-neutral-200) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.85;
    }
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
