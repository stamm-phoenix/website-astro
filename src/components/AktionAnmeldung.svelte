<script lang="ts">
  import { untrack } from "svelte";
  import { aktionenStore, fetchAktionen } from "../lib/aktionenStore.svelte";
  import {
    GROUP_EMOJIS,
    GROUP_LABELS,
    stufeToFilterKeys,
    type GroupKey,
  } from "../lib/events";
  import { formatDateRange } from "../lib/dateUtils";
  import { sanitizeDescription } from "../lib/api";
  import type { Aktion } from "../lib/types";

  let uid = $state<string | null>(null);

  $effect(() => {
    untrack(() => {
      const pathParts = window.location.pathname.split("/").filter(Boolean);
      // URL is /aktionen/[uid]/anmeldung, so uid is second to last
      uid = decodeURIComponent(pathParts[pathParts.length - 2] || "");
      fetchAktionen();
    });
  });

  $effect(() => {
    if (aktion) {
      document.title = `Anmeldung: ${aktion.title} | Stamm Phoenix`;
    }
  });

  const aktion = $derived(
    aktionenStore.data?.find((a: Aktion) => a.id === uid) ?? null,
  );

  const filterKeys = $derived(aktion ? stufeToFilterKeys(aktion.stufen) : []);
  const groupLabel = $derived(
    filterKeys.map((key: GroupKey) => `${GROUP_EMOJIS[key]} ${GROUP_LABELS[key]}`).join(", "),
  );

  function getCampflowSlug(url: string): string | null {
    try {
      const parsed = new URL(url);
      // Campflow URLs are like https://app.campflow.de/org/event-slug
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      if (pathParts.length >= 2) {
        return `${pathParts[0]}/${pathParts[1]}`;
      }
      return null;
    } catch {
      return null;
    }
  }
</script>

{#if aktionenStore.loading}
  <div role="status" aria-live="polite" class="sr-only">
    Anmeldung wird geladen...
  </div>
  <div class="space-y-4 mt-6">
    <div class="surface p-6">
      <div class="skeleton-element h-6 w-64 rounded mb-4"></div>
      <div class="skeleton-element h-4 w-48 rounded mb-2"></div>
      <div class="skeleton-element h-4 w-32 rounded"></div>
    </div>
    <div class="skeleton-element h-96 w-full rounded"></div>
  </div>
{:else if aktionenStore.error}
  <article role="alert" class="surface p-6 border-l-4 border-l-[var(--color-dpsg-red)] mt-6" aria-labelledby="anmeldung-error-heading">
    <div class="flex items-start gap-4">
      <div class="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--color-dpsg-red)]/10 flex items-center justify-center">
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
        <h3 id="anmeldung-error-heading" class="text-lg font-semibold text-[var(--color-brand-900)]">
          Daten konnten nicht geladen werden
        </h3>
        <p class="mt-1 text-sm text-[var(--color-neutral-700)]">
          Die Anmeldung konnte leider nicht geladen werden. Bitte versuche es später erneut.
        </p>
      </div>
    </div>
  </article>
{:else if aktion}
  {@const campflowSlug = aktion.campflow_link ? getCampflowSlug(aktion.campflow_link) : null}
  
  <div class="mt-6 space-y-6">
    <article class="surface p-6 border-l-4 border-l-[var(--color-accent-500)]" aria-labelledby="anmeldung-detail-heading">
      <h2 id="anmeldung-detail-heading" class="text-xl font-serif font-semibold text-[var(--color-brand-900)]">{aktion.title}</h2>
      <div class="mt-3 flex flex-wrap gap-4 text-sm text-[var(--color-neutral-700)]">
        <span class="inline-flex items-center gap-2">
          <svg class="w-4 h-4" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {formatDateRange(aktion)}
        </span>
        {#if groupLabel}
          <span class="inline-flex items-center gap-2">
            <svg class="w-4 h-4" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            {groupLabel}
          </span>
        {/if}
      </div>
      {#if aktion.description}
        <div class="mt-4 text-sm text-[var(--color-neutral-700)] prose prose-sm">
          {@html sanitizeDescription(aktion.description)}
        </div>
      {/if}
    </article>

    {#if campflowSlug}
      <section class="anmeldung-form" aria-labelledby="anmeldung-form-heading">
        <h2 id="anmeldung-form-heading" class="text-lg font-semibold text-[var(--color-brand-900)] mb-4">Anmeldeformular</h2>
        <noscript>
          <p class="text-sm text-[var(--color-neutral-700)]">
            Bitte JavaScript aktivieren, um das Anmeldeformular zu laden.
          </p>
        </noscript>
        <div class="campflow-embed surface p-4">
          <script src="https://embed.campflow.de" data-slug={campflowSlug}></script>
        </div>
      </section>
    {:else if aktion.campflow_link}
      <section class="surface p-6" aria-labelledby="external-anmeldung-heading">
        <h2 id="external-anmeldung-heading" class="text-lg font-semibold text-[var(--color-brand-900)] mb-3">Externe Anmeldung</h2>
        <p class="text-sm text-[var(--color-neutral-700)] mb-4">
          Die Anmeldung für diese Aktion erfolgt über eine externe Plattform.
        </p>
        <a
          href={aktion.campflow_link}
          class="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[var(--color-accent-500)] text-white font-semibold shadow-soft hover:shadow-lift hover:-translate-y-0.5 transition-all duration-200"
          target="_blank"
          rel="noopener noreferrer"
        >
          Zur Anmeldung
          <span class="sr-only">(öffnet in neuem Tab)</span>
          <svg class="w-4 h-4" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </section>
    {/if}
  </div>
{:else}
  <div class="surface p-6 mt-6" aria-labelledby="anmeldung-not-found-heading">
    <h2 id="anmeldung-not-found-heading" class="text-lg font-semibold text-[var(--color-brand-900)]">Aktion nicht gefunden</h2>
    <p class="mt-2 text-sm text-[var(--color-neutral-700)]">
      Die angeforderte Aktion konnte nicht gefunden werden.
    </p>
    <a
      href="/aktionen"
      class="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded border border-[var(--color-neutral-300)] text-[var(--color-neutral-800)] hover:border-[var(--color-brand-700)] hover:text-[var(--color-brand-900)] transition"
    >
      Alle Aktionen anzeigen
    </a>
  </div>
{/if}

<style>
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

  @media (prefers-reduced-motion: reduce) {
    .skeleton-element {
      animation: none;
      background: var(--color-neutral-200);
      background-size: 100% 100%;
    }
  }

  .campflow-embed :global(iframe) {
    width: 100%;
    min-height: 600px;
    border: none;
    border-radius: var(--radius-md);
  }
</style>
