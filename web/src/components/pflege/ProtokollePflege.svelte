<script lang="ts">
  import { tick, untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import EditDialog from './EditDialog.svelte';
  import FormField from './FormField.svelte';
  import ProtokollTerminBlock from './ProtokollTerminBlock.svelte';
  import ReloadButton from './ReloadButton.svelte';
  import StatusNotice from './StatusNotice.svelte';
  import { ApiError, fetchApi, fetchFile, saveFile, sendApi } from '../../lib/api';
  import { protokollePflege } from '../../lib/pflegeStore.svelte';
  import type {
    ProtokollStatus,
    ProtokollTermin,
    ProtokollTerminRequest,
    StaffProtokoll,
  } from '../../lib/types';

  type Filter = 'offen' | 'erledigt' | 'alle';
  type Action = 'review' | 'approve' | 'reject' | 'reopen';

  const STATUS_TONE: Record<ProtokollStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
    Entwurf: 'neutral',
    Review: 'warning',
    Freigegeben: 'success',
    Verschickt: 'success',
    Archiv: 'neutral',
  };
  const STATUS_LABEL: Record<ProtokollStatus, string> = {
    Entwurf: 'Entwurf',
    Review: 'Im Review',
    Freigegeben: 'Freigegeben',
    Verschickt: 'Verschickt',
    Archiv: 'Archiv',
  };

  const store = protokollePflege.state;
  const dateFormatter = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });
  const dateTimeFormatter = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  let filter = $state<Filter>('offen');
  let message = $state<string | null>(null);
  let messageKind = $state<'success' | 'warning' | 'error'>('success');
  /** ID of the minutes whose action is running. */
  let busyId = $state<string | null>(null);
  /** Read-only preview shown below one of the minutes. */
  let preview = $state<{ id: string; url: string | null; error: string | null } | null>(null);

  let creating = $state<{ title: string; date: string } | null>(null);
  let createErrors = $state<Record<string, string>>({});
  let createError = $state<string | null>(null);
  let createBusy = $state(false);

  let rejecting = $state<{ protokoll: StaffProtokoll; note: string } | null>(null);
  let rejectError = $state<string | null>(null);
  let rejectFieldError = $state<string | null>(null);

  let sending = $state<{
    protokoll: StaffProtokoll;
    recipients: number;
    version: string;
    retry: boolean;
  } | null>(null);
  let sendError = $state<string | null>(null);
  let sendBusy = $state(false);

  /** Inline action of a „Nächste Leitendenrunde“ block that is running. */
  let terminBusy = $state<{ id: string; action: 'erkennen' | 'ablehnen' } | null>(null);
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
  let terminErrors = $state<Record<string, string>>({});
  let terminError = $state<string | null>(null);
  let terminFormBusy = $state(false);

  let deleting = $state<StaffProtokoll | null>(null);
  let deleteError = $state<string | null>(null);
  let deleteBusy = $state(false);

  const data = $derived(store.data);
  const items = $derived(
    [...(data?.items ?? [])].sort(
      (a, b) => b.date.localeCompare(a.date) || b.lastModifiedAt.localeCompare(a.lastModifiedAt)
    )
  );
  const isDone = (item: StaffProtokoll): boolean =>
    item.status === 'Verschickt' || item.status === 'Archiv';
  const openItems = $derived(items.filter((item) => !isDone(item)));
  const visible = $derived(
    filter === 'offen' ? openItems : filter === 'erledigt' ? items.filter(isDone) : items
  );

  $effect(() => {
    untrack(() => protokollePflege.load());
  });

  // A link from the mail points to `#protokoll-<id>`; scroll there once the list is loaded
  let scrolledToHash = false;
  $effect(() => {
    if (!data || scrolledToHash) return;
    scrolledToHash = true;
    const id = location.hash.match(/^#protokoll-(.+)$/)?.[1];
    if (!id) return;
    if (!openItems.some((item) => item.id === id)) filter = 'alle';
    void tick().then(() => document.getElementById(`protokoll-${id}`)?.scrollIntoView());
  });

  function isOwn(protokoll: StaffProtokoll): boolean {
    return protokoll.createdBy.toLowerCase() === (data?.login ?? '').toLowerCase();
  }

  function formatMeetingDate(protokoll: StaffProtokoll): string {
    return protokoll.date ? dateFormatter.format(new Date(`${protokoll.date}T12:00:00`)) : '';
  }

  function formatDateTime(iso: string): string {
    return iso ? dateTimeFormatter.format(new Date(iso)) : '';
  }

  /** Who created, changed, approved and sent the minutes, one line each. */
  function historyLines(protokoll: StaffProtokoll): string[] {
    const changed = [
      `Zuletzt geändert ${formatDateTime(protokoll.lastModifiedAt)}`,
      protokoll.lastModifiedBy ? `von ${protokoll.lastModifiedBy}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const lines = [
      [protokoll.createdBy ? `Angelegt von ${protokoll.createdBy}` : '', changed]
        .filter(Boolean)
        .join(' · '),
    ];
    if (protokoll.approvedBy && protokoll.approvedAt) {
      lines.push(
        `Freigegeben von ${protokoll.approvedBy} am ${formatDateTime(protokoll.approvedAt)}`
      );
    }
    if (protokoll.delivery?.state === 'sent') {
      const at = protokoll.delivery.at ? ` am ${formatDateTime(protokoll.delivery.at)}` : '';
      lines.push(`An ${protokoll.delivery.recipients} Leitende verschickt${at}`);
    }
    return lines;
  }

  function notify(text: string, kind: 'success' | 'warning' | 'error' = 'success'): void {
    message = text;
    messageKind = kind;
  }

  function errorText(error: unknown, fallback: string): string {
    return error instanceof ApiError ? error.message : fallback;
  }

  function todayIso(): string {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
  }

  function startCreate(): void {
    creating = { title: data?.defaultTitle ?? '', date: todayIso() };
    createErrors = {};
    createError = null;
  }

  async function create(): Promise<void> {
    if (!creating) return;
    createBusy = true;
    createErrors = {};
    createError = null;
    try {
      const { title, date } = creating;
      await sendApi<{ id: string; webUrl: string }>('POST', '/intern/pflege/protokolle', {
        title,
        date,
      });
      creating = null;
      filter = 'offen';
      notify(`Protokoll „${title}“ angelegt. Öffne es mit „In Word bearbeiten“.`);
      await protokollePflege.load({ force: true });
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) createErrors = error.fields;
      createError = errorText(error, 'Das Protokoll konnte nicht angelegt werden.');
    } finally {
      createBusy = false;
    }
  }

  const ACTION_DONE: Record<Action, string> = {
    review: 'zum Review gegeben',
    approve: 'freigegeben',
    reject: 'zurückgegeben',
    reopen: 'wieder zur Bearbeitung geöffnet',
  };

  async function changeState(protokoll: StaffProtokoll, action: Action, note = ''): Promise<void> {
    busyId = protokoll.id;
    try {
      const result = await sendApi<{ mailSent: boolean }>(
        'POST',
        `/intern/pflege/protokolle/${encodeURIComponent(protokoll.id)}`,
        { action, etag: protokoll.etag, note }
      );
      const done = `„${protokoll.title}“ ${ACTION_DONE[action]}.`;
      if (action === 'reject' && !result.mailSent) {
        notify(
          `${done} Die Mail an ${protokoll.createdBy || 'die Person'} ging nicht raus.`,
          'warning'
        );
      } else {
        notify(done);
      }
      await protokollePflege.load({ force: true });
    } catch (error: unknown) {
      if (action === 'reject') throw error;
      notify(errorText(error, 'Das hat nicht geklappt.'), 'error');
    } finally {
      busyId = null;
    }
  }

  async function submitReject(): Promise<void> {
    if (!rejecting) return;
    rejectError = null;
    rejectFieldError = null;
    try {
      await changeState(rejecting.protokoll, 'reject', rejecting.note);
      rejecting = null;
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields?.note) rejectFieldError = error.fields.note;
      else rejectError = errorText(error, 'Das Zurückgeben hat nicht geklappt.');
    }
  }

  async function copyLink(protokoll: StaffProtokoll): Promise<void> {
    try {
      await navigator.clipboard.writeText(protokoll.webUrl);
      notify('Link kopiert. Alle Leitenden mit Zugriff auf SharePoint können damit mitschreiben.');
    } catch {
      notify(`Kopieren nicht möglich. Link: ${protokoll.webUrl}`, 'warning');
    }
  }

  async function togglePreview(protokoll: StaffProtokoll): Promise<void> {
    if (preview?.id === protokoll.id) {
      preview = null;
      return;
    }
    preview = { id: protokoll.id, url: null, error: null };
    try {
      const { url } = await fetchApi<{ url: string }>(
        `/intern/pflege/protokolle/${encodeURIComponent(protokoll.id)}/vorschau`
      );
      if (preview?.id === protokoll.id) preview.url = url;
    } catch (error: unknown) {
      if (preview?.id === protokoll.id) {
        preview.error = errorText(error, 'Die Vorschau konnte nicht geladen werden.');
      }
    }
  }

  async function downloadPdf(protokoll: StaffProtokoll): Promise<void> {
    busyId = protokoll.id;
    try {
      const { blob, fileName } = await fetchFile(
        `/intern/pflege/protokolle/${encodeURIComponent(protokoll.id)}/pdf`
      );
      saveFile(blob, fileName ?? protokoll.fileName.replace(/\.docx$/i, '.pdf'));
    } catch (error: unknown) {
      notify(errorText(error, 'Das PDF konnte nicht erstellt werden.'), 'error');
    } finally {
      busyId = null;
    }
  }

  /** Minutes that were not sent yet; the author and the reviewers may delete them. */
  function mayDelete(protokoll: StaffProtokoll): boolean {
    return (
      protokoll.status !== 'Verschickt' &&
      protokoll.status !== 'Archiv' &&
      !protokoll.delivery &&
      (data?.reviewer === true || isOwn(protokoll))
    );
  }

  async function remove(): Promise<void> {
    if (!deleting) return;
    deleteBusy = true;
    deleteError = null;
    try {
      const protokoll = deleting;
      await sendApi(
        'DELETE',
        `/intern/pflege/protokolle/${encodeURIComponent(protokoll.id)}`,
        undefined,
        { etag: protokoll.etag }
      );
      deleting = null;
      if (preview?.id === protokoll.id) preview = null;
      notify(`„${protokoll.title}“ gelöscht. Es liegt im SharePoint-Papierkorb.`);
      await protokollePflege.load({ force: true });
    } catch (error: unknown) {
      deleteError = errorText(error, 'Das Löschen hat nicht geklappt.');
    } finally {
      deleteBusy = false;
    }
  }

  /** The newest archived minutes: older ones have no use for a next date. */
  const newestArchivId = $derived(items.find((item) => item.status === 'Archiv')?.id ?? null);

  /** Minutes whose next meeting is shown: approved and sent ones, and the newest archived. */
  function showsTermin(protokoll: StaffProtokoll): boolean {
    return (
      protokoll.status === 'Freigegeben' ||
      protokoll.status === 'Verschickt' ||
      (protokoll.status === 'Archiv' &&
        (protokoll.id === newestArchivId || protokoll.termin !== null))
    );
  }

  async function sendTermin(
    protokoll: StaffProtokoll,
    body: Omit<ProtokollTerminRequest, 'etag'>
  ): Promise<ProtokollTermin> {
    const response = await sendApi<{ termin: ProtokollTermin }>(
      'POST',
      `/intern/pflege/protokolle/${encodeURIComponent(protokoll.id)}/termin`,
      { ...body, etag: protokoll.etag }
    );
    return response.termin;
  }

  /** A 409 means someone else changed the minutes; reload so the next try uses the new version. */
  async function reloadOnConflict(error: unknown): Promise<void> {
    if (error instanceof ApiError && error.status === 409) {
      await protokollePflege.load({ force: true });
    }
  }

  function startTermin(protokoll: StaffProtokoll, prefill: boolean): void {
    const termin = protokoll.termin;
    const source =
      prefill && termin
        ? termin.suggestion
        : termin?.decision === 'bestaetigt'
          ? termin.confirmed
          : null;
    terminForm = {
      protokoll,
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
    terminErrors = {};
    terminError = null;
  }

  async function confirmTermin(): Promise<void> {
    if (!terminForm) return;
    terminFormBusy = true;
    terminErrors = {};
    terminError = null;
    const { protokoll, date, time, place } = terminForm;
    try {
      await sendTermin(protokoll, {
        action: 'bestaetigen',
        date,
        ...(time ? { time } : {}),
        ...(place.trim() ? { place: place.trim() } : {}),
      });
      terminForm = null;
      notify(`Nächste Leitendenrunde für „${protokoll.title}“ gespeichert.`);
      await protokollePflege.load({ force: true });
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) terminErrors = error.fields;
      terminError = errorText(error, 'Der Termin konnte nicht gespeichert werden.');
      await reloadOnConflict(error);
      // Keep the input, but continue from the reloaded version of the minutes
      const fresh = data?.items.find((item) => item.id === protokoll.id);
      if (terminForm && fresh) terminForm.protokoll = fresh;
    } finally {
      terminFormBusy = false;
    }
  }

  async function terminAction(
    protokoll: StaffProtokoll,
    action: 'erkennen' | 'ablehnen'
  ): Promise<void> {
    terminBusy = { id: protokoll.id, action };
    try {
      const termin = await sendTermin(protokoll, { action });
      if (action === 'ablehnen') {
        notify(`Für „${protokoll.title}“ ist kein nächster Termin eingetragen.`);
      } else if (termin.extraction === 'gefunden' || termin.extraction === 'unklar') {
        notify(`Termin in „${protokoll.title}“ erkannt. Bitte prüfen und bestätigen.`);
      } else if (termin.extraction === 'nicht gefunden') {
        notify(`In „${protokoll.title}“ wurde kein Termin erkannt.`, 'warning');
      } else if (termin.extraction === 'nicht eingerichtet') {
        notify(
          'Die automatische Auswertung ist nicht eingerichtet. Bitte den Termin selbst eintragen.',
          'warning'
        );
      } else {
        notify(
          'Die automatische Auswertung hat nicht geklappt. Bitte erneut versuchen oder den Termin selbst eintragen.',
          'warning'
        );
      }
      await protokollePflege.load({ force: true });
    } catch (error: unknown) {
      notify(errorText(error, 'Das hat nicht geklappt.'), 'error');
      await reloadOnConflict(error);
    } finally {
      terminBusy = null;
    }
  }

  async function startSend(protokoll: StaffProtokoll, retry = false): Promise<void> {
    busyId = protokoll.id;
    sendError = null;
    try {
      const preview = await sendApi<{ recipients: number; version: string }>(
        'POST',
        `/intern/pflege/protokolle/${encodeURIComponent(protokoll.id)}/versand`,
        { action: 'preview', retry }
      );
      sending = { protokoll, ...preview, retry };
    } catch (error: unknown) {
      notify(errorText(error, 'Die Leitenden konnten nicht geladen werden.'), 'error');
    } finally {
      busyId = null;
    }
  }

  async function send(): Promise<void> {
    if (!sending) return;
    sendBusy = true;
    sendError = null;
    try {
      const { protokoll, version, retry } = sending;
      const result = await sendApi<{ recipients: number }>(
        'POST',
        `/intern/pflege/protokolle/${encodeURIComponent(protokoll.id)}/versand`,
        { action: 'send', version, retry, etag: protokoll.etag }
      );
      sending = null;
      notify(`„${protokoll.title}“ an ${result.recipients} Leitende verschickt.`);
      await protokollePflege.load({ force: true });
    } catch (error: unknown) {
      sendError = errorText(error, 'Der Versand hat nicht geklappt.');
      await protokollePflege.load({ force: true });
    } finally {
      sendBusy = false;
    }
  }
</script>

<div class="space-y-6">
  {#if !data && store.loading}
    <div role="status" aria-live="polite" class="space-y-2">
      <span class="sr-only">Protokolle werden geladen …</span>
      {#each [1, 2, 3] as n (n)}
        <div class="skeleton-element h-20 rounded-[var(--radius-lg)]"></div>
      {/each}
    </div>
  {:else if !data}
    <div role="alert" class="border-l-2 border-danger py-1 pl-4">
      <p class="text-sm text-neutral-700">{store.error}</p>
    </div>
  {:else if !data.configured}
    <p class="border-l-2 border-warning py-1 pl-4 text-sm text-neutral-700">
      Die SharePoint-Bibliothek für Protokolle wurde nicht gefunden. Die Einrichtung steht in
      <code>docs/protokolle.md</code>.
    </p>
  {:else}
    <div class="flex flex-wrap items-center justify-between gap-3">
      <ActionButton variant="primary" type="button" onclick={startCreate}>
        Neues Protokoll
      </ActionButton>
      <ReloadButton resource={protokollePflege} />
    </div>

    <p class="max-w-prose text-sm text-neutral-700">
      Protokolle entstehen aus der Word-Vorlage und werden in Word im Browser geschrieben, auch
      gemeinsam während der Sitzung. Danach gibst du es zum Review.
      {#if data.reviewer}
        Nach deiner Freigabe kannst du es an alle Leitenden aus CampFlow schicken.
      {:else}
        Nach der Freigabe durch den Vorstand geht es an alle Leitenden aus CampFlow.
      {/if}
    </p>

    <StatusNotice {message} kind={messageKind} popup />

    <FilterTabs
      label="Protokolle filtern"
      value={filter}
      onselect={(value) => (filter = value)}
      options={[
        { value: 'offen', label: 'Offen', count: openItems.length },
        { value: 'erledigt', label: 'Erledigt', count: items.length - openItems.length },
        { value: 'alle', label: 'Alle', count: items.length },
      ]}
    />

    {#if visible.length === 0}
      <p class="border-t border-neutral-200 py-4 text-sm text-neutral-700">
        {filter === 'offen' ? 'Keine offenen Protokolle.' : 'Noch keine Protokolle.'}
      </p>
    {:else}
      <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
        {#each visible as protokoll (protokoll.id)}
          {@const busy = busyId === protokoll.id}
          {@const own = isOwn(protokoll)}
          <li
            id="protokoll-{protokoll.id}"
            class="scroll-mt-24 space-y-3 py-4"
            aria-labelledby="protokoll-title-{protokoll.id}"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="protokoll-title-{protokoll.id}" class="text-lg font-semibold text-brand-900">
                {protokoll.title}
                {#if protokoll.date}
                  <span class="font-normal text-neutral-700">· {formatMeetingDate(protokoll)}</span>
                {/if}
              </h2>
              <StatusLabel
                label={STATUS_LABEL[protokoll.status]}
                tone={STATUS_TONE[protokoll.status]}
              />
            </div>

            <p class="text-sm text-neutral-700">
              {#each historyLines(protokoll) as line, index (index)}
                {#if index > 0}<br />{/if}{line}
              {/each}
            </p>

            {#if protokoll.status === 'Entwurf' && protokoll.reviewNote}
              <div class="border-l-2 border-warning py-1 pl-4 text-sm">
                <p class="font-semibold text-warning">Zurückgegeben mit dem Hinweis:</p>
                <p class="whitespace-pre-line text-neutral-800">{protokoll.reviewNote}</p>
              </div>
            {/if}
            {#if protokoll.changedSinceApproval && protokoll.status === 'Freigegeben'}
              <p class="border-l-2 border-warning py-1 pl-4 text-sm text-warning">
                Nach der Freigabe geändert. Bitte wieder bearbeiten und erneut zum Review geben.
              </p>
            {/if}
            {#if showsTermin(protokoll)}
              <ProtokollTerminBlock
                {protokoll}
                reviewer={data.reviewer}
                busy={terminBusy?.id === protokoll.id ? terminBusy.action : null}
                onedit={startTermin}
                onreject={(item) => terminAction(item, 'ablehnen')}
                onrecognize={(item) => terminAction(item, 'erkennen')}
              />
            {/if}
            {#if protokoll.delivery?.state === 'attempted'}
              <p class="border-l-2 border-danger py-1 pl-4 text-sm text-danger">
                Der Versand wurde gestartet, aber nicht bestätigt. Bitte im Postfach des Absenders
                unter „Gesendete Elemente“ nachsehen, bevor du erneut sendest.
              </p>
            {/if}

            <div class="flex flex-wrap gap-2">
              {#if protokoll.webUrl}
                <a
                  class="btn-secondary"
                  href={protokoll.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  In Word {isDone(protokoll) ? 'öffnen' : 'bearbeiten'}<span class="sr-only">
                    ({protokoll.title}, neues Fenster)</span
                  >
                </a>
                <ActionButton variant="secondary" type="button" onclick={() => copyLink(protokoll)}>
                  Link kopieren<span class="sr-only"> ({protokoll.title})</span>
                </ActionButton>
              {/if}
              <ActionButton
                variant="secondary"
                type="button"
                disabled={busy}
                onclick={() => downloadPdf(protokoll)}
              >
                PDF<span class="sr-only"> von {protokoll.title} herunterladen</span>
              </ActionButton>
              <ActionButton
                variant="secondary"
                type="button"
                aria-expanded={preview?.id === protokoll.id}
                aria-controls="protokoll-preview-{protokoll.id}"
                onclick={() => togglePreview(protokoll)}
              >
                {preview?.id === protokoll.id ? 'Vorschau schließen' : 'Vorschau'}<span
                  class="sr-only"
                >
                  ({protokoll.title})</span
                >
              </ActionButton>

              {#if protokoll.status === 'Entwurf'}
                <ActionButton
                  variant="primary"
                  type="button"
                  disabled={busy}
                  aria-busy={busy}
                  onclick={() => changeState(protokoll, 'review')}
                >
                  Zum Review geben
                </ActionButton>
              {:else if protokoll.status === 'Review' && data.reviewer}
                {#if own}
                  <span class="self-center text-sm text-neutral-700">
                    Dein eigenes Protokoll gibt jemand anderes frei.
                  </span>
                {:else}
                  <ActionButton
                    variant="primary"
                    type="button"
                    disabled={busy}
                    aria-busy={busy}
                    onclick={() => changeState(protokoll, 'approve')}
                  >
                    Freigeben
                  </ActionButton>
                {/if}
                <ActionButton
                  variant="secondary"
                  type="button"
                  disabled={busy}
                  onclick={() => {
                    rejecting = { protokoll, note: '' };
                    rejectError = null;
                    rejectFieldError = null;
                  }}
                >
                  Zurückgeben
                </ActionButton>
              {:else if protokoll.status === 'Freigegeben'}
                {#if data.reviewer && data.sendingConfigured && !protokoll.changedSinceApproval}
                  <ActionButton
                    variant={protokoll.delivery ? 'danger' : 'primary'}
                    type="button"
                    disabled={busy}
                    aria-busy={busy}
                    onclick={() => startSend(protokoll, protokoll.delivery !== null)}
                  >
                    {protokoll.delivery ? 'Erneut senden' : 'An alle Leitenden schicken'}
                  </ActionButton>
                {/if}
                {#if (data.reviewer || own) && !protokoll.delivery}
                  <ActionButton
                    variant="secondary"
                    type="button"
                    disabled={busy}
                    onclick={() => changeState(protokoll, 'reopen')}
                  >
                    Wieder bearbeiten
                  </ActionButton>
                {/if}
              {/if}
              {#if mayDelete(protokoll)}
                <ActionButton
                  variant="danger"
                  type="button"
                  disabled={busy}
                  onclick={() => {
                    deleting = protokoll;
                    deleteError = null;
                  }}
                >
                  Löschen<span class="sr-only"> ({protokoll.title})</span>
                </ActionButton>
              {/if}
            </div>
            {#if preview?.id === protokoll.id}
              <div id="protokoll-preview-{protokoll.id}">
                {#if preview.error}
                  <p role="alert" class="border-l-2 border-danger py-1 pl-4 text-sm text-danger">
                    {preview.error}
                  </p>
                {:else if preview.url}
                  <iframe
                    src={preview.url}
                    title="Vorschau: {protokoll.title}"
                    class="h-[75vh] w-full border border-neutral-300 bg-white"
                    referrerpolicy="no-referrer"
                  ></iframe>
                {:else}
                  <div role="status" aria-live="polite" class="skeleton-element h-[75vh]">
                    <span class="sr-only">Vorschau wird geladen …</span>
                  </div>
                {/if}
              </div>
            {/if}
            {#if protokoll.status === 'Freigegeben' && data.reviewer && !data.sendingConfigured}
              <p class="text-sm text-neutral-700">
                Für den Versand ist noch kein Absender eingerichtet.
              </p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<EditDialog
  open={creating !== null}
  title="Neues Protokoll"
  busy={createBusy}
  error={createError}
  submitLabel="Anlegen"
  busyLabel="Wird angelegt …"
  onsubmit={create}
  onclose={() => {
    if (!createBusy) creating = null;
  }}
>
  {#if creating}
    <FormField
      id="protokoll-title"
      label="Titel"
      hint="Zum Beispiel „Leitendenrunde“ oder „Stavo-Sitzung“"
      error={createErrors.title}
    >
      {#snippet children(attrs)}
        <input {...attrs} class="form-input" maxlength="80" required bind:value={creating!.title} />
      {/snippet}
    </FormField>
    <FormField id="protokoll-date" label="Datum der Sitzung" error={createErrors.date}>
      {#snippet children(attrs)}
        <input {...attrs} type="date" class="form-input" required bind:value={creating!.date} />
      {/snippet}
    </FormField>
    <p class="text-sm text-neutral-700">
      Die Datei heißt dann „{creating.date}
      {creating.title.trim()}.docx“.
    </p>
  {/if}
</EditDialog>

<EditDialog
  open={rejecting !== null}
  title="Protokoll zurückgeben"
  busy={busyId !== null && busyId === rejecting?.protokoll.id}
  error={rejectError}
  submitLabel="Zurückgeben"
  busyLabel="Wird zurückgegeben …"
  onsubmit={submitReject}
  onclose={() => {
    if (busyId === null) rejecting = null;
  }}
>
  {#if rejecting}
    <FormField
      id="protokoll-note"
      label="Was fehlt noch?"
      hint={rejecting.protokoll.createdBy
        ? `Geht per Mail an ${rejecting.protokoll.createdBy}.`
        : undefined}
      error={rejectFieldError ?? undefined}
    >
      {#snippet children(attrs)}
        <textarea
          {...attrs}
          class="form-input"
          rows="4"
          maxlength="2000"
          required
          bind:value={rejecting!.note}></textarea>
      {/snippet}
    </FormField>
  {/if}
</EditDialog>

<EditDialog
  open={sending !== null}
  title={sending?.retry ? 'Erneut an alle Leitenden schicken?' : 'An alle Leitenden schicken?'}
  busy={sendBusy}
  error={sendError}
  submitLabel={sending ? `An ${sending.recipients} Leitende schicken` : 'Schicken'}
  busyLabel="Wird verschickt …"
  submitDisabled={!sending || sending.recipients === 0}
  onsubmit={send}
  onclose={() => {
    if (!sendBusy) sending = null;
  }}
>
  {#if sending}
    <p class="text-sm text-neutral-800">
      „{sending.protokoll.title}“ geht als PDF mit Link an {sending.recipients} Leitende aus CampFlow,
      in Blindkopie.
    </p>
    {#if sending.retry}
      <p class="text-sm text-danger">
        Ein früherer Versand wurde nicht bestätigt. Schick es nur erneut, wenn die Mail nicht in den
        „Gesendeten Elementen“ des Absenders liegt.
      </p>
    {/if}
    {#if sending.recipients === 0}
      <p class="text-sm text-danger">In CampFlow wurden keine Leitenden mit E-Mail gefunden.</p>
    {/if}
  {/if}
</EditDialog>

<EditDialog
  open={terminForm !== null}
  title={terminForm?.title ?? 'Nächste Leitendenrunde'}
  busy={terminFormBusy}
  error={terminError}
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
          Fundstelle aus der automatischen Auswertung. Bitte vergleichen und bei Bedarf korrigieren.
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

<EditDialog
  open={deleting !== null}
  title="Protokoll löschen?"
  busy={deleteBusy}
  error={deleteError}
  submitLabel="Löschen"
  busyLabel="Wird gelöscht …"
  onsubmit={remove}
  onclose={() => {
    if (!deleteBusy) deleting = null;
  }}
>
  {#if deleting}
    <p class="text-sm text-neutral-800">
      „{deleting.fileName}“ wird gelöscht und verschwindet aus der Liste. Aus dem
      SharePoint-Papierkorb lässt es sich noch wiederherstellen.
    </p>
  {/if}
</EditDialog>
