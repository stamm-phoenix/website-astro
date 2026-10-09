<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import type { ProtokollTermin, StaffProtokoll } from '../../lib/types';

  interface Props {
    protokoll: StaffProtokoll;
    /** Whether the user may confirm, correct or reject the date. */
    reviewer: boolean;
    /** Action of this block that is running, if any. */
    busy: 'erkennen' | 'ablehnen' | null;
    /** Opens the form; `prefill` uses the suggestion, otherwise the confirmed date or nothing. */
    onedit: (protokoll: StaffProtokoll, prefill: boolean) => void;
    onreject: (protokoll: StaffProtokoll) => void;
    onrecognize: (protokoll: StaffProtokoll) => void;
  }

  let { protokoll, reviewer, busy, onedit, onreject, onrecognize }: Props = $props();

  const dateFormatter = new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const dateTimeFormatter = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const termin = $derived<ProtokollTermin | null>(protokoll.termin);
  const stale = $derived(protokoll.terminStale);
  const decision = $derived(termin?.decision ?? 'offen');
  const extraction = $derived(termin?.extraction ?? null);
  const hasSuggestion = $derived(
    termin !== null &&
      (termin.extraction === 'gefunden' || termin.extraction === 'unklar') &&
      Boolean(termin.suggestion.date || termin.suggestion.time || termin.suggestion.place)
  );
  /** Reading again helps when nothing or something unclear was found, or the reading failed. */
  const mayRecognize = $derived(
    !stale &&
      (extraction === null ||
        extraction === 'unklar' ||
        extraction === 'nicht gefunden' ||
        extraction === 'fehler')
  );
  /** The server refuses decisions on a stale suggestion and when nothing was read yet. */
  const mayDecide = $derived(reviewer && !stale && termin !== null);
  const anyBusy = $derived(busy !== null);
  const headingId = $derived(`protokoll-termin-${protokoll.id}`);

  function formatDate(date: string | null): string {
    return date ? dateFormatter.format(new Date(`${date}T12:00:00`)) : '';
  }

  function formatDateTime(iso: string): string {
    return iso ? dateTimeFormatter.format(new Date(iso)) : '';
  }

  /** Date, time and place in one line, e.g. „Dienstag, 14. Oktober 2026, 19:30 Uhr, Pfarrheim“. */
  function describe(value: {
    date: string | null;
    time: string | null;
    place: string | null;
  }): string {
    return [
      value.date ? formatDate(value.date) : 'Datum unklar',
      value.time ? `${value.time} Uhr` : '',
      value.place ?? '',
    ]
      .filter(Boolean)
      .join(', ');
  }
</script>

<section aria-labelledby={headingId} class="space-y-2 border-l-2 border-neutral-300 py-1 pl-4">
  <h3 id={headingId} class="text-sm font-semibold text-brand-900">
    Nächste Leitendenrunde<span class="sr-only"> laut {protokoll.title}</span>
  </h3>

  {#if stale}
    <p class="border-l-2 border-warning py-1 pl-3 text-sm text-warning">
      Die Datei wurde nach der Freigabe geändert, der erkannte Termin passt womöglich nicht mehr.
      Das Protokoll muss erneut ins Review.
    </p>
  {/if}

  {#if termin && decision === 'bestaetigt' && termin.confirmed}
    <p class="text-sm text-neutral-800">
      <span class="font-semibold">{describe(termin.confirmed)}</span>
    </p>
    <p class="text-xs text-neutral-700">
      Bestätigt{termin.decidedBy ? ` von ${termin.decidedBy}` : ''}{termin.decidedAt
        ? ` am ${formatDateTime(termin.decidedAt)}`
        : ''}
    </p>
    {#if mayDecide}
      <div class="flex flex-wrap gap-2">
        <ActionButton
          variant="secondary"
          type="button"
          disabled={anyBusy}
          onclick={() => onedit(protokoll, false)}
        >
          Ändern<span class="sr-only"> (nächste Leitendenrunde)</span>
        </ActionButton>
      </div>
    {/if}
  {:else if termin && decision === 'abgelehnt'}
    <p class="text-sm text-neutral-800">Kein nächster Termin eingetragen.</p>
    {#if termin.decidedBy || termin.decidedAt}
      <p class="text-xs text-neutral-700">
        Festgelegt{termin.decidedBy ? ` von ${termin.decidedBy}` : ''}{termin.decidedAt
          ? ` am ${formatDateTime(termin.decidedAt)}`
          : ''}
      </p>
    {/if}
    {#if mayDecide}
      <div class="flex flex-wrap gap-2">
        <ActionButton
          variant="secondary"
          type="button"
          disabled={anyBusy}
          onclick={() => onedit(protokoll, false)}
        >
          Neu eintragen<span class="sr-only"> (nächste Leitendenrunde)</span>
        </ActionButton>
      </div>
    {/if}
  {:else}
    {#if termin && hasSuggestion}
      <p class="text-sm text-neutral-800">
        {termin.extraction === 'unklar' ? 'Unsicherer Vorschlag:' : 'Vorschlag:'}
        <span class="font-semibold">{describe(termin.suggestion)}</span>
      </p>
      {#if termin.suggestion.quote}
        <figure class="text-sm">
          <figcaption class="text-xs text-neutral-700">Fundstelle im Protokoll</figcaption>
          <blockquote
            class="mt-1 border-l-2 border-neutral-300 pl-3 whitespace-pre-line text-neutral-800 italic"
          >
            {termin.suggestion.quote}
          </blockquote>
        </figure>
      {/if}
      <p class="text-xs text-neutral-700">
        Der Vorschlag stammt aus einer automatischen Auswertung des Protokolls und muss geprüft
        werden.{reviewer ? '' : ' Der Vorstand bestätigt ihn.'}
      </p>
    {:else if extraction === 'nicht gefunden' || (extraction === 'unklar' && !hasSuggestion)}
      <p class="text-sm text-neutral-800">
        Im Protokoll wurde kein nächster Termin gefunden.{reviewer
          ? ' Du kannst ihn selbst eintragen.'
          : ''}
      </p>
    {:else if extraction === 'fehler'}
      <p class="text-sm text-neutral-800">
        Die automatische Auswertung hat nicht geklappt.{reviewer
          ? ' Du kannst den Termin selbst eintragen oder es erneut versuchen.'
          : ''}
      </p>
    {:else if extraction === 'nicht eingerichtet'}
      <p class="text-sm text-neutral-800">
        Die automatische Auswertung ist nicht eingerichtet.{reviewer
          ? ' Trag den Termin bitte selbst ein.'
          : ''}
      </p>
    {:else}
      <p class="text-sm text-neutral-800">Noch kein Termin erkannt oder eingetragen.</p>
    {/if}

    {#if reviewer && (mayDecide || mayRecognize)}
      <div class="flex flex-wrap gap-2">
        {#if mayDecide}
          {#if hasSuggestion}
            <ActionButton
              variant="primary"
              type="button"
              disabled={anyBusy}
              onclick={() => onedit(protokoll, true)}
            >
              Bestätigen<span class="sr-only"> (nächste Leitendenrunde)</span>
            </ActionButton>
          {:else}
            <ActionButton
              variant="secondary"
              type="button"
              disabled={anyBusy}
              onclick={() => onedit(protokoll, false)}
            >
              Termin eintragen
            </ActionButton>
          {/if}
          <ActionButton
            variant="secondary"
            type="button"
            disabled={anyBusy}
            aria-busy={busy === 'ablehnen'}
            onclick={() => onreject(protokoll)}
          >
            {busy === 'ablehnen' ? 'Wird gespeichert …' : 'Kein Termin'}
          </ActionButton>
        {/if}
        {#if mayRecognize}
          <ActionButton
            variant="secondary"
            type="button"
            disabled={anyBusy}
            aria-busy={busy === 'erkennen'}
            onclick={() => onrecognize(protokoll)}
          >
            {#if busy === 'erkennen'}
              Wird erkannt …
            {:else}
              {extraction === null ? 'Termin erkennen' : 'Erneut erkennen'}
            {/if}
          </ActionButton>
        {/if}
      </div>
    {/if}
  {/if}
</section>
