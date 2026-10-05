<script lang="ts">
  import { formatEuro } from '../../lib/belege';
  import { ApiError, postForFile, saveFile } from '../../lib/api';
  import type { AbrechnungSession } from '../../lib/abrechnungStore.svelte';
  import {
    KJR_BETREUER_AGE,
    KJR_MAX_TEILNEHMENDE_PER_BETREUER,
    betreuungsschluessel,
    countNights,
    kjrZuschuss,
  } from '../../lib/kjrZuschuss';
  import type { KjrPersonenZahlen } from '../../lib/kjrZuschuss';
  import type { Abrechnung, AbrechnungPerson, KategorieSumme } from '../../lib/types';
  import StatusNotice from '../pflege/StatusNotice.svelte';

  interface Props {
    abrechnung: Abrechnung;
    session: AbrechnungSession;
    /** The persons of the Abrechnung: without excluded ones, with added ones. */
    persons: AbrechnungPerson[];
    counts: KjrPersonenZahlen;
    onShowTeilnehmende: () => void;
  }

  let { abrechnung, session, persons, counts, onShowTeilnehmende }: Props = $props();

  const SELECT_CLASS =
    'mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:border-brand-900 focus:outline-none';
  const HEADING_CLASS = 'font-serif text-lg font-semibold text-brand-900';

  let kjrBusy = $state(false);
  let kjrError = $state<string | null>(null);

  const excludedCount = $derived(Object.keys(session.excluded).length);
  const nights = $derived(countNights(abrechnung.event.start_date, abrechnung.event.end_date));
  const zuschuss = $derived(
    kjrZuschuss({
      persons: counts.subsidised,
      nights,
      zusatztag: session.zusatztag,
      resultCent: abrechnung.bilanz.resultCent,
    })
  );
  const schluessel = $derived(betreuungsschluessel(counts.under27, counts.from27));

  async function downloadKjrListe(): Promise<void> {
    kjrBusy = true;
    kjrError = null;
    try {
      const { blob, fileName } = await postForFile(
        `/intern/abrechnung/${encodeURIComponent(abrechnung.event.id)}/kjr-liste`,
        {
          ort: session.kjr.ort.trim(),
          plz: session.kjr.plz.trim(),
          beginn: session.kjr.beginn,
          ende: session.kjr.ende,
          persons: persons.map(({ lastName, firstName, gender, age, plz }) => ({
            lastName,
            firstName,
            gender,
            age,
            plz,
          })),
        }
      );
      saveFile(blob, fileName ?? 'KJR-Teilnahmeliste.xlsx');
    } catch (error: unknown) {
      kjrError =
        error instanceof ApiError
          ? error.message
          : 'Die Teilnahmeliste konnte nicht erstellt werden.';
    } finally {
      kjrBusy = false;
    }
  }

  function signClass(cent: number): string {
    if (cent > 0) return 'text-[var(--color-dpsg-pfadfinder)]';
    if (cent < 0) return 'text-[var(--color-dpsg-red)]';
    return 'text-brand-900';
  }

  function share(part: number, total: number): string {
    return total > 0 ? `${Math.round((part / total) * 100)} %` : '';
  }
</script>

{#snippet kategorien(title: string, rows: KategorieSumme[], totalCent: number, id: string)}
  <div>
    <h3 {id} class="text-sm font-semibold uppercase tracking-[0.06em] text-neutral-700">
      {title}
    </h3>
    <table class="mt-2 w-full text-left text-sm" aria-labelledby={id}>
      <thead class="sr-only">
        <tr>
          <th scope="col">Kategorie</th>
          <th scope="col">Anteil</th>
          <th scope="col">Betrag</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.category)}
          <tr class="border-b border-neutral-200">
            <th scope="row" class="py-2 pr-2 font-normal text-neutral-800">
              {row.category}
              <span class="block text-xs text-neutral-600">
                {row.count}
                {row.count === 1 ? 'Buchung' : 'Buchungen'}
              </span>
            </th>
            <td class="py-2 pr-2 text-right text-xs text-neutral-600 tabular-nums">
              {share(row.cent, totalCent)}
            </td>
            <td class="py-2 text-right tabular-nums text-brand-900">{formatEuro(row.cent)}</td>
          </tr>
        {:else}
          <tr>
            <td colspan="3" class="py-2 text-neutral-600">Keine Buchungen</td>
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" colspan="2" class="pt-2 font-semibold text-brand-900">Summe</th>
          <td class="pt-2 text-right font-semibold tabular-nums text-brand-900">
            {formatEuro(totalCent)}
          </td>
        </tr>
      </tfoot>
    </table>
  </div>
{/snippet}

<div class="space-y-6">
  <section aria-labelledby="teilnehmende-titel" class="surface p-6">
    <h2 id="teilnehmende-titel" class={HEADING_CLASS}>Teilnehmende</h2>
    <p class="mt-1 text-sm text-neutral-700">
      Bestätigte Anmeldungen, Alter am ersten Tag der Aktion. Ab {KJR_BETREUER_AGE} Jahren zählen Personen
      für den KJR als Betreuer*innen.
    </p>
    <dl class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div class="rounded-md border border-neutral-200 p-3">
        <dt class="text-xs font-semibold uppercase tracking-[0.06em] text-neutral-700">Gesamt</dt>
        <dd class="mt-1 text-2xl font-semibold text-brand-900 tabular-nums">
          {counts.total}
        </dd>
      </div>
      <div class="rounded-md border border-neutral-200 p-3">
        <dt class="text-xs font-semibold uppercase tracking-[0.06em] text-neutral-700">
          Unter {KJR_BETREUER_AGE}
        </dt>
        <dd class="mt-1 text-2xl font-semibold text-brand-900 tabular-nums">
          {counts.under27}
        </dd>
        <dd class="text-xs text-neutral-600">Teilnehmende</dd>
      </div>
      <div class="rounded-md border border-neutral-200 p-3">
        <dt class="text-xs font-semibold uppercase tracking-[0.06em] text-neutral-700">
          Ab {KJR_BETREUER_AGE}
        </dt>
        <dd class="mt-1 text-2xl font-semibold text-brand-900 tabular-nums">
          {counts.from27}
        </dd>
        <dd class="text-xs text-neutral-600">Betreuer*innen</dd>
      </div>
      <div
        class="rounded-md border p-3 {schluessel.warning
          ? 'border-[#8a4a00]/40 bg-[#fff1e0]'
          : 'border-neutral-200'}"
      >
        <dt class="text-xs font-semibold uppercase tracking-[0.06em] text-neutral-700">
          Betreuungs&shy;schlüssel
        </dt>
        <dd
          class="mt-1 text-2xl font-semibold tabular-nums {schluessel.warning
            ? 'text-[#8a4a00]'
            : 'text-brand-900'}"
        >
          {schluessel.label}
        </dd>
        <dd class="text-xs text-neutral-600">Betreuer*in : Teilnehmende</dd>
      </div>
    </dl>
    <StatusNotice
      class="mt-4"
      kind="warning"
      message={schluessel.warning
        ? counts.from27 === 0
          ? 'Keine Betreuer*innen ab 27 Jahren. Das muss im Zuschussantrag beim KJR im Bemerkungsfeld erklärt werden.'
          : `Der Betreuungsschlüssel ist schlechter als 1:${KJR_MAX_TEILNEHMENDE_PER_BETREUER}. Das muss im Zuschussantrag beim KJR im Bemerkungsfeld erklärt werden, z. B. „Es waren Ehemalige dabei“.`
        : null}
    />
    {#if counts.unknownAge > 0}
      <p class="mt-2 text-sm text-neutral-700">
        Bei {counts.unknownAge}
        {counts.unknownAge === 1 ? 'Person' : 'Personen'} ist in CampFlow kein Alter hinterlegt;
        {counts.unknownAge === 1 ? 'sie zählt' : 'sie zählen'} nur in der Gesamtzahl.
      </p>
    {/if}
    {#if excludedCount > 0 || session.extra.length > 0}
      <p class="mt-3 text-sm text-neutral-700">
        Angepasste Liste: {excludedCount} ausgeschlossen, {session.extra.length} nachgetragen.
        <button
          type="button"
          class="font-semibold text-brand-900 underline"
          onclick={onShowTeilnehmende}
        >
          Zu den Teilnehmenden
        </button>
      </p>
    {/if}
  </section>

  <section aria-labelledby="bilanz-titel" class="surface p-6">
    <h2 id="bilanz-titel" class={HEADING_CLASS}>Einnahmen und Ausgaben</h2>
    <div class="mt-4 grid gap-6 lg:grid-cols-2">
      {@render kategorien(
        'Einnahmen',
        abrechnung.bilanz.income,
        abrechnung.bilanz.incomeCent,
        'bilanz-einnahmen'
      )}
      {@render kategorien(
        'Ausgaben',
        abrechnung.bilanz.expenses,
        abrechnung.bilanz.expenseCent,
        'bilanz-ausgaben'
      )}
    </div>
    <dl
      class="mt-6 flex flex-wrap items-baseline justify-between gap-2 border-t-2 border-brand-900 pt-3"
    >
      <dt class="font-semibold text-brand-900">Ergebnis (Einnahmen − Ausgaben)</dt>
      <dd
        class="text-xl font-semibold tabular-nums {signClass(abrechnung.bilanz.resultCent)}"
        data-testid="ergebnis"
      >
        {formatEuro(abrechnung.bilanz.resultCent)}
      </dd>
    </dl>
  </section>

  <section aria-labelledby="zuschuss-titel" class="surface p-6">
    <h2 id="zuschuss-titel" class={HEADING_CLASS}>KJR-Zuschuss</h2>
    <p class="mt-1 text-sm text-neutral-700">
      Der Kreisjugendring Rosenheim bezuschusst nur ein Defizit, höchstens bis zu seiner Höhe, und
      nur Teilnehmende aus dem Landkreis Rosenheim. Betreuer*innen zählen immer.
    </p>
    <StatusNotice
      class="mt-3"
      kind="warning"
      message={counts.outsideLandkreis > 0
        ? `${counts.outsideLandkreis} ${counts.outsideLandkreis === 1 ? 'Teilnehmer*in wohnt' : 'Teilnehmende wohnen'} laut Postleitzahl nicht im Landkreis Rosenheim oder ${counts.outsideLandkreis === 1 ? 'hat' : 'haben'} keine Postleitzahl. Der KJR bezuschusst sie nicht, deshalb ${counts.outsideLandkreis === 1 ? 'ist sie' : 'sind sie'} in der Berechnung nicht enthalten.`
        : null}
    />

    <label class="mt-4 flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        class="mt-0.5 h-4 w-4"
        bind:checked={session.zusatztag}
        disabled={nights === 0}
        aria-describedby="zusatztag-hinweis"
      />
      <span>
        <span class="font-semibold text-brand-900">Zusatztag</span>
        <span id="zusatztag-hinweis" class="block text-neutral-700">
          {#if nights === 0}
            Nur bei Aktionen mit Übernachtung möglich.
          {:else}
            Nur ankreuzen, wenn an An- und Abreisetag mehr als 6 Stunden „echtes“ Programm
            stattfand. „Unterwegs sein“ zählt nicht als Programm.
          {/if}
        </span>
      </span>
    </label>

    <dl class="mt-4 divide-y divide-neutral-200 text-sm">
      <div class="flex flex-wrap justify-between gap-2 py-2">
        <dt class="text-neutral-700">Übernachtungen</dt>
        <dd class="tabular-nums text-brand-900">
          {nights === 0 ? 'Keine (eintägige Aktion)' : nights}
        </dd>
      </div>
      <div class="flex flex-wrap justify-between gap-2 py-2">
        <dt class="text-neutral-700">Berechnung</dt>
        <dd class="tabular-nums text-brand-900" data-testid="zuschuss-formel">
          {formatEuro(zuschuss.rateCent)} × {counts.subsidised}
          {counts.subsidised === 1 ? 'Person' : 'Personen'}
          {#if nights > 0}× {zuschuss.days} {zuschuss.days === 1 ? 'Tag' : 'Tage'}{/if}
        </dd>
      </div>
      <div class="flex flex-wrap justify-between gap-2 py-2">
        <dt class="text-neutral-700">Errechneter Zuschuss</dt>
        <dd class="tabular-nums text-brand-900" data-testid="zuschuss-errechnet">
          {formatEuro(zuschuss.computedCent)}
        </dd>
      </div>
      <div class="flex flex-wrap justify-between gap-2 py-2">
        <dt class="font-semibold text-brand-900">Beantragbarer Zuschuss</dt>
        <dd
          class="text-right font-semibold tabular-nums text-brand-900"
          data-testid="zuschuss-beantragbar"
        >
          {formatEuro(zuschuss.eligibleCent)}
          {#if zuschuss.deficitCent === 0}
            <span class="block text-xs font-normal text-neutral-600">
              nicht beantragbar – kein Defizit
            </span>
          {:else if zuschuss.eligibleCent < zuschuss.computedCent}
            <span class="block text-xs font-normal text-neutral-600">
              begrenzt auf das Defizit
            </span>
          {/if}
        </dd>
      </div>
    </dl>

    <dl class="mt-4 space-y-1 border-t-2 border-brand-900 pt-3">
      <div class="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <dt class="text-neutral-700">Ergebnis vor Zuschuss</dt>
        <dd class="tabular-nums {signClass(abrechnung.bilanz.resultCent)}">
          {formatEuro(abrechnung.bilanz.resultCent)}
        </dd>
      </div>
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <dt class="font-semibold text-brand-900">Ergebnis inklusive Zuschuss</dt>
        <dd
          class="text-xl font-semibold tabular-nums {signClass(zuschuss.resultAfterCent)}"
          data-testid="ergebnis-mit-zuschuss"
        >
          {formatEuro(zuschuss.resultAfterCent)}
        </dd>
      </div>
    </dl>
  </section>

  <section aria-labelledby="kjr-liste-titel" class="surface p-6">
    <h2 id="kjr-liste-titel" class={HEADING_CLASS}>Teilnahmeliste für den KJR</h2>
    <p class="mt-1 text-sm text-neutral-700">
      Die Excel-Vorlage des KJR, ausgefüllt mit den Personen der Abrechnung (ohne ausgeschlossene,
      mit nachgetragenen): ab
      {KJR_BETREUER_AGE} Jahren als Betreuer*innen (ehrenamtlich), sonst als Teilnehmende, jeweils mit
      den Übernachtungen ohne Zusatztag. Ort, Landkreis-Zuordnung und Summen rechnet die Vorlage selbst.
    </p>
    <form
      class="mt-4 grid gap-4 sm:grid-cols-2"
      onsubmit={(event) => {
        event.preventDefault();
        downloadKjrListe();
      }}
    >
      <label class="block text-sm sm:col-span-2">
        <span class="font-semibold text-neutral-700">Veranstaltungsort</span>
        <input
          bind:value={session.kjr.ort}
          maxlength="200"
          autocomplete="off"
          placeholder="z. B. Jugendzeltplatz Zellhof, Bad Feilnbach"
          class={SELECT_CLASS}
        />
      </label>
      <label class="block text-sm">
        <span class="font-semibold text-neutral-700">Postleitzahl des Ortes</span>
        <input
          bind:value={session.kjr.plz}
          inputmode="numeric"
          pattern={'[0-9]{5}'}
          maxlength="5"
          autocomplete="off"
          class={SELECT_CLASS}
        />
      </label>
      <div class="grid grid-cols-2 gap-4">
        <label class="block text-sm">
          <span class="font-semibold text-neutral-700">Beginn (Uhrzeit)</span>
          <input type="time" bind:value={session.kjr.beginn} class={SELECT_CLASS} />
        </label>
        <label class="block text-sm">
          <span class="font-semibold text-neutral-700">Ende (Uhrzeit)</span>
          <input type="time" bind:value={session.kjr.ende} class={SELECT_CLASS} />
        </label>
      </div>
      <div class="sm:col-span-2">
        <button
          type="submit"
          class="rounded-full bg-[var(--color-dpsg-blue)] px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          disabled={kjrBusy}
        >
          {kjrBusy ? 'Wird erstellt …' : 'Teilnahmeliste herunterladen'}
        </button>
        <StatusNotice class="mt-3" kind="error" message={kjrError} />
      </div>
    </form>
  </section>
</div>
