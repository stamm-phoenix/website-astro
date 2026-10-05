<script lang="ts">
  import { downloadTablePdf, pdfFileName } from '../../lib/abrechnungPdf';
  import { formatEuro } from '../../lib/belege';
  import { formatDate, formatEventRange } from '../../lib/campflowFields';
  import type { Abrechnung, Nachweis } from '../../lib/types';
  import StatusNotice from '../pflege/StatusNotice.svelte';

  interface Props {
    abrechnung: Abrechnung;
  }

  let { abrechnung }: Props = $props();

  const ALL = '';
  const INPUT_CLASS =
    'mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 focus:border-brand-900 focus:outline-none';
  const DIRECTIONS = [
    { id: 'alle', label: 'Alle' },
    { id: 'einnahmen', label: 'Einnahmen' },
    { id: 'ausgaben', label: 'Ausgaben' },
  ] as const;
  type Direction = (typeof DIRECTIONS)[number]['id'];

  let category = $state(ALL);
  let direction = $state<Direction>('alle');
  let pdfBusy = $state(false);
  let pdfError = $state<string | null>(null);

  const categories = $derived(
    [...new Set(abrechnung.nachweise.map((n) => n.category))].sort((a, b) =>
      a.localeCompare(b, 'de')
    )
  );
  const visible = $derived(
    abrechnung.nachweise
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

  function amountClass(cent: number): string {
    return cent < 0 ? 'text-[var(--color-dpsg-red)]' : 'text-[var(--color-dpsg-pfadfinder)]';
  }

  function filterNote(): string {
    const kind =
      direction === 'einnahmen'
        ? 'nur Einnahmen'
        : direction === 'ausgaben'
          ? 'nur Ausgaben'
          : 'Einnahmen und Ausgaben';
    const scope = category === ALL ? 'alle Kategorien' : `Kategorie „${category}“`;
    return `Filter: ${scope}, ${kind} · ${visible.length} von ${abrechnung.nachweise.length} Buchungen`;
  }

  function cells(nachweis: Nachweis): string[] {
    return [
      formatDate(nachweis.date) || '–',
      nachweis.receiptNumber ?? '–',
      nachweis.type ?? '',
      nachweis.description ?? '',
      nachweis.category,
      nachweis.paidBy ?? '',
      formatEuro(nachweis.cent),
    ];
  }

  async function exportPdf(): Promise<void> {
    pdfBusy = true;
    pdfError = null;
    try {
      await downloadTablePdf({
        title: `Einzelnachweise – ${abrechnung.event.title}`,
        subtitle: `${formatEventRange(abrechnung.event)} · Kostenstelle „${abrechnung.costUnit.name}“`,
        notes: [filterNote()],
        columns: [
          'Datum',
          'Beleg-Nr.',
          'Art',
          'Beschreibung',
          'Kategorie',
          'Auslage durch',
          'Betrag',
        ],
        rows: visible.map(cells),
        foot: [
          ['', '', '', '', '', 'Einnahmen', formatEuro(incomeCent)],
          ['', '', '', '', '', 'Ausgaben', formatEuro(-expenseCent)],
          ['', '', '', '', '', 'Saldo', formatEuro(incomeCent - expenseCent)],
        ],
        alignRight: [6],
        landscape: true,
        fileName: pdfFileName(
          'Einzelnachweise',
          abrechnung.event.title,
          category === ALL ? '' : category
        ),
      });
    } catch {
      pdfError = 'Das PDF konnte nicht erstellt werden.';
    } finally {
      pdfBusy = false;
    }
  }
</script>

<section aria-labelledby="nachweise-titel" class="surface p-6">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div>
      <h2 id="nachweise-titel" class="font-serif text-lg font-semibold text-brand-900">
        Einzelnachweise
      </h2>
      <p class="mt-1 text-sm text-neutral-700">
        Alle Einnahmen und Ausgaben der Kostenstelle „{abrechnung.costUnit.name}“, wie in CampFlow
        unter Kasse → Auswertungen → Einzelnachweise.
      </p>
    </div>
    <button
      type="button"
      class="rounded-full bg-[var(--color-dpsg-blue)] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
      disabled={pdfBusy || visible.length === 0}
      onclick={exportPdf}
    >
      {pdfBusy ? 'PDF wird erstellt …' : 'Als PDF herunterladen'}
    </button>
  </div>
  <StatusNotice class="mt-3" kind="error" message={pdfError} />

  <form
    class="mt-4 grid gap-4 sm:grid-cols-[minmax(0,18rem)_auto] sm:items-end"
    aria-label="Einzelnachweise filtern"
    onsubmit={(event) => event.preventDefault()}
  >
    <label class="block text-sm">
      <span class="font-semibold text-neutral-700">Kategorie</span>
      <select bind:value={category} class={INPUT_CLASS}>
        <option value={ALL}>Alle Kategorien</option>
        {#each categories as option (option)}
          <option value={option}>
            {option} ({abrechnung.nachweise.filter((n) => n.category === option).length})
          </option>
        {/each}
      </select>
    </label>
    <div class="flex flex-wrap gap-2" role="group" aria-label="Einnahmen oder Ausgaben">
      {#each DIRECTIONS as option (option.id)}
        <button
          type="button"
          class="rounded-full border px-4 py-2 text-sm font-semibold {direction === option.id
            ? 'border-brand-900 bg-brand-900 text-white'
            : 'border-neutral-300 bg-white text-brand-900 hover:border-brand-900'}"
          aria-pressed={direction === option.id}
          onclick={() => (direction = option.id)}
        >
          {option.label}
        </button>
      {/each}
    </div>
  </form>

  <p class="mt-4 text-sm text-neutral-700" role="status" aria-live="polite">
    {visible.length} von {abrechnung.nachweise.length} Buchungen
  </p>

  <div class="mt-2 overflow-x-auto">
    <table class="w-full min-w-[44rem] text-left text-sm">
      <thead
        class="border-b border-neutral-200 text-xs uppercase tracking-[0.06em] text-neutral-700"
      >
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
          <tr class="border-b border-neutral-200 align-top">
            <td class="py-2 pr-2 whitespace-nowrap tabular-nums">
              {formatDate(nachweis.date) || '–'}
            </td>
            <td class="py-2 pr-2 whitespace-nowrap tabular-nums">{nachweis.receiptNumber ?? '–'}</td
            >
            <td class="py-2 pr-2">
              <span class="text-brand-900">{nachweis.description ?? '–'}</span>
              {#if nachweis.type}
                <span class="block text-xs text-neutral-600">{nachweis.type}</span>
              {/if}
            </td>
            <td class="py-2 pr-2">{nachweis.category}</td>
            <td class="py-2 pr-2">{nachweis.paidBy ?? ''}</td>
            <td class="py-2 text-right whitespace-nowrap tabular-nums {amountClass(nachweis.cent)}">
              {formatEuro(nachweis.cent)}
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
</section>
