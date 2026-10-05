<script lang="ts">
  import type { AbrechnungSession } from '../../lib/abrechnungStore.svelte';
  import { downloadTablePdf, pdfFileName } from '../../lib/abrechnungPdf';
  import { formatEventRange } from '../../lib/campflowFields';
  import { KJR_BETREUER_AGE, countKjrPersons, toKjrPerson } from '../../lib/kjrZuschuss';
  import type { Abrechnung, AbrechnungPerson } from '../../lib/types';
  import StatusNotice from '../pflege/StatusNotice.svelte';

  interface Props {
    abrechnung: Abrechnung;
    session: AbrechnungSession;
  }

  let { abrechnung, session }: Props = $props();

  const INPUT_CLASS =
    'mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:border-brand-900 focus:outline-none';
  const HERKUNFT_LABEL: Record<AbrechnungPerson['herkunft'], string> = {
    landkreis: 'LK Rosenheim',
    stadt: 'Stadt Rosenheim',
    andere: 'außerhalb',
    unbekannt: 'PLZ fehlt',
  };
  const GENDER_LABEL: Record<AbrechnungPerson['gender'], string> = {
    m: 'm',
    w: 'w',
    d: 'd',
    '': '–',
  };

  let newLastName = $state('');
  let newFirstName = $state('');
  let newGender = $state<AbrechnungPerson['gender']>('');
  let newAge = $state('');
  let newPlz = $state('');
  let formError = $state<string | null>(null);
  let pdfBusy = $state(false);
  let pdfError = $state<string | null>(null);

  const allPersons = $derived([...abrechnung.persons, ...session.extra]);
  const activePersons = $derived(allPersons.filter((p) => !session.excluded[p.id]));
  const counts = $derived(countKjrPersons(activePersons));
  const excludedCount = $derived(allPersons.length - activePersons.length);

  function isExtra(person: AbrechnungPerson): boolean {
    return person.id.startsWith('extra-');
  }

  function subsidised(person: AbrechnungPerson): boolean {
    return person.betreuer || person.herkunft === 'landkreis';
  }

  function role(person: AbrechnungPerson): string {
    if (person.age === null) return 'Alter fehlt';
    return person.betreuer ? 'Betreuer*in' : 'Teilnehmer*in';
  }

  function toggle(person: AbrechnungPerson, include: boolean): void {
    if (include) delete session.excluded[person.id];
    else session.excluded[person.id] = true;
  }

  function remove(person: AbrechnungPerson): void {
    session.extra = session.extra.filter((p) => p.id !== person.id);
    delete session.excluded[person.id];
  }

  function addPerson(): void {
    formError = null;
    const lastName = newLastName.trim();
    const firstName = newFirstName.trim();
    const plz = newPlz.trim();
    const age = newAge.trim() === '' ? null : Number(newAge);
    if (!lastName && !firstName) {
      formError = 'Bitte gib mindestens einen Namen an.';
      return;
    }
    if (age !== null && (!Number.isInteger(age) || age < 0 || age > 120)) {
      formError = 'Das Alter muss eine ganze Zahl zwischen 0 und 120 sein.';
      return;
    }
    if (plz && !/^\d{5}$/.test(plz)) {
      formError = 'Die Postleitzahl muss fünfstellig sein.';
      return;
    }
    session.extra = [
      ...session.extra,
      {
        id: `extra-${crypto.randomUUID()}`,
        ...toKjrPerson({ lastName, firstName, gender: newGender, age, plz }),
      },
    ];
    newLastName = newFirstName = newAge = newPlz = '';
    newGender = '';
  }

  async function exportPdf(): Promise<void> {
    pdfBusy = true;
    pdfError = null;
    try {
      await downloadTablePdf({
        title: `Teilnehmende – ${abrechnung.event.title}`,
        subtitle: `${formatEventRange(abrechnung.event)} · Kostenstelle „${abrechnung.costUnit.name}“`,
        notes: [
          `${counts.total} Personen in der Abrechnung: ${counts.under27} unter ${KJR_BETREUER_AGE} (Teilnehmende), ${counts.from27} ab ${KJR_BETREUER_AGE} (Betreuer*innen), ${counts.subsidised} bezuschusst.` +
            (excludedCount > 0 ? ` ${excludedCount} ausgeschlossen.` : '') +
            (session.extra.length > 0 ? ` ${session.extra.length} nachgetragen (*).` : ''),
        ],
        columns: [
          'Nr.',
          'Nachname',
          'Vorname',
          'm/w/d',
          'Alter',
          'PLZ',
          'Wohnort (KJR)',
          'Rolle',
          'Bezuschusst',
        ],
        rows: activePersons.map((person, index) => [
          String(index + 1),
          `${person.lastName}${isExtra(person) ? ' *' : ''}`,
          person.firstName,
          GENDER_LABEL[person.gender],
          person.age === null ? '–' : String(person.age),
          person.plz || '–',
          HERKUNFT_LABEL[person.herkunft],
          role(person),
          subsidised(person) ? 'ja' : 'nein',
        ]),
        alignRight: [0, 4],
        fileName: pdfFileName('Teilnehmende', abrechnung.event.title),
      });
    } catch {
      pdfError = 'Das PDF konnte nicht erstellt werden.';
    } finally {
      pdfBusy = false;
    }
  }
</script>

<div class="space-y-6">
  <section aria-labelledby="tn-liste-titel" class="surface p-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 id="tn-liste-titel" class="font-serif text-lg font-semibold text-brand-900">
          Teilnehmende der Abrechnung
        </h2>
        <p class="mt-1 text-sm text-neutral-700" data-testid="tn-zusammenfassung">
          {counts.total} von {allPersons.length} Personen werden abgerechnet: {counts.under27} unter
          {KJR_BETREUER_AGE}, {counts.from27} ab {KJR_BETREUER_AGE}, {counts.subsidised} bezuschusst.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        {#if excludedCount > 0}
          <button
            type="button"
            class="rounded-full border border-neutral-300 px-4 py-1.5 text-sm font-semibold text-brand-900 hover:border-brand-900"
            onclick={() => (session.excluded = {})}
          >
            Alle einbeziehen
          </button>
        {/if}
        <button
          type="button"
          class="rounded-full bg-[var(--color-dpsg-blue)] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
          disabled={pdfBusy || activePersons.length === 0}
          onclick={exportPdf}
        >
          {pdfBusy ? 'PDF wird erstellt …' : 'Als PDF herunterladen'}
        </button>
      </div>
    </div>
    <StatusNotice class="mt-3" kind="error" message={pdfError} />

    <div class="mt-4 overflow-x-auto">
      <table class="w-full min-w-[42rem] text-left text-sm">
        <thead
          class="border-b border-neutral-200 text-xs uppercase tracking-[0.06em] text-neutral-700"
        >
          <tr>
            <th scope="col" class="py-2 pr-2">Abrechnen</th>
            <th scope="col" class="py-2 pr-2">Name</th>
            <th scope="col" class="py-2 pr-2">m/w/d</th>
            <th scope="col" class="py-2 pr-2 text-right">Alter</th>
            <th scope="col" class="py-2 pr-2">PLZ</th>
            <th scope="col" class="py-2 pr-2">Wohnort (KJR)</th>
            <th scope="col" class="py-2 pr-2">Rolle</th>
            <th scope="col" class="py-2">Bezuschusst</th>
          </tr>
        </thead>
        <tbody>
          {#each allPersons as person (person.id)}
            {@const included = !session.excluded[person.id]}
            <tr class="border-b border-neutral-200 {included ? '' : 'text-neutral-500'}">
              <td class="py-2 pr-2">
                <input
                  type="checkbox"
                  class="h-4 w-4"
                  checked={included}
                  aria-label={`${person.firstName} ${person.lastName} abrechnen`}
                  onchange={(event) => toggle(person, event.currentTarget.checked)}
                />
              </td>
              <th scope="row" class="py-2 pr-2 font-normal">
                <span class={included ? 'text-brand-900' : 'line-through'}>
                  {person.lastName}{person.lastName && person.firstName
                    ? ', '
                    : ''}{person.firstName}
                </span>
                {#if isExtra(person)}
                  <span
                    class="ml-1 rounded-full bg-[#fff1e0] px-2 py-0.5 text-xs font-semibold text-[#8a4a00]"
                  >
                    nachgetragen
                  </span>
                  <button
                    type="button"
                    class="ml-1 text-xs font-semibold text-[var(--color-dpsg-red)] underline"
                    aria-label={`${person.firstName} ${person.lastName} entfernen`}
                    onclick={() => remove(person)}
                  >
                    entfernen
                  </button>
                {/if}
              </th>
              <td class="py-2 pr-2">{GENDER_LABEL[person.gender]}</td>
              <td class="py-2 pr-2 text-right tabular-nums">{person.age ?? '–'}</td>
              <td class="py-2 pr-2 tabular-nums">{person.plz || '–'}</td>
              <td class="py-2 pr-2">{HERKUNFT_LABEL[person.herkunft]}</td>
              <td class="py-2 pr-2">{role(person)}</td>
              <td class="py-2">{subsidised(person) ? 'ja' : 'nein'}</td>
            </tr>
          {:else}
            <tr>
              <td colspan="8" class="py-3 text-neutral-600">
                In CampFlow gibt es keine bestätigten Anmeldungen.
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <section aria-labelledby="tn-nachtragen-titel" class="surface p-6">
    <h2 id="tn-nachtragen-titel" class="font-serif text-lg font-semibold text-brand-900">
      Person nachtragen
    </h2>
    <p class="mt-1 text-sm text-neutral-700">
      Für Personen, die mit abgerechnet werden, aber nicht in CampFlow angemeldet sind. Sie zählen
      in der Übersicht und stehen in der KJR-Teilnahmeliste.
    </p>
    <form
      class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_8rem_6rem_8rem_auto] lg:items-end"
      onsubmit={(event) => {
        event.preventDefault();
        addPerson();
      }}
    >
      <label class="block text-sm">
        <span class="font-semibold text-neutral-700">Nachname</span>
        <input bind:value={newLastName} maxlength="100" autocomplete="off" class={INPUT_CLASS} />
      </label>
      <label class="block text-sm">
        <span class="font-semibold text-neutral-700">Vorname</span>
        <input bind:value={newFirstName} maxlength="100" autocomplete="off" class={INPUT_CLASS} />
      </label>
      <label class="block text-sm">
        <span class="font-semibold text-neutral-700">Geschlecht</span>
        <select bind:value={newGender} class={INPUT_CLASS}>
          <option value="">–</option>
          <option value="w">weiblich</option>
          <option value="m">männlich</option>
          <option value="d">divers</option>
        </select>
      </label>
      <label class="block text-sm">
        <span class="font-semibold text-neutral-700">Alter</span>
        <input
          bind:value={newAge}
          inputmode="numeric"
          maxlength="3"
          autocomplete="off"
          class={INPUT_CLASS}
        />
      </label>
      <label class="block text-sm">
        <span class="font-semibold text-neutral-700">PLZ</span>
        <input
          bind:value={newPlz}
          inputmode="numeric"
          maxlength="5"
          autocomplete="off"
          class={INPUT_CLASS}
        />
      </label>
      <button
        type="submit"
        class="rounded-full bg-[var(--color-dpsg-blue)] px-5 py-2 text-sm font-semibold text-white"
      >
        Hinzufügen
      </button>
    </form>
    <StatusNotice class="mt-3" kind="error" message={formError} />
  </section>
</div>
