<script lang="ts">
  import FormField from '../pflege/FormField.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import { authStore, isOwnName } from '../../lib/authStore.svelte';
  import { abrechnungPersonen } from '../../lib/abrechnungStore.svelte';
  import { loadPlzOrte, plzOrteStore } from '../../lib/plzOrte.svelte';
  import type { AbrechnungSession } from '../../lib/abrechnungStore.svelte';
  import { downloadTablePdf, pdfFileName } from '../../lib/abrechnungPdf';
  import { zuschussGrund } from '../../lib/abrechnungRechnung';
  import { formatEventRange } from '../../lib/campflowFields';
  import {
    KJR_BETREUER_AGE,
    countKjrPersons,
    isKjrBetreuerAge,
    toKjrPerson,
  } from '../../lib/kjrZuschuss';
  import type { Abrechnung, AbrechnungPerson } from '../../lib/types';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import Toast from '../ui/Toast.svelte';
  import { tick } from 'svelte';
  import { confirmAction } from '../../lib/confirm';

  interface Props {
    abrechnung: Abrechnung;
    session: AbrechnungSession;
    /** Opens the Übersicht at the KJR's Teilnahmeliste. */
    onShowKjrListe: () => void;
  }

  let { abrechnung, session, onShowKjrListe }: Props = $props();

  // The Ort of a changed Postleitzahl or an added person comes from the table of Postleitzahlen
  $effect(() => {
    if (session.extra.length > 0 || Object.keys(session.plz).length > 0) void loadPlzOrte();
  });

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
  let formErrors = $state<Record<string, string>>({});
  /** Confirmation for changes whose result is out of view; `rowId` offers a jump to the row. */
  let notice = $state<{ text: string; rowId?: string } | null>(null);
  let lastNameInput = $state<HTMLInputElement | null>(null);
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
  /** Without KJR grant nobody is subsidised: no column, no KJR list. */
  const zuschussfaehig = $derived(abrechnung.event.zuschussfaehig);
  const columnCount = $derived(zuschussfaehig ? 8 : 7);
  const excludedCount = $derived(allPersons.length - activePersons.length);

  function isExtra(person: AbrechnungPerson): boolean {
    return person.id.startsWith('extra-');
  }

  /** The Postleitzahl from CampFlow or entered when adding the person. */
  const originalPlz = $derived(
    new Map([...abrechnung.persons, ...session.extra].map((p) => [p.id, p.plz]))
  );

  function fullName(person: AbrechnungPerson): string {
    return `${person.firstName} ${person.lastName}`.trim();
  }

  // The empty string is a valid editing state until the field loses focus.
  let plzInputs = $state<Record<string, string>>({});
  let plzSource: AbrechnungSession['plz'] | undefined;
  // Taking over another tab replaces the map; own input only changes its entries.
  $effect(() => {
    if (plzSource === session.plz) return;
    plzSource = session.plz;
    plzInputs = {};
  });

  /** Overrides the Postleitzahl; empty or the original value goes back to the original. */
  function setPlz(person: AbrechnungPerson, value: string): void {
    plzInputs[person.id] = value;
    const plz = value.trim();
    if (plz === '' || plz === originalPlz.get(person.id)) delete session.plz[person.id];
    else session.plz[person.id] = plz;
  }

  function plzInvalid(id: string): boolean {
    const value = session.plz[id]?.trim() ?? '';
    return value !== '' && !/^\d{5}$/.test(value);
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
      Object.keys(session.betreuer).length > 0 ||
      Object.keys(session.plz).length > 0
  );

  /** Back to the registrations from CampFlow: no exclusions, added persons or chosen roles. */
  async function reset(): Promise<void> {
    if (
      !(await confirmAction({
        title: 'Teilnehmendenliste zurücksetzen?',
        message:
          'Teilnehmendenliste zurücksetzen? Ausschlüsse, nachgetragene Personen, gewählte Rollen und geänderte Postleitzahlen gehen verloren.',
        confirmLabel: 'Zurücksetzen',
      }))
    ) {
      return;
    }
    session.excluded = {};
    session.extra = [];
    session.betreuer = {};
    session.plz = {};
    plzInputs = {};
  }

  function remove(person: AbrechnungPerson): void {
    notice = { text: `${fullName(person) || 'Die Person'} wurde entfernt.` };
    session.extra = session.extra.filter((p) => p.id !== person.id);
    delete session.excluded[person.id];
    delete session.betreuer[person.id];
    delete session.plz[person.id];
    delete plzInputs[person.id];
  }

  function addPerson(): void {
    formErrors = {};
    const lastName = newLastName.trim();
    const firstName = newFirstName.trim();
    const plz = newPlz.trim();
    const age = newAge.trim() === '' ? null : Number(newAge);
    if (!lastName && !firstName) formErrors.lastName = 'Bitte gib mindestens einen Namen an.';
    if (age !== null && (!Number.isInteger(age) || age < 0 || age > 120))
      formErrors.age = 'Das Alter muss eine ganze Zahl zwischen 0 und 120 sein.';
    if (plz && !/^\d{5}$/.test(plz)) formErrors.plz = 'Die Postleitzahl muss fünfstellig sein.';
    const invalid = Object.keys(formErrors)[0];
    if (invalid) {
      document.getElementById(`extra-${invalid}`)?.focus();
      return;
    }
    const id = `extra-${crypto.randomUUID()}`;
    session.extra = [
      ...session.extra,
      { id, ...toKjrPerson({ lastName, firstName, gender: newGender, age, plz }) },
    ];
    newLastName = newFirstName = newAge = newPlz = '';
    newGender = '';
    notice = {
      text: `${`${firstName} ${lastName}`.trim()} wurde nachgetragen und zählt in der Abrechnung.`,
      rowId: id,
    };
    // The form stays ready for the next person.
    lastNameInput?.focus();
  }

  /** Scrolls the table to a person's row and focuses its checkbox. */
  async function showRow(id: string): Promise<void> {
    await tick();
    const row = document.getElementById(`tn-${id}`);
    if (!row) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    row.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    row.querySelector<HTMLElement>('input')?.focus({ preventScroll: true });
  }

  /** Includes every excluded person again and says how many changed. */
  function includeAll(): void {
    const count = excludedCount;
    session.excluded = {};
    notice = {
      text:
        count === 1
          ? '1 Person wird wieder abgerechnet.'
          : `${count} Personen werden wieder abgerechnet.`,
    };
  }

  async function exportPdf(): Promise<void> {
    pdfBusy = true;
    pdfError = null;
    try {
      // Changed Postleitzahlen and added persons need the table for their Ort
      const needsOrte = session.extra.length > 0 || Object.keys(session.plz).length > 0;
      if (needsOrte && !(await loadPlzOrte())) {
        pdfError =
          'Die Orte zu den Postleitzahlen konnten nicht geladen werden, deshalb wurde kein PDF erstellt. Bitte erneut versuchen.';
        return;
      }
      await downloadTablePdf({
        title: `Teilnehmende – ${abrechnung.event.title}`,
        subtitle: `${formatEventRange(abrechnung.event)} · Kostenstelle „${abrechnung.costUnit.name}“`,
        notes: [
          `${counts.total} Personen: ${counts.teilnehmende} Teilnehmende, ${counts.betreuende} Betreuer*innen.`,
        ],
        columns: ['Nr.', 'Nachname', 'Vorname', 'm/w/d', 'Alter', 'PLZ', 'Wohnort', 'Rolle'],
        rows: activePersons.map((person, index) => [
          String(index + 1),
          person.lastName,
          person.firstName,
          GENDER_LABEL[person.gender],
          person.age === null ? '–' : String(person.age),
          person.plz || '–',
          person.ort || '–',
          role(person),
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
  <section aria-labelledby="tn-liste-titel" class="surface p-4 sm:p-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 id="tn-liste-titel" class="font-serif text-lg font-semibold text-brand-900">
          Teilnehmende der Abrechnung
        </h2>
        <p class="mt-1 text-sm text-neutral-700" data-testid="tn-zusammenfassung">
          {counts.total} von {allPersons.length} Personen werden abgerechnet: {counts.teilnehmende}
          Teilnehmende, {counts.betreuende} Betreuer*innen{zuschussfaehig
            ? `, ${counts.subsidised} bezuschusst`
            : ''}.
        </p>
        {#if zuschussfaehig}
          <p class="mt-1 text-sm text-neutral-700">
            <button
              type="button"
              class="font-semibold text-brand-900 underline hover:no-underline"
              onclick={onShowKjrListe}
            >
              Zur KJR-Teilnahmeliste
            </button>
          </p>
        {/if}
      </div>
      <div class="flex flex-wrap gap-2">
        {#if excludedCount > 0}
          <ActionButton variant="secondary" type="button" onclick={includeAll}>
            Alle einbeziehen
          </ActionButton>
        {/if}
        {#if changed}
          <ActionButton variant="secondary" type="button" onclick={reset}>
            Zurücksetzen
          </ActionButton>
        {/if}
        <ActionButton
          variant="primary"
          type="button"
          disabled={pdfBusy || activePersons.length === 0}
          onclick={exportPdf}
        >
          {pdfBusy ? 'PDF wird erstellt …' : 'Als PDF herunterladen'}
        </ActionButton>
      </div>
    </div>
    <StatusNotice class="mt-3" kind="error" message={pdfError} />
    <StatusNotice
      class="mt-3"
      kind="warning"
      message={plzOrteStore.error &&
      (session.extra.length > 0 || Object.keys(session.plz).length > 0)
        ? `Die Orte zu geänderten und nachgetragenen Postleitzahlen konnten nicht geladen werden; der Wohnort bleibt dort leer.${zuschussfaehig ? ' Die Bezuschussung ist davon nicht betroffen.' : ''}`
        : null}
    />

    <!-- Below sm each person becomes a stacked entry with its own labels (see <style>). -->
    <div class="mt-4 sm:overflow-x-auto">
      <table class="tn-table w-full text-left text-sm sm:min-w-[42rem]">
        <thead class="border-b border-neutral-200 text-xs text-neutral-700">
          <tr>
            <th scope="col" class="py-2 pr-2">Abrechnen</th>
            <th scope="col" class="py-2 pr-2">Name</th>
            <th scope="col" class="py-2 pr-2">m/w/d</th>
            <th scope="col" class="py-2 pr-2 text-right">Alter</th>
            <th scope="col" class="py-2 pr-2">PLZ</th>
            <th scope="col" class="py-2 pr-2">Wohnort</th>
            <th scope="col" class="py-2 pr-2">Rolle</th>
            {#if zuschussfaehig}<th scope="col" class="py-2">Bezuschusst</th>{/if}
          </tr>
        </thead>
        {#if allPersons.length === 0}
          <tbody>
            <tr>
              <td colspan={columnCount} class="py-3 text-neutral-600">
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
                  colspan={columnCount}
                  class="pt-4 pb-1 text-xs font-semibold text-brand-900"
                >
                  {group.title} ({group.persons.length})
                  {#if group.id === 'betreuer'}
                    <InfoHint
                      label="Betreuer*innen"
                      text={`Ab ${KJR_BETREUER_AGE} Jahren zählt jede Person${zuschussfaehig ? ' für den KJR' : ''} als Betreuer*in. Jüngere Leitende wählst du unter „Rolle“ als Betreuer*in.`}
                      class="ml-1"
                    />
                  {/if}
                </th>
              </tr>
              {#each group.persons as person (person.id)}
                {@const included = !session.excluded[person.id]}
                {@const zuschuss = zuschussGrund(person)}
                <tr
                  id="tn-{person.id}"
                  class="tn-row border-b border-neutral-200 {included ? '' : 'text-neutral-500'}"
                >
                  <td class="tn-check py-2 pr-2">
                    <label class="tn-check-target inline-flex items-center justify-center">
                      <input
                        type="checkbox"
                        class="h-4 w-4"
                        checked={included}
                        aria-label={`${person.firstName} ${person.lastName} abrechnen`}
                        onchange={(event) => toggle(person, event.currentTarget.checked)}
                      />
                      <span class="tn-label" aria-hidden="true">abrechnen</span>
                    </label>
                  </td>
                  <th scope="row" class="tn-name py-2 pr-2 font-normal">
                    <span class={included ? 'text-brand-900' : 'line-through'}>
                      {person.lastName}{person.lastName && person.firstName
                        ? ', '
                        : ''}{person.firstName}
                    </span>
                    {#if isOwnName(authStore.principal, fullName(person))}
                      <span class="text-neutral-700">(ich)</span>
                    {/if}
                    {#if isExtra(person)}
                      <StatusLabel label="nachgetragen" tone="warning" />
                      <button
                        type="button"
                        class="ml-1 text-xs font-semibold text-danger underline"
                        aria-label={`${person.firstName} ${person.lastName} entfernen`}
                        onclick={() => remove(person)}
                      >
                        entfernen
                      </button>
                    {/if}
                  </th>
                  <td class="tn-gender py-2 pr-2">
                    <span class="tn-label" aria-hidden="true">Geschlecht</span>
                    {GENDER_LABEL[person.gender]}
                  </td>
                  <td class="tn-age py-2 pr-2 text-right tabular-nums">
                    <span class="tn-label" aria-hidden="true">Alter</span>
                    {person.age ?? '–'}
                  </td>
                  <td class="tn-plz py-2 pr-2">
                    <span class="tn-label" aria-hidden="true">PLZ</span>
                    <input
                      type="text"
                      inputmode="numeric"
                      maxlength="5"
                      autocomplete="off"
                      class="form-input w-24 tabular-nums {plzInvalid(person.id)
                        ? 'border-danger'
                        : 'border-neutral-300'}"
                      value={plzInputs[person.id] ??
                        session.plz[person.id] ??
                        originalPlz.get(person.id) ??
                        ''}
                      aria-label={`PLZ ${fullName(person)}`}
                      aria-invalid={plzInvalid(person.id)}
                      oninput={(event) => setPlz(person, event.currentTarget.value)}
                      onblur={() => delete plzInputs[person.id]}
                    />
                  </td>
                  <td class="tn-ort py-2 pr-2">
                    <span class="tn-label" aria-hidden="true">Wohnort</span>
                    {person.ort || '–'}
                  </td>
                  <td class="tn-rolle py-2 pr-2">
                    <span class="tn-label" aria-hidden="true">Rolle</span>
                    {#if isKjrBetreuerAge(person.age)}
                      <span>Betreuer*in</span>
                    {:else}
                      <select
                        class="rounded-md border border-neutral-300 bg-surface px-2 py-1 text-sm focus:border-brand-900 focus:outline-none"
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
                  {#if zuschussfaehig}
                    <td class="tn-zuschuss py-2">
                      <span class="tn-label" aria-hidden="true">Bezuschusst</span>
                      <span
                        class={zuschuss.subsidised ? '' : 'font-semibold text-warning'}
                        data-testid="zuschuss-grund">{zuschuss.label}</span
                      >
                    </td>
                  {/if}
                </tr>
              {:else}
                <tr>
                  <td colspan={columnCount} class="py-2 text-neutral-600">
                    {group.id === 'betreuer'
                      ? 'Noch keine Betreuer*innen.'
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
      Für Personen, die nicht in CampFlow angemeldet sind, aber mit abgerechnet werden.
    </p>
    <form
      class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_8rem_6rem_8rem_auto] lg:items-end"
      onsubmit={(event) => {
        event.preventDefault();
        addPerson();
      }}
    >
      <FormField
        id="extra-lastName"
        label="Nachname"
        hint="Vor- oder Nachname genügt."
        error={formErrors.lastName}
      >
        {#snippet children(attrs)}<input
            {...attrs}
            bind:this={lastNameInput}
            bind:value={newLastName}
            maxlength="100"
            autocomplete="off"
            class="form-input"
            oninput={() => delete formErrors.lastName}
          />{/snippet}
      </FormField>
      <FormField id="extra-firstName" label="Vorname">
        {#snippet children(attrs)}<input
            {...attrs}
            bind:value={newFirstName}
            maxlength="100"
            autocomplete="off"
            class="form-input"
            oninput={() => delete formErrors.lastName}
          />{/snippet}
      </FormField>
      <FormField id="extra-gender" label="Geschlecht" optional>
        {#snippet children(attrs)}<select {...attrs} bind:value={newGender} class="form-input">
            <option value="">–</option><option value="w">weiblich</option><option value="m"
              >männlich</option
            ><option value="d">divers</option>
          </select>{/snippet}
      </FormField>
      <FormField id="extra-age" label="Alter" optional error={formErrors.age}>
        {#snippet children(attrs)}<input
            {...attrs}
            bind:value={newAge}
            inputmode="numeric"
            maxlength="3"
            autocomplete="off"
            class="form-input"
            oninput={() => delete formErrors.age}
          />{/snippet}
      </FormField>
      <FormField id="extra-plz" label="PLZ" optional error={formErrors.plz}>
        {#snippet children(attrs)}<input
            {...attrs}
            bind:value={newPlz}
            inputmode="numeric"
            maxlength="5"
            autocomplete="off"
            class="form-input"
            oninput={() => delete formErrors.plz}
          />{/snippet}
      </FormField>
      <ActionButton variant="primary" type="submit">Hinzufügen</ActionButton>
    </form>
  </section>
</div>

<Toast
  message={notice?.text ?? null}
  actionLabel={notice?.rowId ? 'In der Liste zeigen' : undefined}
  onaction={() => {
    if (notice?.rowId) void showRow(notice.rowId);
  }}
  onclose={() => (notice = null)}
/>

<style>
  .tn-label {
    display: none;
  }

  /* Phones: the eight columns do not fit, so each person is a stacked entry. The table stays
     one set of cells and controls; only its layout changes, and the hidden column headers
     still name the cells for screen readers. */
  @media (width < 40rem) {
    .tn-table,
    .tn-table tbody,
    .tn-table tr,
    .tn-table th,
    .tn-table td {
      display: block;
    }

    .tn-table thead {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .tn-table .tn-row {
      display: grid;
      grid-template-columns: 3.5rem minmax(0, 1fr) minmax(0, 1fr);
      column-gap: 0.75rem;
      row-gap: 0.5rem;
      align-items: start;
      padding-block: 0.75rem;
    }

    .tn-row > * {
      padding: 0;
      grid-column: 2 / -1;
      text-align: left;
    }

    .tn-row > .tn-check {
      grid-column: 1;
      grid-row: 1 / span 5;
    }

    .tn-check-target {
      flex-direction: column;
      gap: 0.25rem;
      width: 3.5rem;
      min-height: 2.75rem;
      padding-top: 0.25rem;
    }

    .tn-name {
      align-self: center;
      font-size: 1rem;
    }

    .tn-name button {
      min-height: 2.75rem;
      padding-inline: 0.25rem;
    }

    .tn-row > .tn-gender,
    .tn-row > .tn-plz {
      grid-column: 2;
    }

    .tn-row > .tn-age,
    .tn-row > .tn-ort {
      grid-column: 3;
    }

    .tn-label {
      display: block;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--color-neutral-700);
    }

    .tn-row input[type='text'],
    .tn-row select {
      min-height: 2.75rem;
    }

    .tn-row select {
      width: 100%;
    }
  }
</style>
