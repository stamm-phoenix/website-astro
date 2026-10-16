<script lang="ts">
  import { onDestroy } from 'svelte';
  import { monthlyStats } from '../../lib/anwesenheit';
  import { fetchApi, errorMessage } from '../../lib/api';
  import type { AnwesenheitMeeting, AnwesenheitTermin } from '../../lib/types';
  import ActionButton from '../ui/ActionButton.svelte';
  import LoadState from '../ui/LoadState.svelte';

  interface Props {
    stufe: string;
    slug: string;
    meetings: AnwesenheitMeeting[];
    onselect: (date: string) => void;
  }
  let { stufe, slug, meetings, onselect }: Props = $props();
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
  let revision = 0;
  let controller: AbortController | null = null;
  onDestroy(() => {
    revision++;
    controller?.abort();
  });

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
      if (current === revision) detail = result;
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
  function toggle(date: string): void {
    if (expanded !== date) {
      void load(date);
      return;
    }
    revision++;
    controller?.abort();
    expanded = '';
    detail = null;
    error = null;
    loading = false;
  }
</script>

<section aria-labelledby="anwesenheit-verlauf" class="space-y-3">
  <h2 id="anwesenheit-verlauf" class="font-serif text-2xl text-brand-900">
    {stufe}: Verlauf & Statistik
  </h2>
  {#if rows.length === 0}
    <p class="text-sm text-neutral-700">Für diese Stufe ist noch nichts erfasst.</p>
  {:else}
    <p class="text-sm text-neutral-700">Tippe auf einen Termin, um zu sehen, wer da war.</p>
    <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
      {#each rows as meeting (meeting.date)}
        <li data-meeting-date={meeting.date}>
          <ActionButton
            variant="secondary"
            type="button"
            class="w-full justify-start border-0! bg-transparent! px-0! text-left!"
            aria-expanded={expanded === meeting.date}
            aria-controls={`anwesenheit-namen-${slug}-${meeting.date}`}
            onclick={() => toggle(meeting.date)}
          >
            <span class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span>{DATE_LABEL.format(new Date(`${meeting.date}T00:00:00Z`))}</span>
              <span class="font-normal text-neutral-700"
                >{meeting.members}
                {meeting.members === 1 ? 'Kind' : 'Kinder'} · {meeting.guests}
                {meeting.guests === 1 ? 'Gast' : 'Gäste'}</span
              >
              <span class="text-link"
                >{expanded === meeting.date ? 'Namen ausblenden' : 'Namen ansehen'}</span
              >
            </span>
          </ActionButton>
          {#if expanded === meeting.date}
            <div id={`anwesenheit-namen-${slug}-${meeting.date}`} class="space-y-3 pb-4 text-sm">
              <LoadState
                data={detail}
                {loading}
                {error}
                loadingText="Namen werden geladen …"
                onretry={() => void load(meeting.date)}
              >
                {#snippet children(termin)}
                  {#if termin.children.some((child) => child.present) || termin.guests.length}
                    <ul aria-label="Anwesende Kinder und Gäste" class="space-y-1">
                      {#each termin.children.filter((child) => child.present) as child (child.id)}
                        <li>
                          {child.kind === 'unbekannt'
                            ? 'Ein Kind (Name nicht mehr verfügbar)'
                            : `${child.firstName} ${child.lastName}`}
                        </li>
                      {/each}
                      {#each termin.guests as guest (guest.id)}
                        <li>{guest.name} <span class="text-neutral-700">(Gast)</span></li>
                      {/each}
                    </ul>
                  {:else if !termin.anonymized && !termin.anonymizedGuests}
                    <p>Keine Kinder oder Gäste eingetragen.</p>
                  {/if}
                  {#if termin.anonymized || termin.anonymizedGuests}
                    <p class="text-neutral-700">
                      Namen wurden nach Ablauf der Aufbewahrungsfrist entfernt. Erhalten sind die
                      Zahlen: {termin.anonymized}
                      {termin.anonymized === 1 ? 'Kind' : 'Kinder'} und {termin.anonymizedGuests}
                      {termin.anonymizedGuests === 1 ? 'Gast' : 'Gäste'}.
                    </p>
                  {/if}
                  {#if termin.notes}<p>
                      <span class="font-semibold">Notiz:</span>
                      {termin.notes}
                    </p>{/if}
                  <ActionButton
                    variant="secondary"
                    type="button"
                    onclick={() => onselect(meeting.date)}>Termin öffnen</ActionButton
                  >
                {/snippet}
              </LoadState>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    <h3 class="pt-4 font-semibold text-brand-900">Monatsübersicht</h3>
    <p class="text-xs text-neutral-700 sm:hidden">
      Die Übersicht ist breiter als der Bildschirm. Wische seitlich, um alle Zahlen zu sehen.
    </p>
    <div class="overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-neutral-300 text-neutral-700">
          <tr
            ><th scope="col" class="py-2 pr-4 font-semibold">Monat</th><th
              scope="col"
              class="py-2 pr-4 text-right font-semibold">Termine</th
            ><th scope="col" class="py-2 pr-4 text-right font-semibold">Kinder im Schnitt</th><th
              scope="col"
              class="py-2 text-right font-semibold">Gäste</th
            ></tr
          >
        </thead>
        <tbody class="divide-y divide-neutral-200">
          {#each stats as row (row.month)}
            <tr>
              <th scope="row" class="py-2 pr-4 font-normal"
                >{MONTH_LABEL.format(new Date(`${row.month}-01T00:00:00Z`))}</th
              >
              <td class="py-2 pr-4 text-right tabular-nums">{row.termine}</td>
              <td class="py-2 pr-4 text-right tabular-nums"
                >{(row.members / row.termine).toLocaleString('de-DE', {
                  maximumFractionDigits: 1,
                })}</td
              >
              <td class="py-2 text-right tabular-nums">{row.guests}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
