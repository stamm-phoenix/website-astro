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

<div class="grid gap-6 md:grid-cols-2">
  {#if vorstandStore.loading}
    <div role="status" aria-live="polite" class="sr-only">Vorstandsdaten werden geladen...</div>
    {#each [1, 2] as i (i)}
      <article class="skeleton-card surface p-6">
        <div class="flex items-start gap-5">
          <div class="skeleton-element w-20 h-20 rounded-full flex-shrink-0"></div>
          <div class="flex-1 space-y-3">
            <div class="skeleton-element h-6 w-36 rounded"></div>
            <div class="skeleton-element h-4 w-32 rounded"></div>
            <div class="skeleton-element h-4 w-44 rounded"></div>
            <div class="skeleton-element h-4 w-48 rounded"></div>
          </div>
        </div>
      </article>
    {/each}
  {:else if vorstandStore.error}
    <div class="md:col-span-2">
      <article
        role="alert"
        class="surface p-6 border-l-4 border-l-[var(--color-dpsg-red)]"
        aria-labelledby="vorstand-error-heading"
      >
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
            <h3
              id="vorstand-error-heading"
              class="text-lg font-semibold text-[var(--color-brand-900)]"
            >
              Daten konnten nicht geladen werden
            </h3>
            <p class="mt-1 text-sm text-[var(--color-neutral-700)]">
              Die Vorstandsdaten konnten leider nicht abgerufen werden. Bitte versuche es später
              erneut.
            </p>
          </div>
        </div>
      </article>
    </div>
  {:else if (vorstandStore.data?.length ?? 0) > 0}
    {#each vorstandStore.data as person (person.id)}
      <article
        class="vorstand-card surface p-6 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift"
        aria-labelledby="vorstand-heading-{person.id}"
      >
        <div class="flex items-start gap-5">
          <div class="flex-shrink-0">
            <LeaderAvatar id={person.id} name={person.name} hasImage={person.hasImage} size="lg" />
          </div>

          <div class="flex-1 min-w-0">
            <h3
              id="vorstand-heading-{person.id}"
              class="text-lg font-semibold text-[var(--color-brand-900)]"
            >
              {person.name}
            </h3>

            <div class="mt-3 space-y-2">
              {#if person.telephone}
                <div class="contact-row">
                  <div class="contact-icon">
                    <svg
                      aria-hidden="true"
                      class="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                      />
                    </svg>
                  </div>
                  <a href="tel:{formatPhone(person.telephone)}" class="contact-link">
                    {person.telephone}
                  </a>
                </div>
              {/if}

              {#if person.street}
                <div class="contact-row">
                  <div class="contact-icon">
                    <svg
                      aria-hidden="true"
                      class="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                      />
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                  </div>
                  <div class="text-sm text-[var(--color-neutral-800)]">
                    <div>{person.street}</div>
                    {#if person.city}
                      <div>{person.city}</div>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
          </div>
        </div>
      </article>
    {/each}
  {:else}
    <div class="md:col-span-2">
      <article class="surface p-6" aria-labelledby="no-vorstand-heading">
        <p id="no-vorstand-heading" class="text-[var(--color-neutral-700)]">
          Aktuell sind keine Vorstandsmitglieder eingetragen.
        </p>
      </article>
    </div>
  {/if}
</div>

<style>
  .contact-row {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .contact-icon {
    flex-shrink: 0;
    width: 1.75rem;
    height: 1.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-brand-50);
    border-radius: 0.375rem;
    color: var(--color-brand-700);
  }

  .contact-link {
    font-size: 0.875rem;
    color: var(--color-brand-800);
    font-weight: 500;
    text-decoration: none;
    transition: color 0.15s ease;
  }

  .contact-link:hover {
    color: var(--color-dpsg-red);
    text-decoration: underline;
  }
</style>
