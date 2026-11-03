<script lang="ts">
  import { onMount } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { ApiError, errorMessage } from '../../lib/api';
  import type { PlanungMitglied } from '../../lib/types';
  import type { PlanKontext } from './planKontext';

  /**
   * Invites a Leitende:r of the Stamm with one click. The list only comes while the person is
   * also logged in to the Leitendenbereich with an address of the Stamm
   * (`api/endpoints/essensplanung-leitende.ts`); for everyone else this part stays hidden.
   */

  interface Person {
    name: string;
    email: string;
  }

  interface Props {
    kontext: PlanKontext;
    /** Members with access; their addresses are marked as already there. */
    mitglieder: PlanungMitglied[];
    einladen: (person: Person) => Promise<boolean>;
  }
  let { kontext, mitglieder, einladen }: Props = $props();

  let leitende = $state<Person[] | null>(null);
  let fehler = $state<string | null>(null);
  let suche = $state('');
  let laeuft = $state<string | null>(null);

  const dabei = $derived(
    new Set(mitglieder.map((mitglied) => mitglied.email?.toLowerCase()).filter(Boolean))
  );
  const treffer = $derived.by(() => {
    const begriff = suche.trim().toLowerCase();
    return (leitende ?? []).filter(
      (person) =>
        !begriff || person.name.toLowerCase().includes(begriff) || person.email.includes(begriff)
    );
  });

  async function laden(signal?: AbortSignal): Promise<void> {
    fehler = null;
    try {
      leitende = (await kontext.api.leitende(signal)).leitende;
    } catch (error: unknown) {
      if (signal?.aborted) return;
      // Not logged in, no address of the Stamm or no right to invite: nothing to show
      if (error instanceof ApiError && [401, 403].includes(error.status)) return;
      fehler = errorMessage(
        error,
        'Die Liste der Leitenden konnte nicht geladen werden. Lade die Person per Mail ein.'
      );
    }
  }

  onMount(() => {
    const controller = new AbortController();
    void laden(controller.signal);
    return () => controller.abort();
  });

  async function klick(person: Person): Promise<void> {
    laeuft = person.email;
    try {
      await einladen(person);
    } finally {
      laeuft = null;
    }
  }
</script>

{#if leitende || fehler}
  <section aria-labelledby="leitende-heading" class="surface space-y-4 p-5 print:hidden">
    <h3 id="leitende-heading" class="font-serif text-xl font-bold text-brand-900">
      Leitende einladen
    </h3>
    {#if fehler}
      <p class="text-sm text-danger" role="alert">{fehler}</p>
      <ActionButton type="button" onclick={() => void laden()}>Erneut versuchen</ActionButton>
    {:else}
      <label class="block max-w-sm">
        <span class="mb-1 block text-sm font-semibold text-neutral-800">Name suchen</span>
        <input type="search" class="form-input" placeholder="z. B. Anna" bind:value={suche} />
      </label>
      {#if treffer.length}
        <ul
          class="max-h-80 divide-y divide-neutral-200 overflow-y-auto border-y border-neutral-200"
          aria-label="Leitende"
        >
          {#each treffer as person (person.email)}
            <li class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
              <span class="min-w-0">
                <span class="block font-semibold text-brand-900">{person.name}</span>
                <span class="block text-sm break-all text-neutral-700">{person.email}</span>
              </span>
              {#if dabei.has(person.email)}
                <span class="text-sm text-neutral-700">schon dabei</span>
              {:else}
                <ActionButton
                  type="button"
                  disabled={kontext.busy || laeuft !== null}
                  aria-label="{person.name} einladen"
                  onclick={() => void klick(person)}
                  >{laeuft === person.email ? 'Wird eingeladen …' : 'Einladen'}</ActionButton
                >
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-sm text-neutral-700">Niemand gefunden.</p>
      {/if}
    {/if}
  </section>
{/if}
