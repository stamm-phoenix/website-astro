<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import PersonSuche from '../ui/PersonSuche.svelte';
  import FormField from '../pflege/FormField.svelte';
  import PersonenAuswahl from './PersonenAuswahl.svelte';
  import {
    MAX_PROTOKOLLANT,
    MAX_SITZUNGSLEITUNG,
    PERSON_GRUPPE_LABELS,
    currentTime,
    personKey,
  } from '../../lib/protokollEditor';
  import type {
    PersonOption,
    ProtokollAnwesenheit,
    ProtokollKopf,
    ProtokollPerson,
  } from '../../lib/types';

  interface Props {
    kopf: ProtokollKopf;
    personen: PersonOption[];
    /** The directory could not be read; names can still be added by hand. */
    personenUnavailable: boolean;
  }
  let { kopf = $bindable(), personen, personenUnavailable }: Props = $props();

  let extraName = $state('');

  /**
   * Everyone to tick: the leaders of the directory plus whoever was added (Altleitende, guests,
   * names no longer in the directory).
   */
  const liste = $derived.by(() => {
    const result: ProtokollPerson[] = personen.filter((p) => p.gruppe === 'leitende');
    for (const person of kopf.teilnehmende) {
      if (!result.some((p) => key(p) === key(person))) result.push(person);
    }
    return result.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  });
  const anwesend = $derived(kopf.teilnehmende.filter((p) => p.status === 'anwesend').length);
  const entschuldigt = $derived(
    kopf.teilnehmende.filter((p) => p.status === 'entschuldigt').length
  );

  const key = personKey;

  /** People to add as present: everyone of the list not yet recorded. */
  const weitere = $derived(
    personen
      .filter((p) => statusOf(p) === null)
      .map((p) => ({ login: p.login, name: p.name, gruppe: PERSON_GRUPPE_LABELS[p.gruppe] }))
  );

  function statusOf(person: ProtokollPerson): ProtokollAnwesenheit | null {
    return kopf.teilnehmende.find((p) => key(p) === key(person))?.status ?? null;
  }

  /** Sets the status; choosing the current one again clears it. */
  function setStatus(person: ProtokollPerson, status: ProtokollAnwesenheit): void {
    const index = kopf.teilnehmende.findIndex((p) => key(p) === key(person));
    if (index >= 0 && kopf.teilnehmende[index].status === status) {
      kopf.teilnehmende.splice(index, 1);
    } else if (index >= 0) {
      kopf.teilnehmende[index].status = status;
    } else {
      kopf.teilnehmende.push({ login: person.login, name: person.name, status });
    }
  }

  function addPresent(person: ProtokollPerson): void {
    if (statusOf(person) === null) setStatus(person, 'anwesend');
  }

  /** A typed name; one of the list brings its login along. */
  function addExtra(text = extraName): void {
    const name = text.trim().replace(/\s+/g, ' ');
    extraName = '';
    if (!name) return;
    const match = personen.find(
      (p) => p.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de')
    );
    addPresent(match ? { login: match.login, name: match.name } : { login: '', name });
  }
</script>

<section class="space-y-4" aria-labelledby="kopf-titel">
  <h2 id="kopf-titel" class="font-serif text-xl text-brand-900">Kopfdaten</h2>

  <div class="grid gap-4 sm:grid-cols-2">
    <FormField id="kopf-leitung" label="Sitzungsleitung">
      {#snippet children(attrs)}
        <PersonenAuswahl
          {...attrs}
          bind:selected={kopf.sitzungsleitung}
          {personen}
          max={MAX_SITZUNGSLEITUNG}
          listLabel="Sitzungsleitung"
        />
      {/snippet}
    </FormField>
    <FormField id="kopf-protokoll" label="Protokoll">
      {#snippet children(attrs)}
        <PersonenAuswahl
          {...attrs}
          bind:selected={kopf.protokollant}
          {personen}
          max={MAX_PROTOKOLLANT}
          listLabel="Protokoll"
        />
      {/snippet}
    </FormField>
    <FormField id="kopf-beginn" label="Sitzungsbeginn">
      {#snippet children(attrs)}
        <div class="flex gap-2">
          <input {...attrs} type="time" class="form-input" bind:value={kopf.beginn} />
          <ActionButton onclick={() => (kopf.beginn = currentTime())}>Jetzt</ActionButton>
        </div>
      {/snippet}
    </FormField>
    <FormField id="kopf-ende" label="Sitzungsende">
      {#snippet children(attrs)}
        <div class="flex gap-2">
          <input {...attrs} type="time" class="form-input" bind:value={kopf.ende} />
          <ActionButton onclick={() => (kopf.ende = currentTime())}>Jetzt</ActionButton>
        </div>
      {/snippet}
    </FormField>
  </div>

  <fieldset class="space-y-3">
    <legend class="form-label">
      Teilnehmende
      <span class="font-normal text-neutral-700">
        ({anwesend} anwesend{entschuldigt ? `, ${entschuldigt} entschuldigt` : ''})
      </span>
    </legend>
    {#if personenUnavailable}
      <p class="text-sm text-warning">
        Die Liste der Personen konnte nicht vollständig geladen werden. Namen lassen sich weiter von
        Hand eintragen.
      </p>
    {/if}
    {#if liste.length > 0}
      <ul class="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {#each liste as person (key(person))}
          {@const status = statusOf(person)}
          <li class="flex items-center justify-between gap-2 border-b border-neutral-200 py-1">
            <span class="min-w-0 truncate" class:text-neutral-700={status === null}
              >{person.name}</span
            >
            <span class="flex shrink-0 gap-1" role="group" aria-label="Anwesenheit {person.name}">
              <button
                type="button"
                class="status is-da"
                aria-pressed={status === 'anwesend'}
                onclick={() => setStatus(person, 'anwesend')}
                ><span class="mark" aria-hidden="true">{status === 'anwesend' ? '✓' : ''}</span
                >da</button
              >
              <button
                type="button"
                class="status is-entschuldigt"
                aria-pressed={status === 'entschuldigt'}
                onclick={() => setStatus(person, 'entschuldigt')}
                ><span class="mark" aria-hidden="true">{status === 'entschuldigt' ? '✓' : ''}</span
                >entsch.</button
              >
            </span>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="flex max-w-md items-end gap-2">
      <div class="min-w-0 flex-1">
        <label for="kopf-weitere" class="form-label">Weitere Person</label>
        <PersonSuche
          id="kopf-weitere"
          bind:query={extraName}
          options={weitere}
          maxlength={200}
          placeholder="Name suchen oder eingeben …"
          onpick={(person) => addPresent({ login: person.login, name: person.name })}
          oncommit={addExtra}
        />
      </div>
      <ActionButton onclick={() => addExtra()} disabled={!extraName.trim()}>Hinzufügen</ActionButton
      >
    </div>
  </fieldset>

  <FormField id="kopf-externe" label="Externe" optional>
    {#snippet children(attrs)}
      <textarea {...attrs} class="form-input" rows="2" maxlength="2000" bind:value={kopf.externe}
      ></textarea>
    {/snippet}
  </FormField>
</section>

<style>
  /* Square toggles like the Anwesenheit of the Gruppenstunden */
  .status {
    display: inline-flex;
    min-height: calc(var(--spacing) * 11);
    align-items: center;
    gap: calc(var(--spacing) * 1.6);
    border: 1px solid var(--color-neutral-300);
    padding: 0 calc(var(--spacing) * 2.4) 0 calc(var(--spacing) * 1.8);
    font-size: 0.875rem;
    color: var(--color-neutral-700);
  }
  .mark {
    display: inline-flex;
    width: 1.25rem;
    height: 1.25rem;
    flex: none;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--color-neutral-300);
  }
  .status[aria-pressed='true'] {
    font-weight: 600;
    color: var(--color-brand-900);
  }
  .is-da[aria-pressed='true'],
  .is-da[aria-pressed='true'] .mark {
    border-color: var(--color-success);
  }
  .is-da .mark {
    color: var(--color-success);
  }
  .is-entschuldigt[aria-pressed='true'],
  .is-entschuldigt[aria-pressed='true'] .mark {
    border-color: var(--color-warning);
  }
  .is-entschuldigt .mark {
    color: var(--color-warning);
  }
</style>
