<script lang="ts">
  import { tick, untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import EditDialog from './EditDialog.svelte';
  import FormField from './FormField.svelte';
  import ReloadButton from './ReloadButton.svelte';
  import StatusNotice from './StatusNotice.svelte';
  import { ApiError, fetchFile, saveFile, sendApi } from '../../lib/api';
  import { protokollePflege } from '../../lib/pflegeStore.svelte';
  import type { ProtokollStatus, StaffProtokoll } from '../../lib/types';

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
            {#if protokoll.changedSinceApproval}
              <p class="border-l-2 border-warning py-1 pl-4 text-sm text-warning">
                Nach der Freigabe geändert. Bitte wieder bearbeiten und erneut zum Review geben.
              </p>
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
            </div>
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
