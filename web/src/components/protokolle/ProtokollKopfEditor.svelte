<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { currentTime } from '../../lib/protokollEditor';
  import type { ProtokollAnwesenheit, ProtokollKopf, ProtokollPerson } from '../../lib/types';

  interface Props {
    kopf: ProtokollKopf;
    personen: ProtokollPerson[];
    /** The directory could not be read; names can still be added by hand. */
    personenUnavailable: boolean;
  }
  let { kopf = $bindable(), personen, personenUnavailable }: Props = $props();

  let extraName = $state('');

  /** Everyone to tick: the directory plus names added by hand or no longer in it. */
  const liste = $derived.by(() => {
    const result: ProtokollPerson[] = [...personen];
    for (const person of kopf.teilnehmende) {
      if (!result.some((p) => key(p) === key(person))) result.push(person);
    }
    return result.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  });
  const anwesend = $derived(kopf.teilnehmende.filter((p) => p.status === 'anwesend').length);
  const entschuldigt = $derived(
    kopf.teilnehmende.filter((p) => p.status === 'entschuldigt').length
  );

  function key(person: ProtokollPerson): string {
    return person.login ? person.login.toLowerCase() : `name:${person.name.toLowerCase()}`;
  }

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

  function addExtra(): void {
    const name = extraName.trim().replace(/\s+/g, ' ');
    if (!name) return;
    const person = personen.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? {
      login: '',
      name,
    };
    if (statusOf(person) === null) setStatus(person, 'anwesend');
    extraName = '';
  }
</script>

<section class="space-y-4" aria-labelledby="kopf-titel">
  <h2 id="kopf-titel" class="font-serif text-xl text-brand-900">Kopfdaten</h2>

  <div class="grid gap-4 sm:grid-cols-2">
    <FormField id="kopf-leitung" label="Sitzungsleitung">
      {#snippet children(attrs)}
        <input
          {...attrs}
          type="text"
          class="form-input"
          maxlength="200"
          bind:value={kopf.sitzungsleitung}
        />
      {/snippet}
    </FormField>
    <FormField id="kopf-protokoll" label="Protokoll">
      {#snippet children(attrs)}
        <input
          {...attrs}
          type="text"
          class="form-input"
          maxlength="200"
          bind:value={kopf.protokollant}
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
        Die Liste der Leitenden konnte nicht geladen werden. Namen lassen sich unten von Hand
        eintragen.
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
                class="chip"
                aria-pressed={status === 'anwesend'}
                onclick={() => setStatus(person, 'anwesend')}>da</button
              >
              <button
                type="button"
                class="chip"
                aria-pressed={status === 'entschuldigt'}
                onclick={() => setStatus(person, 'entschuldigt')}>entsch.</button
              >
            </span>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="flex max-w-md gap-2">
      <label for="kopf-weitere" class="sr-only">Weitere Person als anwesend eintragen</label>
      <input
        id="kopf-weitere"
        type="text"
        class="form-input"
        placeholder="Weitere Person eintragen"
        bind:value={extraName}
        onkeydown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            addExtra();
          }
        }}
      />
      <ActionButton onclick={addExtra} disabled={!extraName.trim()}>Hinzufügen</ActionButton>
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
  .chip {
    min-height: 2rem;
    border: 1px solid var(--color-neutral-300);
    border-radius: 999px;
    padding: 0 0.6rem;
    font-size: 0.8125rem;
    color: var(--color-neutral-700);
  }
  .chip[aria-pressed='true'] {
    border-color: var(--color-action);
    background: var(--color-action);
    color: var(--color-on-action);
    font-weight: 600;
  }
</style>
