<script lang="ts">
  import { onDestroy } from 'svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { isIch } from '../../lib/ichStore.svelte';
  import { fetchCampflowBelegBild } from '../../lib/campflowBelegBild';
  import CampflowBelegBild from '../CampflowBelegBild.svelte';
  import { downloadNachweisePdf, pdfFileName } from '../../lib/abrechnungPdf';
  import type { PdfBeleg, PdfTable } from '../../lib/abrechnungPdf';
  import { leihgebuehrenPdfData } from '../../lib/abrechnungExport';
  import { geaenderteBetraege } from '../../lib/abrechnungRechnung';
  import type { Leihgebuehren, NachweisZeile } from '../../lib/abrechnungRechnung';
  import { holdAbrechnungDraft } from '../../lib/abrechnungStore.svelte';
  import type { AbrechnungSession } from '../../lib/abrechnungStore.svelte';
  import { parseEuroToCent } from '../../lib/belege';
  import { formatEuro } from '../../lib/format';
  import { confirmAction } from '../../lib/confirm';
  import { formatDate, formatEventRange } from '../../lib/campflowFields';
  import type { Abrechnung } from '../../lib/types';
  import EditDialog from '../pflege/EditDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';

  interface Props {
    abrechnung: Abrechnung;
    session: AbrechnungSession;
    /**
     * The Einzelnachweise with the amounts changed on the page, and the Materialleihgebühren
     * entered on the page as virtual entry.
     */
    nachweise: NachweisZeile[];
    leihgebuehren: Leihgebuehren;
  }

  let { abrechnung, session, nachweise, leihgebuehren }: Props = $props();

  const ALL = '';

  const DIRECTIONS = [
    { id: 'alle', label: 'Alle' },
    { id: 'einnahmen', label: 'Einnahmen' },
    { id: 'ausgaben', label: 'Ausgaben' },
  ] as const;
  type Direction = (typeof DIRECTIONS)[number]['id'];

  let category = $state(ALL);
  let direction = $state<Direction>('alle');
  let pdfBusy = $state(false);
  let pdfStatus = $state<string | null>(null);
  let pdfError = $state<string | null>(null);
  let pdfWarning = $state<string | null>(null);

  const categories = $derived(
    [...new Set(nachweise.map((n) => n.category))].sort((a, b) => a.localeCompare(b, 'de'))
  );
  const visible = $derived(
    nachweise
      .filter((n) => category === ALL || n.category === category)
      .filter(
        (n) =>
          direction === 'alle' ||
          (direction === 'einnahmen' && n.cent > 0) ||
          (direction === 'ausgaben' && n.cent < 0)
      )
  );
  const incomeCent = $derived(visible.reduce((sum, n) => sum + Math.max(0, n.cent), 0));
  const expenseCent = $derived(visible.reduce((sum, n) => sum + Math.max(0, -n.cent), 0));
  const receiptCount = $derived(visible.filter((n) => n.receiptNumber && !n.virtual).length);

  function amountClass(cent: number): string {
    return cent < 0 ? 'text-danger' : 'text-success';
  }

  function filterNote(): string {
    const kind =
      direction === 'einnahmen'
        ? 'nur Einnahmen'
        : direction === 'ausgaben'
          ? 'nur Ausgaben'
          : 'Einnahmen und Ausgaben';
    const scope = category === ALL ? 'alle Kategorien' : `Kategorie „${category}“`;
    return `Filter: ${scope}, ${kind} · ${visible.length} von ${nachweise.length} Buchungen`;
  }

  function cells(nachweis: NachweisZeile): string[] {
    return [
      formatDate(nachweis.date) || '–',
      nachweis.receiptNumber ?? '–',
      [nachweis.description, nachweis.type].filter(Boolean).join(' · '),
      nachweis.category,
      nachweis.paidBy ?? '',
      `${formatEuro(nachweis.cent)}${nachweis.originalCent === undefined ? '' : ' *'}`,
    ];
  }

  function table(withReceipts: boolean): PdfTable {
    const notes = [filterNote()];
    if (visible.some((n) => n.virtual)) {
      notes.push('Die Materialleihgebühren sind noch nicht in CampFlow gebucht (virtuell).');
    }
    const changed = visible.filter((n) => n.originalCent !== undefined);
    if (changed.length > 0) {
      notes.push(
        `* Betrag abweichend von CampFlow geändert: ${changed
          .map(
            (n) =>
              `${n.receiptNumber ?? n.description ?? '–'} (CampFlow ${formatEuro(n.originalCent ?? 0)})`
          )
          .join(', ')}.`
      );
    }
    if (withReceipts) {
      notes.push(
        `Danach folgt jeder der ${receiptCount} Belege auf einer eigenen Seite, zum Anheften des Originals.`
      );
    }
    return {
      title: `Einzelnachweise – ${abrechnung.event.title}`,
      subtitle: `${formatEventRange(abrechnung.event)} · Kostenstelle „${abrechnung.costUnit.name}“`,
      notes,
      columns: ['Datum', 'Beleg-Nr.', 'Beschreibung', 'Kategorie', 'Auslage durch', 'Betrag'],
      rows: visible.map(cells),
      foot: [
        ['', '', '', '', 'Einnahmen', formatEuro(incomeCent)],
        ['', '', '', '', 'Ausgaben', formatEuro(-expenseCent)],
        ['', '', '', '', 'Saldo', formatEuro(incomeCent - expenseCent)],
      ],
      alignRight: [5],
      fileName: pdfFileName(
        withReceipts ? 'Einzelnachweise mit Belegen' : 'Einzelnachweise',
        abrechnung.event.title,
        category === ALL ? '' : category
      ),
    };
  }

  function belegDetails(nachweis: NachweisZeile): [string, string][] {
    return [
      ['Belegdatum', formatDate(nachweis.date) || '–'],
      ['Beschreibung', nachweis.description ?? ''],
      ['Art', nachweis.type ?? ''],
      ['Kategorie', nachweis.category],
      ['Auslage durch', nachweis.paidBy ?? ''],
      ['Betrag', formatEuro(nachweis.cent)],
      ...(nachweis.originalCent === undefined
        ? []
        : [['Betrag in CampFlow', formatEuro(nachweis.originalCent)] as [string, string]]),
      ['Aktion', `${abrechnung.event.title} (${formatEventRange(abrechnung.event)})`],
      ['Kostenstelle', abrechnung.costUnit.name],
    ];
  }

  async function exportPdf(withReceipts: boolean): Promise<void> {
    pdfBusy = true;
    pdfError = null;
    pdfWarning = null;
    pdfStatus = withReceipts ? 'Belege werden geladen …' : 'PDF wird erstellt …';
    try {
      const belege: PdfBeleg[] = withReceipts
        ? visible
            .filter((n) => n.receiptNumber && !n.virtual)
            .map((n) => ({ receiptNumber: n.receiptNumber ?? '', details: belegDetails(n) }))
        : [];
      const withLeihgebuehren = withReceipts && visible.some((n) => n.virtual);
      const { failed } = await downloadNachweisePdf(table(withReceipts), {
        belege,
        fetchImage: fetchCampflowBelegBild,
        leihgebuehren: withLeihgebuehren
          ? await leihgebuehrenPdfData(abrechnung, leihgebuehren)
          : undefined,
        onProgress: (done, total) => {
          pdfStatus = `Belege werden geladen: ${done} von ${total} …`;
        },
      });
      if (failed.length > 0) {
        pdfWarning = `${failed.length === 1 ? 'Ein Beleg konnte' : `${failed.length} Belege konnten`} nicht geladen werden (${failed.join(', ')}). Im PDF steht dafür ein Hinweis.`;
      }
    } catch {
      pdfError =
        'Das PDF wurde nicht erstellt. Prüfe deine Internetverbindung und tippe noch einmal auf „Liste als PDF“ oder „Mit Belegen als PDF“.';
    } finally {
      pdfBusy = false;
      pdfStatus = null;
    }
  }

  /** The Einzelnachweis opened in the dialog, by key so it follows changed amounts. */
  let openKey = $state<string | null>(null);
  let amountInput = $state('');
  let amountError = $state<string | null>(null);

  const selected = $derived(
    openKey === null ? null : (nachweise.find((n) => n.key === openKey) ?? null)
  );
  const changedCount = $derived(geaenderteBetraege(nachweise));

  function centToAmount(cent: number): string {
    return (Math.abs(cent) / 100).toFixed(2).replace('.', ',');
  }

  /**
   * A positive amount in cent, or 0 for „0“ / „0,00“; null if it is no amount. A minus as in the
   * list is ignored: the amount never turns an expense into income.
   */
  function parseAmount(value: string): number | null {
    const unsigned = value.trim().replace(/^[-−]\s*/, '');
    if (/^0+([.,]0{1,2})?\s*(€|eur)?$/i.test(unsigned)) return 0;
    return parseEuroToCent(unsigned);
  }

  /** Ends the hold of the open dialog on the version it was opened with. */
  let releaseDraft: (() => void) | null = null;

  function openDetails(nachweis: NachweisZeile): void {
    releaseDraft?.();
    releaseDraft = holdAbrechnungDraft(abrechnung.event.id);
    openKey = nachweis.key;
    amountInput = centToAmount(nachweis.cent);
    amountError = null;
  }

  function closeDetails(): void {
    releaseDraft?.();
    releaseDraft = null;
    openKey = null;
  }

  /** CampFlow's amount of the entry, also when it was changed on the page. */
  function campflowCent(nachweis: NachweisZeile): number {
    return nachweis.originalCent ?? nachweis.cent;
  }

  /** Keeps the entered amount for this session; income stays income, an expense an expense. */
  function applyAmount(): void {
    if (!selected) return;
    const entered = parseAmount(amountInput);
    if (entered === null) {
      amountError = 'Bitte einen Betrag wie 12,34 eingeben.';
      return;
    }
    const original = campflowCent(selected);
    const cent = original < 0 ? -entered : entered;
    if (cent === original) delete session.betraege[selected.key];
    else session.betraege[selected.key] = cent;
    closeDetails();
  }

  function restoreAmount(): void {
    if (!selected) return;
    delete session.betraege[selected.key];
    closeDetails();
  }

  async function resetAmounts(): Promise<void> {
    if (
      !(await confirmAction({
        title: 'Beträge zurücksetzen?',
        message:
          'Geänderte Beträge zurücksetzen? Alle Einzelnachweise bekommen wieder den Betrag aus CampFlow.',
        confirmLabel: 'Zurücksetzen',
      }))
    ) {
      return;
    }
    session.betraege = {};
  }

  onDestroy(() => {
    releaseDraft?.();
  });
</script>

<section aria-labelledby="nachweise-titel" class="surface p-6">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <h2 id="nachweise-titel" class="font-serif text-lg font-semibold text-brand-900">
      Einzelnachweise
    </h2>
    <div class="flex flex-wrap gap-2">
      <ActionButton
        variant="secondary"
        type="button"
        disabled={pdfBusy || visible.length === 0}
        onclick={() => exportPdf(false)}
      >
        Liste als PDF
      </ActionButton>
      <ActionButton
        variant="primary"
        type="button"
        disabled={pdfBusy || visible.length === 0}
        onclick={() => exportPdf(true)}
      >
        Mit Belegen als PDF
      </ActionButton>
    </div>
  </div>
  {#if changedCount > 0}
    <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <StatusLabel
        tone="warning"
        label={changedCount === 1
          ? 'Ein Betrag weicht von CampFlow ab.'
          : `${changedCount} Beträge weichen von CampFlow ab.`}
      />
      <ActionButton variant="secondary" type="button" onclick={resetAmounts}>
        Beträge zurücksetzen
      </ActionButton>
    </div>
  {/if}
  {#if pdfStatus}
    <p role="status" aria-live="polite" class="mt-3 text-sm text-neutral-700">{pdfStatus}</p>
  {/if}
  <StatusNotice class="mt-3" kind="warning" message={pdfWarning} />
  <StatusNotice class="mt-3" kind="error" message={pdfError} />

  <form
    class="mt-4 grid gap-4 sm:grid-cols-[minmax(0,18rem)_auto] sm:items-end"
    aria-label="Einzelnachweise filtern"
    onsubmit={(event) => event.preventDefault()}
  >
    <label class="block text-sm">
      <span class="font-semibold text-neutral-700">Kategorie</span>
      <select bind:value={category} class="form-input mt-1">
        <option value={ALL}>Alle Kategorien</option>
        {#each categories as option (option)}
          <option value={option}>
            {option} ({nachweise.filter((n) => n.category === option).length})
          </option>
        {/each}
      </select>
    </label>
    <FilterTabs
      label="Einnahmen oder Ausgaben"
      options={DIRECTIONS.map((option) => ({ value: option.id, label: option.label }))}
      value={direction}
      onselect={(value) => (direction = value)}
    />
  </form>

  <p class="mt-4 text-sm text-neutral-700" role="status" aria-live="polite">
    {visible.length} von {nachweise.length} Buchungen
  </p>

  <div class="mt-2 overflow-x-auto">
    <table class="w-full min-w-[44rem] text-left text-sm">
      <thead class="border-b border-neutral-200 text-xs text-neutral-700">
        <tr>
          <th scope="col" class="py-2 pr-2">Datum</th>
          <th scope="col" class="py-2 pr-2">Beleg-Nr.</th>
          <th scope="col" class="py-2 pr-2">Beschreibung</th>
          <th scope="col" class="py-2 pr-2">Kategorie</th>
          <th scope="col" class="py-2 pr-2">Auslage durch</th>
          <th scope="col" class="py-2 text-right">Betrag</th>
        </tr>
      </thead>
      <tbody>
        {#each visible as nachweis, index (index)}
          <tr
            class="border-b border-neutral-200 align-top {nachweis.virtual
              ? 'bg-warning-soft italic'
              : ''}"
          >
            <td class="py-2 pr-2 whitespace-nowrap tabular-nums">
              {formatDate(nachweis.date) || '–'}
            </td>
            <td class="py-2 pr-2 whitespace-nowrap tabular-nums">{nachweis.receiptNumber ?? '–'}</td
            >
            <td class="py-2 pr-2">
              {#if nachweis.virtual}
                <span class="text-brand-900">{nachweis.description ?? '–'}</span>
              {:else}
                <button
                  type="button"
                  class="text-left text-brand-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-brand-900"
                  aria-haspopup="dialog"
                  onclick={() => openDetails(nachweis)}
                >
                  {nachweis.description ?? 'Ohne Beschreibung'}
                  <span class="sr-only">– Details{nachweis.receiptNumber ? ' und Beleg' : ''}</span>
                </button>
              {/if}
              {#if nachweis.virtual}
                <StatusLabel label="virtuell" tone="warning" />
              {/if}
              {#if nachweis.type}
                <span class="block text-xs text-neutral-600">{nachweis.type}</span>
              {/if}
            </td>
            <td class="py-2 pr-2">{nachweis.category}</td>
            <td class="py-2 pr-2">
              {nachweis.paidBy ?? ''}
              {#if isIch({ name: nachweis.paidBy })}
                <span class="text-neutral-700">(ich)</span>
              {/if}
            </td>
            <td class="py-2 text-right whitespace-nowrap tabular-nums {amountClass(nachweis.cent)}">
              {formatEuro(nachweis.cent)}
              {#if nachweis.originalCent !== undefined}
                <span class="block text-xs text-neutral-600" data-testid="betrag-campflow">
                  geändert, CampFlow: <s>{formatEuro(nachweis.originalCent)}</s>
                </span>
              {/if}
            </td>
          </tr>
        {:else}
          <tr>
            <td colspan="6" class="py-3 text-neutral-600">Keine Buchungen für diesen Filter.</td>
          </tr>
        {/each}
      </tbody>
      <tfoot class="text-brand-900">
        <tr>
          <th scope="row" colspan="5" class="pt-3 text-right font-semibold">Einnahmen</th>
          <td class="pt-3 text-right tabular-nums">{formatEuro(incomeCent)}</td>
        </tr>
        <tr>
          <th scope="row" colspan="5" class="text-right font-semibold">Ausgaben</th>
          <td class="text-right tabular-nums">{formatEuro(-expenseCent)}</td>
        </tr>
        <tr>
          <th scope="row" colspan="5" class="text-right font-semibold">Saldo</th>
          <td class="text-right font-semibold tabular-nums" data-testid="nachweise-saldo">
            {formatEuro(incomeCent - expenseCent)}
          </td>
        </tr>
      </tfoot>
    </table>
  </div>

  <EditDialog
    open={selected !== null}
    title={selected?.receiptNumber ? `Beleg ${selected.receiptNumber}` : 'Einzelnachweis'}
    submitLabel="Betrag übernehmen"
    cancelLabel="Schließen"
    onsubmit={applyAmount}
    onclose={closeDetails}
  >
    {#if selected}
      <dl class="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        {#each belegDetails(selected).filter(([, value]) => value) as [label, value] (label)}
          <dt class="font-semibold text-neutral-700">{label}</dt>
          <dd class="text-brand-900">{value}</dd>
        {/each}
      </dl>

      <FormField
        id="nachweis-betrag"
        label={selected && campflowCent(selected) < 0
          ? 'Betrag der Ausgabe'
          : 'Betrag der Einnahme'}
        error={amountError ?? undefined}
        info="Gilt nur für diese Abrechnung auf diesem Gerät und ändert nichts in CampFlow."
      >
        {#snippet children(attrs)}
          <div class="relative mt-1 max-w-48">
            <input
              {...attrs}
              type="text"
              inputmode="decimal"
              autocomplete="off"
              class="form-input w-full pr-8 text-right tabular-nums"
              bind:value={amountInput}
              oninput={() => (amountError = null)}
            />
            <span
              aria-hidden="true"
              class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-neutral-600"
              >€</span
            >
          </div>
        {/snippet}
      </FormField>

      {#if selected.receiptNumber}
        <CampflowBelegBild receiptNumber={selected.receiptNumber} />
      {:else}
        <p class="text-sm text-neutral-700">Zu dieser Buchung gibt es in CampFlow keinen Beleg.</p>
      {/if}
    {/if}

    {#snippet actions()}
      {#if selected?.originalCent !== undefined}
        <ActionButton variant="secondary" type="button" onclick={restoreAmount}>
          CampFlow-Betrag
        </ActionButton>
      {/if}
    {/snippet}
  </EditDialog>
</section>
