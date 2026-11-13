<script lang="ts">
  import { onMount } from 'svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import ReloadAction from '../ui/ReloadAction.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import NamiAbgleichPaar from './NamiAbgleichPaar.svelte';
  import { namiAbgleichStore } from '../../lib/pflegeStore.svelte';
  import {
    ANSICHTEN,
    anzahl,
    paareIn,
    personenIn,
    personName,
    type AbgleichPerson,
    type NamiAbgleichAnsicht,
    type NamiAbgleichData,
  } from '../../lib/namiAbgleich';

  const NAMI_URL = 'https://nami.dpsg.de/ica/pages/login.jsp';
  const CAMPFLOW_URL = 'https://my.campflow.de/dpsg-stamm-phoenix-5629/members';
  const LEER: Record<NamiAbgleichAnsicht, string> = {
    unterschiede: 'Keine Unterschiede gefunden.',
    'nur-nami': 'Alle aus NaMi stehen auch in CampFlow.',
    'nur-campflow': 'Alle aus CampFlow stehen auch in NaMi.',
    gleich: 'Niemand stimmt in allen Angaben überein.',
  };

  const store = namiAbgleichStore.state;
  let ansicht = $state<NamiAbgleichAnsicht>('unterschiede');
  let suche = $state('');
  let ausgetretene = $state(false);
  let refreshed = $state('');
  const filter = $derived({ suche, ausgetretene });

  async function refresh(): Promise<void> {
    refreshed = '';
    await namiAbgleichStore.refresh();
    if (!store.error) refreshed = 'NaMi und CampFlow neu geladen.';
  }

  onMount(() => {
    // The store outlives a change of page; a result older than a minute is asked for again and
    // stays shown until the answer is there
    void namiAbgleichStore.load({ maxAge: 60_000 });
  });

  function tabs(data: NamiAbgleichData) {
    return ANSICHTEN.map((option) => ({ ...option, count: anzahl(data, option.value, filter) }));
  }

  /** The note of an empty view; it never claims agreement while former members are hidden. */
  function leer(data: NamiAbgleichData): string {
    if (suche.trim()) return 'Niemand passt zur Suche.';
    if (!ausgetretene && anzahl(data, ansicht, { suche, ausgetretene: true }) > 0) {
      return 'Hier stehen nur Ausgetretene. Setze das Häkchen bei „Ausgetretene zeigen“.';
    }
    return LEER[ansicht];
  }

  function geburtstag(person: AbgleichPerson): string {
    if (!person.geburtsdatum) return '';
    const [year, month, day] = person.geburtsdatum.split('-');
    return `geb. ${day}.${month}.${year}`;
  }
</script>

<div class="space-y-5">
  <div
    class="flex flex-col gap-2 border-b border-neutral-200 pb-4 text-sm text-neutral-700 sm:flex-row sm:items-center sm:justify-between"
  >
    <span class="flex flex-wrap gap-x-5">
      <a
        href={NAMI_URL}
        class="inline-flex min-h-11 items-center text-link underline underline-offset-4"
        target="_blank"
        rel="noopener">NaMi öffnen</a
      >
      <a
        href={CAMPFLOW_URL}
        class="inline-flex min-h-11 items-center text-link underline underline-offset-4"
        target="_blank"
        rel="noopener">Mitglieder in CampFlow öffnen</a
      >
    </span>
    {#if store.data}
      <ReloadAction
        loadedAt={Date.parse(store.data.namiLoadedAt)}
        disabled={store.loading}
        onclick={refresh}
      >
        {store.loading ? 'Lädt … (bis zu 30 Sekunden)' : 'Neu aus NaMi und CampFlow laden'}
      </ReloadAction>
    {/if}
  </div>
  <p role="status" aria-live="polite" class="text-sm font-semibold text-success empty:hidden">
    {refreshed}
  </p>

  <LoadState
    data={store.data}
    loading={store.loading}
    error={store.error}
    loadingText="NaMi und CampFlow werden gelesen. Das kann bis zu 30 Sekunden dauern …"
    onretry={() => namiAbgleichStore.load({ force: true })}
  >
    {#snippet children(data: NamiAbgleichData)}
      {@const options = tabs(data)}
      <section aria-labelledby="nami-abgleich-liste" class="space-y-4">
        <h2 id="nami-abgleich-liste" class="sr-only">Abgleich</h2>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-6">
          <label class="block w-full text-sm sm:w-80">
            <span class="font-semibold text-neutral-700">Suche</span>
            <input
              type="search"
              bind:value={suche}
              placeholder="Name oder Mitgliedsnummer"
              class="form-input mt-1 w-full"
            />
          </label>
          <label class="inline-flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" class="h-5 w-5" bind:checked={ausgetretene} />
            Ausgetretene zeigen
          </label>
        </div>
        <label class="block w-full text-sm sm:hidden">
          <span class="font-semibold text-neutral-700">Ansicht</span>
          <select
            class="form-input mt-1 w-full"
            value={ansicht}
            onchange={(event) => (ansicht = event.currentTarget.value as NamiAbgleichAnsicht)}
          >
            {#each options as option (option.value)}
              <option value={option.value}>{option.label} ({option.count})</option>
            {/each}
          </select>
        </label>
        <div class="hidden sm:block">
          <FilterTabs
            label="Ansicht wählen"
            {options}
            value={ansicht}
            onselect={(value) => (ansicht = value)}
            countNouns={['Person', 'Personen']}
          />
        </div>

        {#if ansicht === 'unterschiede' || ansicht === 'gleich'}
          {@const paare = paareIn(data, ansicht, filter)}
          {#if paare.length === 0}
            <p class="surface p-6 text-sm text-neutral-700">
              {leer(data)}
            </p>
          {:else}
            <ul
              class="divide-y divide-neutral-200 border-y border-neutral-200"
              aria-label="Personen in beiden Listen"
            >
              {#each paare as paar (`${paar.nami.id}|${paar.campflow.id}`)}
                <NamiAbgleichPaar {paar} />
              {/each}
            </ul>
          {/if}
        {:else}
          {@const personen = personenIn(data, ansicht, filter)}
          {#if personen.length === 0}
            <p class="surface p-6 text-sm text-neutral-700">
              {leer(data)}
            </p>
          {:else}
            <ul
              class="divide-y divide-neutral-200 border-y border-neutral-200"
              aria-label={ansicht === 'nur-nami' ? 'Nur in NaMi' : 'Nur in CampFlow'}
            >
              {#each personen as person (person.id)}
                <li
                  class="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                >
                  <span class="min-w-0">
                    <span class="block font-semibold text-brand-900">{personName(person)}</span>
                    <span class="block text-sm text-neutral-700">
                      {[
                        geburtstag(person),
                        person.mitgliedsnummer && `Mitgliedsnummer ${person.mitgliedsnummer}`,
                        person.gruppen.join(', '),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {#if !person.aktiv}
                    <span class="shrink-0 text-sm"><StatusLabel label="Ausgetreten" /></span>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      </section>
    {/snippet}
  </LoadState>
</div>
