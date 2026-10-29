<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { attendanceSnapshot } from '../../../../api/lib/anwesenheit-model';
  import { averageMembers, monthlyStats } from '../../lib/anwesenheit';
  import { ApiError, fetchApi, errorMessage, sendApi } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import type { AnwesenheitMeeting, AnwesenheitTermin } from '../../lib/types';
  import ActionButton from '../ui/ActionButton.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import PdfDownloadButton from '../ui/PdfDownloadButton.svelte';
  import AnwesenheitDiagramm from './AnwesenheitDiagramm.svelte';
  import StatusNotice from './StatusNotice.svelte';

  interface Props {
    stufe: string;
    slug: string;
    meetings: AnwesenheitMeeting[];
    onselect: (date: string) => void;
    /** Called after the Termin of `date` was deleted, to remove it from the Termine. */
    ondelete: (date: string) => void;
    /** Keeps the summary and statistics in sync with freshly loaded details. */
    onload: (meeting: AnwesenheitMeeting) => void;
  }
  let { stufe, slug, meetings, onselect, ondelete, onload }: Props = $props();
  const MONTH_LABEL = new Intl.DateTimeFormat('de-DE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const DATE_LABEL = new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const stats = $derived(monthlyStats(meetings, stufe));
  const rows = $derived(
    meetings.filter((m) => m.stufe === stufe).toSorted((a, b) => b.date.localeCompare(a.date))
  );
  let expanded = $state('');
  let detail = $state<AnwesenheitTermin | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let deleting = $state(false);
  let message = $state<string | null>(null);
  let messageKind = $state<'success' | 'error'>('success');
  let heading = $state<HTMLElement | null>(null);
  let revision = 0;
  let controller: AbortController | null = null;
  onDestroy(() => {
    revision++;
    controller?.abort();
  });

  function formatDate(date: string): string {
    return DATE_LABEL.format(new Date(`${date}T00:00:00Z`));
  }

  function plural(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`;
  }

  async function load(date: string): Promise<void> {
    const current = ++revision;
    controller?.abort();
    controller = new AbortController();
    expanded = date;
    detail = null;
    error = null;
    loading = true;
    try {
      const result = await fetchApi<AnwesenheitTermin>(
        `/intern/anwesenheit/${slug}/${date}`,
        controller.signal
      );
      if (current === revision) {
        if (result.etag === null) {
          collapse();
          ondelete(date);
          message = `Die Gruppenstunde am ${formatDate(date)} wurde inzwischen gelöscht. Die Übersicht wurde aktualisiert.`;
          messageKind = 'success';
          await tick();
          heading?.focus();
          return;
        }
        detail = result;
        onload({
          stufe: result.stufe,
          date: result.date,
          notes: result.notes,
          cancelled: result.cancelled,
          members:
            result.children.filter((child) => child.status === 'anwesend').length +
            result.anonymized,
          excused:
            result.children.filter((child) => child.status === 'entschuldigt').length +
            result.anonymizedExcused,
          guests: result.guests.length + result.anonymizedGuests,
        });
      }
    } catch (caught) {
      if (current === revision)
        error = errorMessage(
          caught,
          'Die Namen konnten nicht geladen werden. Es wurde nichts geändert. Prüfe deine Internetverbindung und tippe auf „Erneut versuchen“.'
        );
    } finally {
      if (current === revision) loading = false;
    }
  }
  function collapse(): void {
    revision++;
    controller?.abort();
    expanded = '';
    detail = null;
    error = null;
    loading = false;
  }
  function toggle(date: string): void {
    if (expanded !== date) void load(date);
    else collapse();
  }

  /** Deletes the Termin of `date` if nobody changed it since it was opened (`etag`). */
  async function remove(date: string, termin: AnwesenheitTermin): Promise<void> {
    const label = formatDate(date);
    const confirmed = await confirmAction({
      title: `Gruppenstunde ${stufe} am ${label} löschen?`,
      message:
        'Gelöscht werden die Anwesenheit, die Gäste und der Text zu dieser Gruppenstunde. Das lässt sich nicht rückgängig machen.',
      confirmLabel: 'Gruppenstunde löschen',
    });
    if (!confirmed) return;
    deleting = true;
    try {
      await sendApi(
        'DELETE',
        `/intern/pflege/anwesenheit/${slug}/${date}`,
        { attendance: attendanceSnapshot(termin) },
        {
          etag: termin.etag ?? undefined,
        }
      );
      collapse();
      message = `Gruppenstunde am ${label} gelöscht.`;
      messageKind = 'success';
      ondelete(date);
      await tick();
      heading?.focus();
    } catch (caught) {
      const conflict = caught instanceof ApiError && [409, 412].includes(caught.status);
      message = conflict
        ? `Jemand anderes hat die Gruppenstunde am ${label} inzwischen geändert. Sie wurde nicht gelöscht. Prüfe den neuen Stand, bevor du sie löschst.`
        : errorMessage(
            caught,
            `Die Gruppenstunde am ${label} wurde nicht gelöscht. Tippe noch einmal auf „Gruppenstunde löschen“.`
          );
      messageKind = 'error';
      if (conflict) void load(date);
    } finally {
      deleting = false;
    }
  }
  let wideTable = $state(false);
  function watchTable(node: HTMLElement): { destroy: () => void } {
    const measure = (): void => {
      wideTable = node.scrollWidth > node.clientWidth + 1;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return { destroy: () => observer.disconnect() };
  }
</script>

{#snippet names(title: string, list: string[])}
  {#if list.length > 0}
    <div>
      <h4 class="font-semibold">{title}</h4>
      <ul aria-label={title} class="mt-1 space-y-1">
        {#each list as name, index (`${index}-${name}`)}
          <li>{name}</li>
        {/each}
      </ul>
    </div>
  {/if}
{/snippet}

<StatusNotice {message} kind={messageKind} popup />

<section aria-labelledby="anwesenheit-verlauf" class="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h2
      id="anwesenheit-verlauf"
      class="font-serif text-2xl text-brand-900"
      tabindex="-1"
      bind:this={heading}
    >
      {stufe}: Verlauf & Statistik
    </h2>
    {#if rows.length > 0}
      <PdfDownloadButton
        download={async () => {
          const [shownStufe, shown] = [stufe, meetings];
          await (
            await import('../../lib/anwesenheitPdf')
          ).downloadAnwesenheitReport(shownStufe, shown);
        }}
      />
    {/if}
  </div>
  {#if rows.length === 0}
    <p class="text-sm text-neutral-700">Für diese Stufe ist noch nichts erfasst.</p>
  {:else}
    <div class="space-y-3">
      <AnwesenheitDiagramm {stats} />
      <details>
        <summary class="min-h-11 cursor-pointer py-3 text-sm font-semibold text-link"
          >Zahlen pro Monat als Tabelle</summary
        >
        {#if wideTable}<p class="text-xs text-neutral-700">Seitlich wischen ›</p>{/if}
        <div class="overflow-x-auto" use:watchTable>
          <table class="w-full text-left text-sm whitespace-nowrap">
            <thead class="border-b border-neutral-300 text-neutral-700">
              <tr>
                <th scope="col" class="py-2 pr-4 font-semibold">Monat</th>
                <th scope="col" class="py-2 pr-4 text-right font-semibold">Gruppenstunden</th>
                <th scope="col" class="py-2 pr-4 text-right font-semibold">Kinder im Schnitt</th>
                <th scope="col" class="py-2 pr-4 text-right font-semibold">Entschuldigt</th>
                <th scope="col" class="py-2 pr-4 text-right font-semibold">Gäste</th>
                <th scope="col" class="py-2 text-right font-semibold">Ausgefallen</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-neutral-200">
              {#each stats as row (row.month)}
                <tr>
                  <th scope="row" class="py-2 pr-4 font-normal"
                    >{MONTH_LABEL.format(new Date(`${row.month}-01T00:00:00Z`))}</th
                  >
                  <td class="py-2 pr-4 text-right tabular-nums">{row.termine}</td>
                  <td class="py-2 pr-4 text-right tabular-nums"
                    >{row.termine === 0
                      ? '–'
                      : averageMembers(row).toLocaleString('de-DE', {
                          maximumFractionDigits: 1,
                        })}</td
                  >
                  <td class="py-2 pr-4 text-right tabular-nums">{row.excused}</td>
                  <td class="py-2 pr-4 text-right tabular-nums">{row.guests}</td>
                  <td class="py-2 text-right tabular-nums">{row.cancelled}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </details>
    </div>

    <div class="space-y-3">
      <h3 class="font-semibold text-brand-900">Gruppenstunden</h3>
      <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
        {#each rows as meeting (meeting.date)}
          <!-- The opened details may be newer than the list, e.g. after a conflict -->
          {@const notes =
            expanded === meeting.date && detail?.date === meeting.date
              ? detail.notes
              : meeting.notes}
          <li data-meeting-date={meeting.date} class="pb-3">
            <ActionButton
              variant="secondary"
              type="button"
              class="w-full justify-start border-0! bg-transparent! px-0! text-left!"
              aria-expanded={expanded === meeting.date}
              aria-controls={`anwesenheit-namen-${slug}-${meeting.date}`}
              onclick={() => toggle(meeting.date)}
            >
              <span class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span>{formatDate(meeting.date)}</span>
                <span class="font-normal text-neutral-700"
                  >{meeting.cancelled
                    ? 'Ausgefallen'
                    : `${plural(meeting.members, 'Kind', 'Kinder')} · ${meeting.excused} entschuldigt · ${plural(meeting.guests, 'Gast', 'Gäste')}`}</span
                >
                <span class="text-link"
                  >{expanded === meeting.date ? 'Details ausblenden' : 'Details ansehen'}</span
                >
              </span>
            </ActionButton>
            <p class={['text-sm whitespace-pre-line', { 'text-neutral-700': !notes }]}>
              {notes || 'Kein Inhalt erfasst'}
            </p>
            {#if expanded === meeting.date}
              <div id={`anwesenheit-namen-${slug}-${meeting.date}`} class="mt-3 space-y-3 text-sm">
                <LoadState
                  data={detail}
                  {loading}
                  {error}
                  loadingText="Namen werden geladen …"
                  onretry={() => void load(meeting.date)}
                >
                  {#snippet children(termin)}
                    {@const nameOf = (child: AnwesenheitTermin['children'][number]) =>
                      child.kind === 'unbekannt'
                        ? 'Ein Kind (Name nicht mehr verfügbar)'
                        : `${child.firstName} ${child.lastName}`}
                    {@const present = termin.children.filter((c) => c.status === 'anwesend')}
                    {@const excused = termin.children.filter((c) => c.status === 'entschuldigt')}
                    {#if !termin.cancelled}
                      {#if present.length || excused.length || termin.guests.length}
                        {@render names('Anwesend', present.map(nameOf))}
                        {@render names('Entschuldigt', excused.map(nameOf))}
                        {@render names(
                          'Gäste',
                          termin.guests.map((guest) => guest.name)
                        )}
                      {:else if !termin.anonymized && !termin.anonymizedExcused && !termin.anonymizedGuests}
                        <p>Keine Kinder oder Gäste eingetragen.</p>
                      {/if}
                      {#if termin.anonymized || termin.anonymizedExcused || termin.anonymizedGuests}
                        <p class="text-neutral-700">
                          Ohne Namen (nach zwölf Monaten gelöscht): {plural(
                            termin.anonymized,
                            'Kind',
                            'Kinder'
                          )} da,
                          {termin.anonymizedExcused} entschuldigt und {plural(
                            termin.anonymizedGuests,
                            'Gast',
                            'Gäste'
                          )}.
                        </p>
                      {/if}
                    {/if}
                    <div class="flex flex-wrap gap-3">
                      <ActionButton
                        variant="secondary"
                        type="button"
                        onclick={() => onselect(meeting.date)}
                        >{termin.editable ? 'Bearbeiten' : 'Ansehen'}</ActionButton
                      >
                      {#if termin.editable}
                        <ActionButton
                          variant="danger"
                          type="button"
                          disabled={deleting}
                          aria-busy={deleting}
                          onclick={() => remove(meeting.date, termin)}
                          >Gruppenstunde löschen</ActionButton
                        >
                      {/if}
                    </div>
                  {/snippet}
                </LoadState>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>
