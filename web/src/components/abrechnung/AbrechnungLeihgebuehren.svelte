<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import type { AbrechnungSession } from '../../lib/abrechnungStore.svelte';
  import { downloadLeihgebuehrenPdf, pdfFileName } from '../../lib/abrechnungPdf';
  import { leihgebuehrenPdfData } from '../../lib/abrechnungExport';
  import {
    LEIHGEBUEHREN_KATEGORIE,
    ZIEL_TOLERANZ_CENT,
    leihgebuehrenBeschluss,
  } from '../../lib/abrechnungRechnung';
  import type { Leihgebuehren } from '../../lib/abrechnungRechnung';
  import { formatEuro } from '../../lib/belege';
  import type { Abrechnung } from '../../lib/types';
  import StatusNotice from '../pflege/StatusNotice.svelte';

  interface Props {
    abrechnung: Abrechnung;
    session: AbrechnungSession;
    /** Days of the KJR grant: overnight stays plus Zusatztag, one for a single day. */
    defaultDays: number;
    result: Leihgebuehren;
    /** Income − expenses − Leihgebühren + KJR grant. */
    endergebnisCent: number;
  }

  let { abrechnung, session, defaultDays, result, endergebnisCent }: Props = $props();

  const zielErreicht = $derived(Math.abs(endergebnisCent) <= ZIEL_TOLERANZ_CENT);

  const INPUT_CLASS =
    'w-20 rounded-md border border-neutral-300 bg-surface px-2 py-1.5 text-right tabular-nums focus:border-brand-900 focus:outline-none';

  let pdfBusy = $state(false);
  let pdfError = $state<string | null>(null);

  function setCount(id: string, value: string): void {
    // An empty field means none, shown as the grey placeholder 0
    const count = Math.max(0, Math.floor(Number(value) || 0));
    session.leihgebuehren[id] = { days: session.leihgebuehren[id]?.days ?? null, count };
  }

  function setDays(id: string, value: string): void {
    // An empty field goes back to the days of the KJR grant
    const days = value.trim() === '' ? null : Math.max(0, Math.floor(Number(value) || 0));
    session.leihgebuehren[id] = { count: session.leihgebuehren[id]?.count ?? 0, days };
  }

  const changed = $derived(
    Object.values(session.leihgebuehren).some((e) => e.count > 0 || e.days !== null)
  );

  /** Back to no material and the days of the KJR grant. */
  function reset(): void {
    if (
      !window.confirm(
        'Leihgebühren zurücksetzen? Alle eingetragenen Anzahlen und Tage gehen verloren.'
      )
    ) {
      return;
    }
    session.leihgebuehren = {};
  }

  async function exportPdf(): Promise<void> {
    pdfBusy = true;
    pdfError = null;
    try {
      await downloadLeihgebuehrenPdf(
        await leihgebuehrenPdfData(abrechnung, result),
        pdfFileName('Materialleihgebühren', abrechnung.event.title)
      );
    } catch {
      pdfError = 'Das PDF konnte nicht erstellt werden.';
    } finally {
      pdfBusy = false;
    }
  }
</script>

<div class="space-y-6">
  <section aria-labelledby="leihgebuehren-titel" class="surface p-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 id="leihgebuehren-titel" class="font-serif text-lg font-semibold text-brand-900">
          Leihgebühren für Zelte und Material
        </h2>
        <p class="mt-1 text-sm text-neutral-700">
          Gebühren laut Beschluss der {leihgebuehrenBeschluss(abrechnung.leihgebuehren)}. Die Tage
          sind mit den Tagen des KJR-Zuschusses vorbelegt ({defaultDays}
          {defaultDays === 1 ? 'Tag' : 'Tage'}: Übernachtungen und Zusatztag) und lassen sich pro
          Zeile ändern.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        {#if changed}
          <ActionButton variant="secondary" type="button" onclick={reset}>
            Zurücksetzen
          </ActionButton>
        {/if}
        <ActionButton variant="primary" type="button" disabled={pdfBusy} onclick={exportPdf}>
          {pdfBusy ? 'PDF wird erstellt …' : 'Als PDF herunterladen'}
        </ActionButton>
      </div>
    </div>
    <StatusNotice class="mt-3" kind="error" message={pdfError} />

    <div class="mt-4 overflow-x-auto">
      <table class="w-full min-w-[36rem] text-left text-sm">
        <thead class="border-b border-neutral-200 text-xs text-neutral-700">
          <tr>
            <th scope="col" class="py-2 pr-2">Material</th>
            <th scope="col" class="py-2 pr-2 text-right">Gebühr pro Tag</th>
            <th scope="col" class="py-2 pr-2 text-right">Anzahl</th>
            <th scope="col" class="py-2 pr-2 text-right">Tage</th>
            <th scope="col" class="py-2 text-right">Betrag</th>
          </tr>
        </thead>
        <tbody>
          {#each result.positions as position (position.id)}
            <tr class="border-b border-neutral-200">
              <th scope="row" class="py-2 pr-2 font-normal text-brand-900">{position.name}</th>
              <td class="py-2 pr-2 text-right tabular-nums">{formatEuro(position.priceCent)}</td>
              <td class="py-2 pr-2 text-right">
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputmode="numeric"
                  class={INPUT_CLASS}
                  value={position.count > 0 ? position.count : ''}
                  placeholder="0"
                  aria-label={`Anzahl ${position.name}`}
                  oninput={(event) => setCount(position.id, event.currentTarget.value)}
                />
              </td>
              <td class="py-2 pr-2 text-right">
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputmode="numeric"
                  class={INPUT_CLASS}
                  value={session.leihgebuehren[position.id]?.days ?? ''}
                  placeholder={String(defaultDays)}
                  aria-label={`Tage ${position.name}`}
                  oninput={(event) => setDays(position.id, event.currentTarget.value)}
                />
              </td>
              <td class="py-2 text-right tabular-nums text-brand-900"
                >{formatEuro(position.cent)}</td
              >
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colspan="4" class="pt-3 text-right font-semibold text-brand-900">
              Summe
            </th>
            <td
              class="pt-3 text-right text-lg font-semibold tabular-nums text-brand-900"
              data-testid="leihgebuehren-summe"
            >
              {formatEuro(result.totalCent)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  </section>

  <section aria-labelledby="leihgebuehren-ablauf-titel" class="surface p-6">
    <h2 id="leihgebuehren-ablauf-titel" class="font-serif text-lg font-semibold text-brand-900">
      So geht's weiter
    </h2>
    <ol class="mt-2 list-decimal space-y-1 pl-5 text-sm text-neutral-700">
      <li>
        Anzahl eintragen. Die Summe zählt sofort als virtuelle Ausgabe in der Übersicht und in den
        Einzelnachweisen. Ziel ist ein Endergebnis um 0 € (±{formatEuro(ZIEL_TOLERANZ_CENT)}).
      </li>
      <li>Das PDF herunterladen.</li>
      <li>
        Das PDF in CampFlow als Beleg der Aktion hochladen, mit Kategorie „{LEIHGEBUEHREN_KATEGORIE}“
        (nicht Material, das will der KJR so) und „Ausgelegt von“ Sparbuch, damit die Kasse weiß,
        dass der Betrag überwiesen gehört.
      </li>
      <li>
        Danach die Abrechnung neu laden (die Nachfrage des Browsers bestätigen): Die Leihgebühren
        stehen dann als echter Einzelnachweis in der Liste, und die Eingaben hier sind wieder leer.
      </li>
    </ol>
    <p class="mt-3 text-sm text-neutral-700">
      Endergebnis mit Leihgebühren und Zuschuss:
      <span
        class="font-semibold tabular-nums {zielErreicht ? 'text-success' : 'text-warning'}"
        data-testid="leihgebuehren-endergebnis"
      >
        {formatEuro(endergebnisCent)}
      </span>
      {zielErreicht ? '– im Ziel.' : `– Ziel ist 0 € (±${formatEuro(ZIEL_TOLERANZ_CENT)}).`}
    </p>
  </section>
</div>
