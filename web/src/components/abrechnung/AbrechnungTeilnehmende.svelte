<script lang="ts">
  import { abrechnungPersonen } from '../../lib/abrechnungStore.svelte';
  import type { AbrechnungSession } from '../../lib/abrechnungStore.svelte';
  import { downloadTablePdf, pdfFileName } from '../../lib/abrechnungPdf';
  import { formatEventRange } from '../../lib/campflowFields';
  import {
    KJR_BETREUER_AGE,
    countKjrPersons,
    isKjrBetreuerAge,
    toKjrPerson,
  } from '../../lib/kjrZuschuss';
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

  const allPersons = $derived(abrechnungPersonen(abrechnung, session));
  /** Like the KJR's list: Betreuer*innen first, then Teilnehmende, each by name. */
  const groups = $derived.by(() => {
    const byName = (a: AbrechnungPerson, b: AbrechnungPerson): number =>
      a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de');
    const sorted = [...allPersons].sort(byName);
    return [
      { id: 'betreuer', title: 'Betreuer*innen', persons: sorted.filter((p) => p.betreuer) },
      { id: 'teilnehmende', title: 'Teilnehmende', persons: sorted.filter((p) => !p.betreuer) },
    ];
  });
  const activePersons = $derived(
    groups.flatMap((g) => g.persons).filter((p) => !session.excluded[p.id])
  );
  const counts = $derived(countKjrPersons(activePersons));
  const excludedCount = $derived(allPersons.length - activePersons.length);

  function isExtra(person: AbrechnungPerson): boolean {
    return person.id.startsWith('extra-');
  }

  function subsidised(person: AbrechnungPerson): boolean {
    return person.betreuer || person.herkunft === 'landkreis';
  }

  function role(person: AbrechnungPerson): string {
    if (person.betreuer) return 'Betreuer*in';
    return person.age === null ? 'Teilnehmer*in (Alter fehlt)' : 'Teilnehmer*in';
  }

  /** Under 27 the role can be chosen; from 27 on the KJR only accepts Betreuer*innen. */
  function setBetreuer(person: AbrechnungPerson, betreuer: boolean): void {
    if (betreuer) session.betreuer[person.id] = true;
    else delete session.betreuer[person.id];
  }

  function toggle(person: AbrechnungPerson, include: boolean): void {
    if (include) delete session.excluded[person.id];
    else session.excluded[person.id] = true;
  }

  const changed = $derived(
    Object.keys(session.excluded).length > 0 ||
      session.extra.length > 0 ||
      Object.keys(session.betreuer).length > 0
  );

  /** Back to the registrations from CampFlow: no exclusions, added persons or chosen roles. */
  function reset(): void {
    if (
      !window.confirm(
        'Teilnehmendenliste zurücksetzen? Ausschlüsse, nachgetragene Personen und gewählte Rollen gehen verloren.'
      )
    ) {
      return;
    }
    session.excluded = {};
    session.extra = [];
    session.betreuer = {};
  }

  function remove(person: AbrechnungPerson): void {
    session.extra = session.extra.filter((p) => p.id !== person.id);
    delete session.excluded[person.id];
    delete session.betreuer[person.id];
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
          `${counts.total} Personen in der Abrechnung: ${counts.teilnehmende} Teilnehmende, ${counts.betreuende} Betreuer*innen (${counts.ab27} ab ${KJR_BETREUER_AGE}), ${counts.subsidised} bezuschusst.` +
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
          {counts.total} von {allPersons.length} Personen werden abgerechnet: {counts.teilnehmende}
          Teilnehmende, {counts.betreuende} Betreuer*innen ({counts.ab27} ab {KJR_BETREUER_AGE}),
          {counts.subsidised} bezuschusst.
        </p>
        <p class="mt-1 text-sm text-neutral-700">
          Ab {KJR_BETREUER_AGE} Jahren ist jede*r für den KJR Betreuer*in. Jüngere Leitende lassen sich
          in der Spalte „Rolle“ als Betreuer*in eintragen.
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
        {#if changed}
          <button
            type="button"
            class="rounded-full border border-neutral-300 px-4 py-1.5 text-sm font-semibold text-brand-900 hover:border-brand-900"
            onclick={reset}
          >
            Zurücksetzen
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
        {#if allPersons.length === 0}
          <tbody>
            <tr>
              <td colspan="8" class="py-3 text-neutral-600">
                In CampFlow gibt es keine bestätigten Anmeldungen.
              </td>
            </tr>
          </tbody>
        {:else}
          {#each groups as group, index (group.id)}
            <tbody data-testid={`tn-gruppe-${group.id}`}>
              <tr class={index > 0 ? 'border-t-2 border-brand-900' : ''}>
                <th
                  scope="colgroup"
                  colspan="8"
                  class="pt-4 pb-1 text-xs font-semibold uppercase tracking-[0.06em] text-brand-900"
                >
                  {group.title} ({group.persons.length})
                </th>
              </tr>
              {#each group.persons as person (person.id)}
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
                  <td class="py-2 pr-2">
                    {#if isKjrBetreuerAge(person.age)}
                      <span title={`Ab ${KJR_BETREUER_AGE} Jahren immer Betreuer*in`}
                        >Betreuer*in</span
                      >
                    {:else}
                      <select
                        class="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm focus:border-brand-900 focus:outline-none"
                        value={person.betreuer ? 'betreuer' : 'teilnehmer'}
                        aria-label={`Rolle ${person.firstName} ${person.lastName}`}
                        onchange={(event) =>
                          setBetreuer(person, event.currentTarget.value === 'betreuer')}
                      >
                        <option value="teilnehmer">Teilnehmer*in</option>
                        <option value="betreuer">Betreuer*in</option>
                      </select>
                    {/if}
                  </td>
                  <td class="py-2">{subsidised(person) ? 'ja' : 'nein'}</td>
                </tr>
              {:else}
                <tr>
                  <td colspan="8" class="py-2 text-neutral-600">
                    {group.id === 'betreuer'
                      ? `Noch keine Betreuer*innen. Jüngere Leitende über die Spalte „Rolle“ eintragen.`
                      : 'Keine Teilnehmenden.'}
                  </td>
                </tr>
              {/each}
            </tbody>
          {/each}
        {/if}
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
