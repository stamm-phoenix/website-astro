<script lang="ts">
  import { onMount } from "svelte";
  import { aktionenStore, fetchAktionen } from "../lib/aktionenStore.svelte";
  import {
    GROUP_EMOJIS,
    GROUP_LABELS,
    stufeToFilterKeys,
  } from "../lib/events";
  import { formatDateRange } from "../lib/dateUtils";
  import type { Aktion } from "../lib/types";

  let uid = $state<string | null>(null);

  onMount(() => {
    const pathParts = window.location.pathname.split("/");
    uid = decodeURIComponent(pathParts[pathParts.length - 1] || "");
    fetchAktionen();
  });

  $effect(() => {
    if (aktion) {
      document.title = `${aktion.title} | Aktionen | Stamm Phoenix`;
    }
  });

  const aktion = $derived(
    aktionenStore.data?.find((a) => a.id === uid) ?? null,
  );

  const filterKeys = $derived(aktion ? stufeToFilterKeys(aktion.stufen) : []);
  const groupLabel = $derived(
    filterKeys.map((key) => `${GROUP_EMOJIS[key]} ${GROUP_LABELS[key]}`).join(", "),
  );
</script>

{#if aktionenStore.loading}
  <div role="status" aria-live="polite" class="sr-only">
    Termin wird geladen...
  </div>
  <div class="space-y-4">
    <div class="skeleton-element h-8 w-64 rounded"></div>
    <div class="skeleton-element h-4 w-48 rounded"></div>
    <div class="skeleton-element h-4 w-32 rounded"></div>
    <div class="skeleton-element h-20 w-full rounded mt-4"></div>
  </div>
{:else if aktionenStore.error}
  <article role="alert" class="surface p-6 border-l-4 border-l-[var(--color-dpsg-red)]" aria-labelledby="aktion-error-heading">
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
        <h3 id="aktion-error-heading" class="text-lg font-semibold text-[var(--color-brand-900)]">
          Daten konnten nicht geladen werden
        </h3>
        <p class="mt-1 text-sm text-[var(--color-neutral-700)]">
          Der Termin konnte leider nicht abgerufen werden. Bitte versuchen Sie es später erneut.
        </p>
      </div>
    </div>
  </article>
{:else if aktion}
  <h1 class="underline-accent">{aktion.title}</h1>
  <p class="text-sm text-[var(--color-neutral-700)]">{formatDateRange(aktion)}</p>
  {#if groupLabel}
    <p class="text-sm text-[var(--color-neutral-700)]">Gruppen: {groupLabel}</p>
  {/if}

  {#if aktion.description}
    <p class="mt-4 text-base text-[var(--color-neutral-700)] whitespace-pre-line leading-relaxed">{aktion.description}</p>
  {:else}
    <p class="mt-4 text-sm text-[var(--color-neutral-700)]">Weitere Details folgen in Kürze.</p>
  {/if}

  <div class="mt-6 flex flex-wrap gap-3">
    {#if aktion.campflow_link}
      <a
        href={aktion.campflow_link}
        class="inline-flex items-center gap-2 px-4 py-2 rounded border border-[var(--color-neutral-300)] text-[var(--color-neutral-800)] hover:border-[var(--color-brand-700)] hover:text-[var(--color-brand-900)] transition"
        target="_blank"
        rel="noopener noreferrer"
      >
        Zur Anmeldung &nearrow;
      </a>
    {/if}
    <a
      href="/aktionen"
      class="inline-flex items-center gap-2 px-4 py-2 rounded border border-[var(--color-neutral-300)] text-[var(--color-neutral-800)] hover:border-[var(--color-brand-700)] hover:text-[var(--color-brand-900)] transition"
    >
      Alle Aktionen
    </a>
  </div>
{:else}
  <div class="surface p-6">
    <h2 class="text-lg font-semibold text-[var(--color-brand-900)]">Termin nicht gefunden</h2>
    <p class="mt-2 text-sm text-[var(--color-neutral-700)]">
      Der angeforderte Termin konnte nicht gefunden werden.
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
</style>
