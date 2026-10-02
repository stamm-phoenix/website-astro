<script lang="ts">
  import { untrack } from 'svelte';
  import { vorstandStore, fetchVorstand } from '../lib/vorstandStore.svelte';
  import LeaderAvatar from './LeaderAvatar.svelte';

  $effect(() => {
    untrack(() => {
      fetchVorstand();
    });
  });

  function formatPhone(phone: string): string {
    return phone.replace(/\s+/g, '');
  }
</script>

{#if vorstandStore.loading}
  <div role="status" aria-live="polite">
    <span class="sr-only">Vorstandsdaten werden geladen...</span>
    <ul class="divide-y divide-neutral-200 border-y border-neutral-200" aria-hidden="true">
      {#each [1, 2] as i (i)}
        <li class="skeleton-card flex items-start gap-5 py-5">
          <div class="skeleton-element h-20 w-20 flex-shrink-0 rounded-full"></div>
          <div class="flex-1 space-y-3">
            <div class="skeleton-element h-6 w-36 rounded-sm"></div>
            <div class="skeleton-element h-4 w-32 rounded-sm"></div>
            <div class="skeleton-element h-4 w-44 rounded-sm"></div>
          </div>
        </li>
      {/each}
    </ul>
  </div>
{:else if vorstandStore.error}
  <div
    role="alert"
    class="border-l-4 border-l-[var(--color-dpsg-red)] py-2 pl-5"
    aria-labelledby="vorstand-error-heading"
  >
    <h3 id="vorstand-error-heading" class="font-semibold text-brand-900">
      Daten konnten nicht geladen werden
    </h3>
    <p class="mt-1 text-neutral-700">
      Die Vorstandsdaten konnten leider nicht abgerufen werden. Bitte versuche es später erneut.
    </p>
  </div>
{:else if (vorstandStore.data?.length ?? 0) > 0}
  <!-- Ruled list like an address book: photo, name, phone, address -->
  <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
    {#each vorstandStore.data as person (person.id)}
      <li>
        <article
          class="vorstand-card flex items-start gap-5 py-5"
          aria-labelledby="vorstand-heading-{person.id}"
        >
          <div class="flex-shrink-0">
            <LeaderAvatar id={person.id} name={person.name} hasImage={person.hasImage} size="lg" />
          </div>

          <div
            class="grid min-w-0 flex-1 gap-x-8 gap-y-2 md:grid-cols-[minmax(0,15rem)_10rem_minmax(0,1fr)] md:items-baseline"
          >
            <h3 id="vorstand-heading-{person.id}" class="text-lg font-semibold text-brand-900">
              {person.name}
            </h3>

            {#if person.telephone}
              <p class="text-neutral-900">
                <span class="sr-only">Telefon:</span>
                <a
                  href="tel:{formatPhone(person.telephone)}"
                  class="font-semibold text-brand-800 tabular-nums underline decoration-neutral-300 underline-offset-4 hover:decoration-current"
                >
                  {person.telephone}
                </a>
              </p>
            {:else}
              <span class="hidden md:block" aria-hidden="true"></span>
            {/if}

            {#if person.street}
              <address class="text-neutral-700 not-italic">
                {person.street}
                {#if person.city}
                  <br />{person.city}
                {/if}
              </address>
            {/if}
          </div>
        </article>
      </li>
    {/each}
  </ul>
{:else}
  <p id="no-vorstand-heading" class="border-y border-neutral-200 py-6 text-neutral-700">
    Aktuell sind keine Vorstandsmitglieder eingetragen.
  </p>
{/if}
