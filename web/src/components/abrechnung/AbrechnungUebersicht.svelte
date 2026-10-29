<script lang="ts">
  import Panel from '../ui/Panel.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import { formatEuro } from '../../lib/format';
  import { isIch } from '../../lib/ichStore.svelte';
  import { errorMessage, postForFile, saveFile } from '../../lib/api';
  import type { AbrechnungSession } from '../../lib/abrechnungStore.svelte';
  import {
    KJR_BETREUER_AGE,
    KJR_MIN_TEILNEHMENDE_PER_BETREUER,
    betreuungsschluessel,
    countNights,
    kjrZuschuss,
  } from '../../lib/kjrZuschuss';
  import type { KjrPersonenZahlen } from '../../lib/kjrZuschuss';
  import type { Abrechnung, AbrechnungPerson } from '../../lib/types';
  import { ZIEL_TOLERANZ_CENT, auslagen, geaenderteBetraege } from '../../lib/abrechnungRechnung';
  import type {
    BilanzMitLeihgebuehren,
    BilanzZeile,
    NachweisZeile,
  } from '../../lib/abrechnungRechnung';
  import { downloadDeckblattPdf } from '../../lib/abrechnungPdf';
  import { pdfFileName } from '../../lib/pdfBasis';
  import { formatDate, formatEventRange } from '../../lib/campflowFields';
  import StatusNotice from '../pflege/StatusNotice.svelte';

  interface Props {
    abrechnung: Abrechnung;
    session: AbrechnungSession;
    /** The persons of the Abrechnung: without excluded ones, with added ones. */
    persons: AbrechnungPerson[];
    counts: KjrPersonenZahlen;
    /** The balance including the Materialleihgebühren entered on the page. */
    bilanz: BilanzMitLeihgebuehren;
    /** CampFlow's Einzelnachweise with the amounts changed on the page. */
    nachweise: NachweisZeile[];
    leihgebuehrenCent: number;
    onShowTab: (tab: 'teilnehmende' | 'nachweise' | 'leihgebuehren') => void;
  }

  let {
    abrechnung,
    session,
    persons,
    counts,
    bilanz,
    nachweise,
    leihgebuehrenCent,
    onShowTab,
  }: Props = $props();

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
      resultCent: bilanz.resultCent,
    })
  );
  /** Without KJR grant the page shows income and expenses only, nothing the KJR assesses. */
  const zuschussfaehig = $derived(abrechnung.event.zuschussfaehig);
  const schluessel = $derived(betreuungsschluessel(counts.teilnehmende, counts.betreuende));
  /** More than one Betreuer*in per eight Teilnehmende matters for the KJR only. */
  const schluesselWarning = $derived(zuschussfaehig && schluessel.warning);

  /** Real bookings only: the Leihgebühren are paid from the Sparbuch, not by a person. */
  const auslagenListe = $derived(auslagen(nachweise));
  const geaendert = $derived(geaenderteBetraege(nachweise));
  const auslagenSummeCent = $derived(auslagenListe.reduce((sum, a) => sum + a.cent, 0));
  const zielErreicht = $derived(Math.abs(zuschuss.resultAfterCent) <= ZIEL_TOLERANZ_CENT);

  let deckblattBusy = $state(false);
  let deckblattError = $state<string | null>(null);

  async function downloadDeckblatt(): Promise<void> {
    deckblattBusy = true;
    deckblattError = null;
    try {
      await downloadDeckblattPdf(
        {
          title: abrechnung.event.title,
          zeitraum: formatEventRange(abrechnung.event),
          kostenstelle: abrechnung.costUnit.name,
          leitende: counts.betreuende,
          teilnehmende: counts.teilnehmende,
          summe: counts.total,
          vorkalkulation: session.deckblatt.vorkalkulation.trim(),
          kalkulation: session.deckblatt.kalkulation.trim(),
        },
        pdfFileName('Deckblatt', abrechnung.event.title)
      );
    } catch {
      deckblattError =
        'Das Deckblatt wurde nicht erstellt. Tippe noch einmal auf „Deckblatt als PDF herunterladen“.';
    } finally {
      deckblattBusy = false;
    }
  }

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
          persons: persons.map(({ lastName, firstName, gender, age, plz, betreuer }) => ({
            lastName,
            firstName,
            gender,
            age,
            plz,
            betreuer,
          })),
        }
      );
      saveFile(blob, fileName ?? 'KJR-Teilnahmeliste.xlsx');
    } catch (error: unknown) {
      kjrError = errorMessage(
        error,
        'Die Teilnahmeliste wurde nicht erstellt. Prüfe deine Internetverbindung und tippe noch einmal auf „Teilnahmeliste herunterladen“.'
      );
    } finally {
      kjrBusy = false;
    }
  }

  function signClass(cent: number): string {
    if (cent > 0) return 'text-success';
    if (cent < 0) return 'text-danger';
    return 'text-brand-900';
  }

  function share(part: number, total: number): string {
    return total > 0 ? `${Math.round((part / total) * 100)} %` : '';
  }
</script>

{#snippet kategorien(title: string, rows: BilanzZeile[], totalCent: number, id: string)}
  <div>
    <h3 {id} class="text-sm font-semibold text-neutral-700">
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
                {#if row.virtual}
                  noch nicht in CampFlow gebucht
                {:else}
                  {row.count}
                  {row.count === 1 ? 'Buchung' : 'Buchungen'}
                {/if}
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
  <Panel aria-labelledby="teilnehmende-titel">
    <h2 id="teilnehmende-titel" class="{HEADING_CLASS} inline">Teilnehmende</h2>
    <InfoHint
      label="Teilnehmende"
      text="Bestätigte Anmeldungen aus CampFlow, das Alter zählt am ersten Tag der Aktion."
      class="ml-1"
    />
    <dl class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div class="border-t border-neutral-200 py-3">
        <dt class="text-xs font-semibold text-neutral-700">Gesamt</dt>
        <dd class="mt-1 text-2xl font-semibold text-brand-900 tabular-nums">
          {counts.total}
        </dd>
      </div>
      <div class="border-t border-neutral-200 py-3">
        <dt class="text-xs font-semibold text-neutral-700">Teilnehmende</dt>
        <dd class="mt-1 text-2xl font-semibold text-brand-900 tabular-nums">
          {counts.teilnehmende}
        </dd>
        <dd class="text-xs text-neutral-600">unter {KJR_BETREUER_AGE}</dd>
      </div>
      <div class="border-t border-neutral-200 py-3">
        <dt class="text-xs font-semibold text-neutral-700">Betreuer*innen</dt>
        <dd class="mt-1 text-2xl font-semibold text-brand-900 tabular-nums">
          {counts.betreuende}
        </dd>
        <dd class="text-xs text-neutral-600">
          {counts.ab27} ab {KJR_BETREUER_AGE}{counts.betreuende > counts.ab27
            ? `, ${counts.betreuende - counts.ab27} jünger eingetragen`
            : ''}
        </dd>
      </div>
      <div
        class="border-t py-3 {schluesselWarning
          ? 'border-warning/40 bg-warning-soft'
          : 'border-neutral-200'}"
      >
        <dt class="text-xs font-semibold text-neutral-700">Betreuungs&shy;schlüssel</dt>
        <dd
          class="mt-1 text-2xl font-semibold tabular-nums {schluesselWarning
            ? 'text-warning'
            : 'text-brand-900'}"
          data-testid="betreuungsschluessel"
        >
          {schluessel.label}
        </dd>
        <dd class="text-xs text-neutral-600">Betreuer*in : Teilnehmende</dd>
      </div>
    </dl>
    {#if !zuschussfaehig}
      <!-- Without KJR grant the ratio is shown, but not assessed -->
    {:else if counts.ab27 === 0 && counts.betreuende === 0 && counts.total > 0}
      <StatusNotice
        class="mt-4"
        kind="warning"
        message={`Niemand ist ${KJR_BETREUER_AGE} Jahre oder älter: Trag mindestens eine*n der Teilnehmenden als Betreuer*in ein.`}
      />
      <ActionButton
        variant="secondary"
        type="button"
        class="mt-2"
        onclick={() => onShowTab('teilnehmende')}
      >
        Betreuer*innen eintragen
      </ActionButton>
    {:else}
      <StatusNotice
        class="mt-4"
        kind="warning"
        message={schluesselWarning
          ? `Der KJR erwartet höchstens 1 Betreuer*in auf ${KJR_MIN_TEILNEHMENDE_PER_BETREUER} Teilnehmende, bei euch ${schluessel.label.replace(/\s*:\s*/, ' auf ')}. Begründe das im Zuschussantrag im Bemerkungsfeld, z. B. „Es waren Ehemalige dabei“.${counts.betreuende > counts.ab27 ? ' Oder prüfe, ob die jünger eingetragenen Betreuer*innen stimmen.' : ''}`
          : null}
      />
    {/if}
    {#if counts.unknownAge > 0}
      <p class="mt-2 text-sm text-neutral-700">
        {counts.unknownAge}
        {counts.unknownAge === 1 ? 'Person' : 'Personen'} ohne Alter,
        {counts.unknownAge === 1 ? 'sie zählt' : 'sie zählen'} nur in der Gesamtzahl.
      </p>
    {/if}
    {#if excludedCount > 0 || session.extra.length > 0}
      <p class="mt-3 text-sm text-neutral-700">
        Angepasste Liste: {excludedCount} ausgeschlossen, {session.extra.length} nachgetragen.
        <button
          type="button"
          class="font-semibold text-brand-900 underline"
          onclick={() => onShowTab('teilnehmende')}
        >
          Zu den Teilnehmenden
        </button>
      </p>
    {/if}
  </Panel>

  <Panel aria-labelledby="bilanz-titel">
    <h2 id="bilanz-titel" class={HEADING_CLASS}>Einnahmen und Ausgaben</h2>
    {#if geaendert > 0}
      <p class="mt-2 text-sm text-warning" data-testid="betraege-geaendert">
        {geaendert === 1
          ? 'Ein Betrag weicht von CampFlow ab.'
          : `${geaendert} Beträge weichen von CampFlow ab.`}
        <button
          type="button"
          class="font-semibold text-brand-900 underline"
          onclick={() => onShowTab('nachweise')}
        >
          Zu den Einzelnachweisen
        </button>
      </p>
    {/if}
    <div class="mt-4 grid gap-6 lg:grid-cols-2">
      {@render kategorien('Einnahmen', bilanz.income, bilanz.incomeCent, 'bilanz-einnahmen')}
      {@render kategorien('Ausgaben', bilanz.expenses, bilanz.expenseCent, 'bilanz-ausgaben')}
    </div>
    <dl
      class="mt-6 flex flex-wrap items-baseline justify-between gap-2 border-t-2 border-brand-900 pt-3"
    >
      <dt class="font-semibold text-brand-900">
        Ergebnis{leihgebuehrenCent > 0 ? ' inkl. Leihgebühren' : ''}
      </dt>
      <dd
        class="text-xl font-semibold tabular-nums {signClass(bilanz.resultCent)}"
        data-testid="ergebnis"
      >
        {formatEuro(bilanz.resultCent)}
      </dd>
    </dl>
  </Panel>

  <Panel aria-labelledby="auslagen-titel">
    <h2 id="auslagen-titel" class={HEADING_CLASS}>Auslagen</h2>
    <p class="mt-1 text-sm text-neutral-700">Die Kasse zahlt diese Beträge zurück.</p>
    {#if auslagenListe.length > 0}
      <table class="mt-4 w-full text-left text-sm" data-testid="auslagen">
        <thead class="border-b border-neutral-200 text-xs text-neutral-700">
          <tr>
            <th scope="col" class="py-2 pr-2">Auslage durch</th>
            <th scope="col" class="py-2 pr-2 text-right">Belege</th>
            <th scope="col" class="py-2 text-right">Betrag</th>
          </tr>
        </thead>
        <tbody>
          {#each auslagenListe as auslage (auslage.name)}
            <tr class="border-b border-neutral-200">
              <th scope="row" class="py-2 pr-2 font-normal text-neutral-800">
                {auslage.name}
                {#if isIch({ name: auslage.name })}
                  <span class="text-neutral-700">(ich)</span>
                {/if}
              </th>
              <td class="py-2 pr-2 text-right tabular-nums text-neutral-700">{auslage.count}</td>
              <td class="py-2 text-right tabular-nums text-brand-900">{formatEuro(auslage.cent)}</td
              >
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colspan="2" class="pt-2 font-semibold text-brand-900">Summe</th>
            <td class="pt-2 text-right font-semibold tabular-nums text-brand-900">
              {formatEuro(auslagenSummeCent)}
            </td>
          </tr>
        </tfoot>
      </table>
    {:else}
      <p class="mt-3 text-sm text-neutral-600">Keine Auslagen.</p>
    {/if}
  </Panel>

  {#if zuschussfaehig}
    <Panel aria-labelledby="zuschuss-titel">
      <h2 id="zuschuss-titel" class="{HEADING_CLASS} inline">KJR-Zuschuss</h2>
      <InfoHint label="KJR-Zuschuss" class="ml-1">
        <p>
          Der Kreisjugendring Rosenheim bezuschusst nur ein Defizit, höchstens bis zu seiner Höhe,
          und nur Teilnehmende aus dem Landkreis Rosenheim. Betreuer*innen zählen immer.
        </p>
        <p>Ziel ist ein Ergebnis um 0 € (±{formatEuro(ZIEL_TOLERANZ_CENT)}).</p>
      </InfoHint>
      <StatusNotice
        class="mt-3"
        kind="warning"
        message={counts.outsideLandkreis > 0
          ? `${counts.outsideLandkreis} ${counts.outsideLandkreis === 1 ? 'Teilnehmer*in wohnt' : 'Teilnehmende wohnen'} laut Postleitzahl nicht im Landkreis Rosenheim oder ${counts.outsideLandkreis === 1 ? 'hat' : 'haben'} keine Postleitzahl und ${counts.outsideLandkreis === 1 ? 'wird' : 'werden'} nicht bezuschusst.`
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
              Nur wenn An- und Abreisetag je mehr als 6 Stunden Programm hatten; Fahrtzeit zählt
              nicht.
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
          <dd class="tabular-nums {signClass(bilanz.resultCent)}">
            {formatEuro(bilanz.resultCent)}
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
      <div class="mt-4" data-testid="abrechnung-ziel">
        <StatusNotice
          kind={zielErreicht ? 'success' : 'warning'}
          message={zielErreicht
            ? `Ziel erreicht: Das Ergebnis liegt bei 0 € (±${formatEuro(ZIEL_TOLERANZ_CENT)}).`
            : zuschuss.resultAfterCent > 0
              ? 'Überschuss: Mit Materialleihgebühren lässt sich der Zuschuss ausschöpfen.'
              : 'Auch mit Zuschuss bleibt ein Defizit.'}
        />
        {#if !zielErreicht && zuschuss.resultAfterCent > 0}
          <button
            type="button"
            class="mt-2 text-sm font-semibold text-brand-900 underline"
            onclick={() => onShowTab('leihgebuehren')}
          >
            Materialleihgebühren eintragen
          </button>
        {/if}
      </div>
    </Panel>

    <Panel aria-labelledby="kjr-liste-titel">
      <h2 id="kjr-liste-titel" class="{HEADING_CLASS} scroll-mt-24" tabindex="-1">
        Teilnahmeliste für den KJR
      </h2>
      <p class="mt-1 text-sm text-neutral-700">
        Die Excel-Vorlage des KJR mit den Personen der Abrechnung.
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
            class="form-input mt-1"
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
            class="form-input mt-1"
          />
        </label>
        <div class="grid grid-cols-2 gap-4">
          <label class="block text-sm">
            <span class="font-semibold text-neutral-700">Beginn</span>
            <span class="text-neutral-600" data-testid="kjr-beginn-datum"
              >am {formatDate(abrechnung.event.start_date) || '–'}, Uhrzeit</span
            >
            <input type="time" bind:value={session.kjr.beginn} class="form-input mt-1" />
          </label>
          <label class="block text-sm">
            <span class="font-semibold text-neutral-700">Ende</span>
            <span class="text-neutral-600" data-testid="kjr-ende-datum"
              >am {formatDate(abrechnung.event.end_date ?? abrechnung.event.start_date) || '–'},
              Uhrzeit</span
            >
            <input type="time" bind:value={session.kjr.ende} class="form-input mt-1" />
          </label>
        </div>
        <div class="sm:col-span-2">
          <ActionButton variant="primary" type="submit" disabled={kjrBusy}>
            {kjrBusy ? 'Wird erstellt …' : 'Teilnahmeliste herunterladen'}
          </ActionButton>
          <StatusNotice class="mt-3" kind="error" message={kjrError} />
        </div>
      </form>
    </Panel>
  {/if}

  <Panel aria-labelledby="deckblatt-titel">
    <h2 id="deckblatt-titel" class={HEADING_CLASS}>Deckblatt</h2>
    <form
      class="mt-4 grid gap-4 sm:grid-cols-2"
      onsubmit={(event) => {
        event.preventDefault();
        downloadDeckblatt();
      }}
    >
      <label class="block text-sm">
        <span class="font-semibold text-neutral-700">Vorkalkulation von</span>
        <input
          bind:value={session.deckblatt.vorkalkulation}
          maxlength="200"
          autocomplete="off"
          class="form-input mt-1"
        />
      </label>
      <label class="block text-sm">
        <span class="font-semibold text-neutral-700">Abschließende Kalkulation von</span>
        <input
          bind:value={session.deckblatt.kalkulation}
          maxlength="200"
          autocomplete="off"
          class="form-input mt-1"
        />
      </label>
      <div class="sm:col-span-2">
        <ActionButton variant="primary" type="submit" disabled={deckblattBusy}>
          {deckblattBusy ? 'Wird erstellt …' : 'Deckblatt als PDF herunterladen'}
        </ActionButton>
        <StatusNotice class="mt-3" kind="error" message={deckblattError} />
      </div>
    </form>
  </Panel>
</div>
