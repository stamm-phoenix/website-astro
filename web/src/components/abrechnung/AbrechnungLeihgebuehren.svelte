<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import type { AbrechnungSession } from '../../lib/abrechnungStore.svelte';
  import { downloadLeihgebuehrenPdf } from '../../lib/abrechnungPdf';
  import { pdfFileName } from '../../lib/pdfBasis';
  import { leihgebuehrenPdfData } from '../../lib/abrechnungExport';
  import {
    LEIHGEBUEHREN_KATEGORIE,
    ZIEL_TOLERANZ_CENT,
    leihgebuehrenBeschluss,
  } from '../../lib/abrechnungRechnung';
  import type { Leihgebuehren } from '../../lib/abrechnungRechnung';
  import { formatEuro } from '../../lib/format';
  import type { Abrechnung } from '../../lib/types';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import { confirmAction } from '../../lib/confirm';

  interface Props {
    abrechnung: Abrechnung;
    session: AbrechnungSession;
    /**
     * Days of the KJR grant: overnight stays plus Zusatztag, one for a single day. Without the
     * grant the overnight stays, one for a single day.
     */
    defaultDays: number;
    result: Leihgebuehren;
    /** Income − expenses − Leihgebühren + KJR grant (without the grant: no grant). */
    endergebnisCent: number;
  }

  let { abrechnung, session, defaultDays, result, endergebnisCent }: Props = $props();

  /** Without KJR grant there is no grant to use up, so no target either. */
  const zuschussfaehig = $derived(abrechnung.event.zuschussfaehig);
  const zielErreicht = $derived(Math.abs(endergebnisCent) <= ZIEL_TOLERANZ_CENT);

  // Keep a temporarily empty field while typing; restore effective values on blur.
  let countInputs = $state<Record<string, string>>({});
  let dayInputs = $state<Record<string, string>>({});
  let inputSource: AbrechnungSession['leihgebuehren'] | undefined;
  // Storage adoption replaces this map; own keystrokes only change its entries.
  // Drop temporary text when another tab supplies the values used for calculation.
  $effect(() => {
    if (inputSource === session.leihgebuehren) return;
    inputSource = session.leihgebuehren;
    countInputs = {};
    dayInputs = {};
  });
  let pdfBusy = $state(false);
  let pdfError = $state<string | null>(null);

  function setCount(id: string, value: string): void {
    countInputs[id] = value;
    // An empty field means no material; the effective count is shown as 0.
    const count = Math.max(0, Math.floor(Number(value) || 0));
    session.leihgebuehren[id] = { days: session.leihgebuehren[id]?.days ?? null, count };
  }

  function setDays(id: string, value: string): void {
    dayInputs[id] = value;
    // An empty field goes back to the days of the KJR grant
    const days = value.trim() === '' ? null : Math.max(0, Math.floor(Number(value) || 0));
    session.leihgebuehren[id] = { count: session.leihgebuehren[id]?.count ?? 0, days };
  }

  const changed = $derived(
    Object.values(session.leihgebuehren).some((e) => e.count > 0 || e.days !== null)
  );

  /** Back to no material and the days of the KJR grant. */
  async function reset(): Promise<void> {
    if (
      !(await confirmAction({
        title: 'Leihgebühren zurücksetzen?',
        message: 'Leihgebühren zurücksetzen? Alle eingetragenen Anzahlen und Tage gehen verloren.',
        confirmLabel: 'Zurücksetzen',
      }))
    ) {
      return;
    }
    session.leihgebuehren = {};
    countInputs = {};
    dayInputs = {};
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
      <h2 id="leihgebuehren-titel" class="font-serif text-lg font-semibold text-brand-900">
        Leihgebühren für Zelte und Material
      </h2>
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
            <th scope="col" class="py-2 pr-2 text-right whitespace-nowrap">
              Tage
              <InfoHint
                label="Tage"
                text={`Vorbelegt mit den ${defaultDays} ${defaultDays === 1 ? 'Tag' : 'Tagen'} ${zuschussfaehig ? 'des KJR-Zuschusses (Übernachtungen und Zusatztag)' : 'der Aktion (Übernachtungen, bei eintägigen Aktionen 1)'}.`}
                class="ml-1"
              />
            </th>
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
                  class="form-input w-20 text-right tabular-nums"
                  value={countInputs[position.id] ?? position.count}
                  aria-label={`Anzahl ${position.name}`}
                  oninput={(event) => setCount(position.id, event.currentTarget.value)}
                  onblur={() => delete countInputs[position.id]}
                />
              </td>
              <td class="py-2 pr-2 text-right">
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputmode="numeric"
                  class="form-input w-20 text-right tabular-nums"
                  value={dayInputs[position.id] ??
                    session.leihgebuehren[position.id]?.days ??
                    defaultDays}
                  aria-label={`Tage ${position.name}`}
                  oninput={(event) => setDays(position.id, event.currentTarget.value)}
                  onblur={() => delete dayInputs[position.id]}
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
    <p class="mt-2 text-xs text-neutral-700">
      Die Summe zählt bereits in der Übersicht und in den Einzelnachweisen. Gebühren laut Beschluss
      der {leihgebuehrenBeschluss(abrechnung.leihgebuehren)}.
    </p>
  </section>

  <section aria-labelledby="leihgebuehren-ablauf-titel" class="surface p-6">
    <h2 id="leihgebuehren-ablauf-titel" class="font-serif text-lg font-semibold text-brand-900">
      So geht's weiter
    </h2>
    <ol class="mt-2 list-decimal space-y-1 pl-5 text-sm text-neutral-700">
      <li>
        Das PDF in CampFlow als Beleg der Aktion hochladen: Kategorie „{LEIHGEBUEHREN_KATEGORIE}“,
        Ausgelegt von „Sparbuch“.
        <InfoHint
          label="Kategorie und Ausgelegt von"
          text="Nicht „Material“, das will der KJR so. „Sparbuch“ zeigt der Kasse, dass der Betrag überwiesen gehört."
          class="ml-1"
        />
      </li>
      <li>
        Danach die Abrechnung neu laden: Die Leihgebühren stehen dann als Einzelnachweis in der
        Liste.
      </li>
    </ol>
    {#if zuschussfaehig}
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
    {:else}
      <p class="mt-3 text-sm text-neutral-700">
        Ergebnis mit Leihgebühren:
        <span
          class="font-semibold tabular-nums text-brand-900"
          data-testid="leihgebuehren-endergebnis"
        >
          {formatEuro(endergebnisCent)}
        </span>
      </p>
    {/if}
  </section>
</div>
