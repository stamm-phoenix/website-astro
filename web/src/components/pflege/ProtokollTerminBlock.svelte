<script lang="ts">
  import { formatDay, formatDateTime } from '../../lib/format';
  import ActionButton from '../ui/ActionButton.svelte';
  import EditDialog from './EditDialog.svelte';
  import FormField from './FormField.svelte';
  import { createDialogForm } from '../../lib/dialogForm.svelte';
  import { ApiError, errorMessage, sendApi } from '../../lib/api';
  import { protokollePflege } from '../../lib/pflegeStore.svelte';
  import type { ProtokollTermin, ProtokollTerminRequest, StaffProtokoll } from '../../lib/types';

  interface Props {
    protokoll: StaffProtokoll;
    /** Whether recognition is enabled now, independently of earlier extraction results. */
    recognitionConfigured: boolean;
    notify: (text: string, kind?: 'success' | 'warning' | 'error') => void;
  }

  let { protokoll, recognitionConfigured, notify }: Props = $props();

  /** Inline action of a „Nächste Leitendenrunde“ block that is running. */
  let busy = $state<'erkennen' | 'ablehnen' | null>(null);
  let terminForm = $state<{
    protokoll: StaffProtokoll;
    date: string;
    time: string;
    place: string;
    /** Passage of the minutes when the form was prefilled from the suggestion. */
    quote: string | null;
    /** Prefilled from the suggestion: saving confirms (or corrects) it. */
    prefilled: boolean;
    title: string;
  } | null>(null);
  const terminDialog = createDialogForm();
  const terminErrors = $derived(terminDialog.state.fields);
  const terminError = $derived(terminDialog.state.error);
  const terminFormBusy = $derived(terminDialog.state.busy);

  const termin = $derived<ProtokollTermin | null>(protokoll.termin);
  const stale = $derived(protokoll.terminStale);
  const decision = $derived(termin?.decision ?? 'offen');
  const extraction = $derived(termin?.extraction ?? null);
  const hasSuggestion = $derived(
    termin !== null &&
      (termin.extraction === 'gefunden' || termin.extraction === 'unklar') &&
      Boolean(
        termin.suggestion.date ||
        termin.suggestion.time ||
        termin.suggestion.place ||
        termin.suggestion.quote
      )
  );
  /** Unclear or failed readings can be retried, and a rejected suggestion reconsidered. */
  const mayRecognize = $derived(
    (recognitionConfigured || (stale && protokoll.status === 'Archiv')) &&
      !protokoll.changedSinceApproval &&
      (decision === 'abgelehnt' ||
        stale ||
        extraction === null ||
        extraction === 'nicht ausgefuehrt' ||
        extraction === 'nicht eingerichtet' ||
        extraction === 'unklar' ||
        extraction === 'nicht gefunden' ||
        extraction === 'fehler')
  );
  /** Manual decisions also work before the first model call. */
  const mayDecide = $derived(!stale && !protokoll.changedSinceApproval);
  const anyBusy = $derived(busy !== null);
  const headingId = $derived(`protokoll-termin-${protokoll.id}`);

  function formatDate(date: string | null): string {
    return date
      ? formatDay(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : '';
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
  const data = $derived(protokollePflege.state.data);
  function formatMeetingDate(item: StaffProtokoll): string {
    return item.date ? formatDay(item.date) : '';
  }
  async function sendTermin(
    item: StaffProtokoll,
    body: Omit<ProtokollTerminRequest, 'etag'>
  ): Promise<ProtokollTermin> {
    const response = await sendApi<{ termin: ProtokollTermin }>(
      'POST',
      `/intern/pflege/protokolle/${encodeURIComponent(item.id)}/termin`,
      { ...body, etag: item.etag }
    );
    return response.termin;
  }

  /** A 409 means someone else changed the minutes; reload so the next try uses the new version. */
  async function reloadOnConflict(error: unknown): Promise<void> {
    if (error instanceof ApiError && error.status === 409) {
      await protokollePflege.load({ force: true });
    }
  }

  function startTermin(item: StaffProtokoll, prefill: boolean): void {
    const termin = item.termin;
    const source =
      prefill && termin
        ? termin.suggestion
        : termin?.decision === 'bestaetigt'
          ? termin.confirmed
          : null;
    terminForm = {
      protokoll: item,
      date: source?.date ?? '',
      time: source?.time ?? '',
      place: source?.place ?? '',
      quote: prefill ? (termin?.suggestion.quote ?? null) : null,
      prefilled: prefill,
      title: prefill
        ? 'Nächste Leitendenrunde bestätigen'
        : termin?.decision === 'bestaetigt'
          ? 'Nächste Leitendenrunde ändern'
          : 'Nächste Leitendenrunde eintragen',
    };
    terminDialog.reset();
  }

  async function confirmTermin(): Promise<void> {
    if (!terminForm || terminDialog.state.conflict) return;
    terminDialog.state.busy = true;
    terminDialog.state.fields = {};
    terminDialog.state.error = null;
    const { protokoll: item, date, time, place } = terminForm;
    try {
      await sendTermin(item, {
        action: 'bestaetigen',
        date,
        ...(time ? { time } : {}),
        ...(place.trim() ? { place: place.trim() } : {}),
      });
      terminForm = null;
      notify(`Nächste Leitendenrunde für „${item.title}“ gespeichert.`);
      await protokollePflege.load({ force: true });
    } catch (error: unknown) {
      terminDialog.fail(
        error,
        'Der Termin wurde nicht gespeichert. Deine Eingaben sind noch da. Prüfe deine Internetverbindung und tippe noch einmal auf „Speichern“ oder „Bestätigen“.'
      );
    } finally {
      terminDialog.state.busy = false;
    }
  }

  async function reloadTermin(): Promise<boolean> {
    const current = terminForm;
    if (!current) return false;
    await protokollePflege.load({ force: true });
    if (protokollePflege.state.error) {
      terminDialog.state.error = `${protokollePflege.state.error} Deine Eingaben sind noch da.`;
      return false;
    }
    const fresh = data?.items.find((item) => item.id === current.protokoll.id);
    if (!fresh) {
      terminDialog.state.error =
        'Das Protokoll wurde inzwischen gelöscht. Deine Eingaben sind noch da; kopiere sie bei Bedarf vor dem Schließen.';
      return false;
    }
    startTermin(fresh, current.prefilled);
    return true;
  }

  async function terminAction(
    item: StaffProtokoll,
    action: 'erkennen' | 'ablehnen'
  ): Promise<void> {
    busy = action;
    try {
      const termin = await sendTermin(item, { action });
      if (action === 'ablehnen') {
        notify(`Für „${item.title}“ ist kein nächster Termin eingetragen.`);
      } else if (termin.extraction === 'gefunden' || termin.extraction === 'unklar') {
        notify(`Termin in „${item.title}“ erkannt. Bitte prüfen und bestätigen.`);
      } else if (termin.extraction === 'nicht gefunden') {
        notify(`In „${item.title}“ wurde kein Termin erkannt.`, 'warning');
      } else if (termin.extraction === 'nicht eingerichtet') {
        notify(
          'Die automatische Auswertung ist nicht eingerichtet. Bitte den Termin selbst eintragen.',
          'warning'
        );
      } else {
        notify(
          'Die automatische Auswertung hat nicht funktioniert. Tippe noch einmal auf „Erneut erkennen“ oder trage den Termin selbst ein.',
          'warning'
        );
      }
      await protokollePflege.load({ force: true });
    } catch (error: unknown) {
      notify(
        errorMessage(
          error,
          action === 'ablehnen'
            ? 'Der Termin wurde nicht gespeichert. Tippe noch einmal auf „Kein Termin“.'
            : 'Der Termin wurde nicht erkannt. Prüfe deine Internetverbindung und tippe noch einmal auf „Termin erkennen“ oder trage ihn selbst ein.'
        ),
        'error'
      );
      await reloadOnConflict(error);
    } finally {
      busy = null;
    }
  }
</script>

<section aria-labelledby={headingId} class="space-y-2 border-l-2 border-neutral-300 py-1 pl-4">
  <h3 id={headingId} class="text-sm font-semibold text-brand-900">
    Nächste Leitendenrunde<span class="sr-only"> laut {protokoll.title}</span>
  </h3>

  {#if stale || protokoll.changedSinceApproval}
    <p class="border-l-2 border-warning py-1 pl-3 text-sm text-warning">
      {#if protokoll.status === 'Archiv' || !protokoll.changedSinceApproval}
        Der Termin gehört zu einer älteren Fassung.
        {recognitionConfigured
          ? 'Bitte erneut erkennen lassen.'
          : 'Bitte zurücksetzen und den Termin selbst eintragen.'}
      {:else if protokoll.status === 'Freigegeben'}
        Die Datei wurde nach der Freigabe geändert. Bitte wieder bearbeiten und erneut zum Review
        geben.
      {:else}
        Die Datei wurde nach dem Versand geändert. Der Termin gilt für die freigegebene Fassung und
        lässt sich für diese Datei nicht mehr bestätigen.
      {/if}
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
          onclick={() => startTermin(protokoll, false)}
        >
          Ändern<span class="sr-only"> (nächste Leitendenrunde)</span>
        </ActionButton>
        <ActionButton
          variant="secondary"
          type="button"
          disabled={anyBusy}
          aria-busy={busy === 'ablehnen'}
          onclick={() => terminAction(protokoll, 'ablehnen')}
        >
          {busy === 'ablehnen' ? 'Wird gespeichert …' : 'Kein Termin'}
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
          onclick={() => startTermin(protokoll, false)}
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
        werden.
      </p>
    {:else if extraction === 'nicht gefunden' || (extraction === 'unklar' && !hasSuggestion)}
      <p class="text-sm text-neutral-800">
        Im Protokoll wurde kein nächster Termin gefunden. Du kannst ihn selbst eintragen.
      </p>
    {:else if extraction === 'fehler'}
      <p class="text-sm text-neutral-800">
        Die automatische Auswertung hat nicht geklappt. Du kannst den Termin selbst eintragen oder
        es erneut versuchen.
      </p>
    {:else if extraction === 'nicht eingerichtet'}
      <p class="text-sm text-neutral-800">
        {#if recognitionConfigured}
          Bei der letzten Auswertung war die Erkennung noch nicht eingerichtet. Du kannst sie jetzt
          erneut starten oder den Termin selbst eintragen.
        {:else}
          Die automatische Auswertung ist nicht eingerichtet. Trag den Termin bitte selbst ein.
        {/if}
      </p>
    {:else}
      <p class="text-sm text-neutral-800">Noch kein Termin erkannt oder eingetragen.</p>
    {/if}

    {#if mayDecide}
      <div class="flex flex-wrap gap-2">
        {#if hasSuggestion}
          <ActionButton
            variant="primary"
            type="button"
            disabled={anyBusy}
            onclick={() => startTermin(protokoll, true)}
          >
            Bestätigen<span class="sr-only"> (nächste Leitendenrunde)</span>
          </ActionButton>
        {:else}
          <ActionButton
            variant="secondary"
            type="button"
            disabled={anyBusy}
            onclick={() => startTermin(protokoll, false)}
          >
            Termin eintragen
          </ActionButton>
        {/if}
        <ActionButton
          variant="secondary"
          type="button"
          disabled={anyBusy}
          aria-busy={busy === 'ablehnen'}
          onclick={() => terminAction(protokoll, 'ablehnen')}
        >
          {busy === 'ablehnen' ? 'Wird gespeichert …' : 'Kein Termin'}
        </ActionButton>
      </div>
    {/if}
  {/if}
  {#if mayRecognize && (decision === 'offen' || decision === 'abgelehnt' || stale)}
    <ActionButton
      variant="secondary"
      type="button"
      disabled={anyBusy}
      aria-busy={busy === 'erkennen'}
      onclick={() => terminAction(protokoll, 'erkennen')}
    >
      {busy === 'erkennen'
        ? recognitionConfigured
          ? 'Wird erkannt …'
          : 'Wird zurückgesetzt …'
        : !recognitionConfigured
          ? 'Termin zurücksetzen'
          : extraction === null || extraction === 'nicht ausgefuehrt'
            ? 'Termin erkennen'
            : 'Erneut erkennen'}
    </ActionButton>
  {/if}
</section>

{#if terminForm}
  <EditDialog
    open
    title={terminForm?.title ?? 'Nächste Leitendenrunde'}
    busy={terminFormBusy}
    error={terminError}
    submitDisabled={terminDialog.state.conflict}
    onreload={terminDialog.state.conflict ? reloadTermin : undefined}
    submitLabel={terminForm?.prefilled ? 'Bestätigen' : 'Speichern'}
    onsubmit={confirmTermin}
    onclose={() => {
      if (!terminFormBusy) terminForm = null;
    }}
  >
    {#if terminForm}
      <p class="text-sm text-neutral-700">
        Laut „{terminForm.protokoll.title}“{terminForm.protokoll.date
          ? ` vom ${formatMeetingDate(terminForm.protokoll)}`
          : ''}.
      </p>
      {#if terminForm.quote}
        <figure class="text-sm">
          <figcaption class="text-xs text-neutral-700">
            Fundstelle aus der automatischen Auswertung. Bitte vergleichen und bei Bedarf
            korrigieren.
          </figcaption>
          <blockquote
            class="mt-1 border-l-2 border-neutral-300 pl-3 whitespace-pre-line text-neutral-800 italic"
          >
            {terminForm.quote}
          </blockquote>
        </figure>
      {/if}
      <FormField id="protokoll-termin-date" label="Datum" error={terminErrors.date}>
        {#snippet children(attrs)}
          <input {...attrs} type="date" class="form-input" required bind:value={terminForm!.date} />
        {/snippet}
      </FormField>
      <FormField id="protokoll-termin-time" label="Uhrzeit" optional error={terminErrors.time}>
        {#snippet children(attrs)}
          <input {...attrs} type="time" class="form-input" bind:value={terminForm!.time} />
        {/snippet}
      </FormField>
      <FormField id="protokoll-termin-place" label="Ort" optional error={terminErrors.place}>
        {#snippet children(attrs)}
          <input {...attrs} class="form-input" maxlength="120" bind:value={terminForm!.place} />
        {/snippet}
      </FormField>
    {/if}
  </EditDialog>
{/if}
