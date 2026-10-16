<script lang="ts">
  import type { ProtokollSending, ProtokollVersandPreview } from '../../lib/protokolleView';
  import { startAuswahl, versandProblem } from '../../lib/protokolleView';
  import ProtokollCreateDialog from './ProtokollCreateDialog.svelte';
  import ProtokollRejectDialog from './ProtokollRejectDialog.svelte';
  import ProtokollSendDialog from './ProtokollSendDialog.svelte';
  import ProtokollDeleteDialog from './ProtokollDeleteDialog.svelte';
  import ProtokollFreigabeDialog from '../protokolle/ProtokollFreigabeDialog.svelte';
  import MessageText from '../ui/MessageText.svelte';
  import { tick, untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';

  import ProtokollTerminBlock from './ProtokollTerminBlock.svelte';
  import ReloadButton from './ReloadButton.svelte';
  import StatusNotice from './StatusNotice.svelte';
  import { ApiError, errorMessage, fetchApi, fetchFile, saveFile, sendApi } from '../../lib/api';
  import { todayIso } from '../../lib/format';
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
  /** Read-only preview shown below one of the minutes. */
  let preview = $state<{
    id: string;
    url: string | null;
    text: string | null;
    error: string | null;
  } | null>(null);

  let creating = $state<{ title: string; date: string } | null>(null);

  let rejecting = $state<{ protokoll: StaffProtokoll; note: string } | null>(null);
  /** Minutes whose approval is being confirmed. */
  let approving = $state<StaffProtokoll | null>(null);
  let approveError = $state<string | null>(null);
  /** The file changed since the list was loaded, so the approval needs the current version. */
  let approveConflict = $state(false);
  let approveReloading = $state(false);

  let sending = $state<ProtokollSending | null>(null);

  let deleting = $state<StaffProtokoll | null>(null);

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
      lines.push(`An ${protokoll.delivery.recipients} Personen verschickt${at}`);
    }
    return lines;
  }

  function notify(text: string, kind: 'success' | 'warning' | 'error' = 'success'): void {
    message = text;
    messageKind = kind;
  }

  function startCreate(): void {
    creating = { title: data?.defaultTitle ?? '', date: todayIso() };
  }

  const ACTION_DONE: Record<Action, string> = {
    review: 'zum Review gegeben',
    approve: 'freigegeben',
    reject: 'zurückgegeben',
    reopen: 'wieder zur Bearbeitung geöffnet',
  };

  const ACTION_BUTTON: Record<Action, string> = {
    review: 'Zum Review geben',
    approve: 'Freigeben',
    reject: 'Zurückgeben',
    reopen: 'Wieder bearbeiten',
  };

  async function changeState(
    protokoll: StaffProtokoll,
    action: Action,
    note = '',
    ownConfirmed = false
  ): Promise<void> {
    busyId = protokoll.id;
    try {
      const result = await sendApi<{ mailSent: boolean }>(
        'POST',
        `/intern/pflege/protokolle/${encodeURIComponent(protokoll.id)}`,
        { action, etag: protokoll.etag, note, ownConfirmed }
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
      // The dialogs show their errors themselves
      if (action === 'reject' || action === 'approve') throw error;
      notify(
        errorMessage(
          error,
          `„${protokoll.title}“ wurde nicht ${ACTION_DONE[action]}. Tippe noch einmal auf „${ACTION_BUTTON[action]}“.`
        ),
        'error'
      );
    } finally {
      busyId = null;
    }
  }

  async function approve(ownConfirmed: boolean): Promise<void> {
    if (!approving) return;
    const protokoll = approving;
    approveError = null;
    approveConflict = false;
    try {
      await changeState(protokoll, 'approve', '', ownConfirmed);
      approving = null;
    } catch (error: unknown) {
      approveConflict =
        error instanceof ApiError && error.status === 409 && error.code === 'CONFLICT';
      approveError = errorMessage(
        error,
        `„${protokoll.title}“ wurde nicht freigegeben. Tippe noch einmal auf „Freigeben“.`
      );
    }
  }

  /** Loads the current version of the minutes after a conflict; the dialog asks again. */
  async function reloadApproving(): Promise<void> {
    if (!approving || approveReloading) return;
    const id = approving.id;
    approveReloading = true;
    try {
      await protokollePflege.load({ force: true });
      if (store.error) {
        approveError =
          'Die aktuelle Fassung konnte nicht geladen werden. Prüfe deine Internetverbindung und tippe noch einmal auf „Aktuelle Fassung laden“.';
        return;
      }
      const fresh = store.data?.items.find((item) => item.id === id);
      approveError = null;
      approveConflict = false;
      if (fresh && (fresh.status === 'Entwurf' || fresh.status === 'Review')) {
        approving = fresh;
      } else {
        approving = null;
        notify(
          fresh
            ? `„${fresh.title}“ hat inzwischen den Stand „${STATUS_LABEL[fresh.status]}“ und muss nicht mehr freigegeben werden.`
            : 'Das Protokoll gibt es nicht mehr.',
          'warning'
        );
      }
    } finally {
      approveReloading = false;
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
    preview = { id: protokoll.id, url: null, text: null, error: null };
    try {
      const { url, text } = await fetchApi<{ url?: string; text?: string }>(
        `/intern/pflege/protokolle/${encodeURIComponent(protokoll.id)}/vorschau`
      );
      if (preview?.id === protokoll.id) {
        preview.url = url ?? null;
        preview.text = text ?? null;
      }
    } catch (error: unknown) {
      if (preview?.id === protokoll.id) {
        preview.error = errorMessage(
          error,
          'Die Vorschau konnte nicht geladen werden. Prüfe deine Internetverbindung und tippe noch einmal auf „Vorschau“.'
        );
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
      notify(
        errorMessage(
          error,
          'Die Datei konnte nicht heruntergeladen werden. Prüfe deine Internetverbindung und tippe noch einmal auf „PDF herunterladen“.'
        ),
        'error'
      );
    } finally {
      busyId = null;
    }
  }

  /** Minutes that were not sent yet may be deleted. */
  function mayDelete(protokoll: StaffProtokoll): boolean {
    return (
      protokoll.status !== 'Verschickt' && protokoll.status !== 'Archiv' && !protokoll.delivery
    );
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

  async function startSend(protokoll: StaffProtokoll, retry = false): Promise<void> {
    busyId = protokoll.id;
    try {
      const preview = await sendApi<ProtokollVersandPreview>(
        'POST',
        `/intern/pflege/protokolle/${encodeURIComponent(protokoll.id)}/versand`,
        { action: 'preview', retry }
      );
      sending = { protokoll, ...startAuswahl(preview, retry) };
    } catch (error: unknown) {
      notify(
        versandProblem(
          error,
          'Die Empfänger*innen konnten nicht aus CampFlow geladen werden, es wurde nichts verschickt. Prüfe deine Internetverbindung und versuche es noch einmal.'
        ),
        'error'
      );
    } finally {
      busyId = null;
    }
  }
</script>

<div class="space-y-6">
  <LoadState
    {data}
    loading={store.loading}
    error={store.error}
    loadingText="Protokolle werden geladen …"
    onretry={() => void protokollePflege.load({ force: true })}
  >
    {#snippet skeleton()}
      <div class="space-y-2">
        {#each [1, 2, 3] as n (n)}
          <div class="skeleton-element h-20 rounded-[var(--radius-lg)]"></div>
        {/each}
      </div>
    {/snippet}
    {#snippet children(data)}
      {#if !data.configured}
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
          Neue Protokolle entstehen aus der Word-Vorlage. Vorhandene PDF- und TXT-Dateien erscheinen
          ebenfalls hier. Word-Dateien können im Browser geschrieben werden, auch gemeinsam während
          der Sitzung. Danach gibst du es zum Review, wenn noch jemand drüberschauen soll, oder
          direkt frei. Nach der Freigabe schickst du es an die Leitenden und alle mit dem Label
          „Protokollempfang“ aus CampFlow. Vor dem Versand siehst du die Liste und kannst sie
          anpassen.
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
              <li
                id="protokoll-{protokoll.id}"
                class="scroll-mt-24 space-y-3 py-4"
                aria-labelledby="protokoll-title-{protokoll.id}"
              >
                <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2
                    id="protokoll-title-{protokoll.id}"
                    class="text-lg font-semibold text-brand-900"
                  >
                    {protokoll.title}
                    {#if protokoll.date}
                      <span class="font-normal text-neutral-700"
                        >· {formatMeetingDate(protokoll)}</span
                      >
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
                    recognitionConfigured={data.terminConfigured}
                    {notify}
                  />
                {/if}
                {#if showsTermin(protokoll)}
                  <a
                    class="text-link text-sm"
                    href="/leitendenbereich/aufgaben/vorschlaege?protokoll={encodeURIComponent(
                      protokoll.id
                    )}">Aufgaben aus diesem Protokoll prüfen</a
                  >
                {/if}
                {#if protokoll.delivery?.state === 'attempted'}
                  <p class="border-l-2 border-danger py-1 pl-4 text-sm text-danger">
                    Der Versand wurde gestartet, aber nicht bestätigt. Bitte im Postfach des
                    Absenders unter „Gesendete Elemente“ nachsehen, bevor du erneut sendest.
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
                      {protokoll.fileName.toLowerCase().endsWith('.docx')
                        ? `In Word ${isDone(protokoll) ? 'öffnen' : 'bearbeiten'}`
                        : 'Datei öffnen'}<span class="sr-only">
                        ({protokoll.title}, neues Fenster)</span
                      >
                    </a>
                    <ActionButton
                      variant="secondary"
                      type="button"
                      onclick={() => copyLink(protokoll)}
                    >
                      Link kopieren<span class="sr-only"> ({protokoll.title})</span>
                    </ActionButton>
                  {/if}
                  <ActionButton
                    variant="secondary"
                    type="button"
                    disabled={busy}
                    onclick={() => downloadPdf(protokoll)}
                  >
                    {protokoll.fileName.toLowerCase().endsWith('.txt') ? 'TXT' : 'PDF'}<span
                      class="sr-only"
                    >
                      von {protokoll.title} herunterladen</span
                    >
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
                    <ActionButton
                      variant="secondary"
                      type="button"
                      disabled={busy}
                      onclick={() => {
                        approving = protokoll;
                        approveError = null;
                      }}
                    >
                      Freigeben
                    </ActionButton>
                  {:else if protokoll.status === 'Review'}
                    <ActionButton
                      variant="primary"
                      type="button"
                      disabled={busy}
                      onclick={() => {
                        approving = protokoll;
                        approveError = null;
                      }}
                    >
                      Freigeben
                    </ActionButton>
                    <ActionButton
                      variant="secondary"
                      type="button"
                      disabled={busy}
                      onclick={() => {
                        rejecting = { protokoll, note: '' };
                      }}
                    >
                      Zurückgeben
                    </ActionButton>
                  {:else if protokoll.status === 'Freigegeben'}
                    {#if data.sendingConfigured && !protokoll.changedSinceApproval}
                      <ActionButton
                        variant={protokoll.delivery ? 'danger' : 'primary'}
                        type="button"
                        disabled={busy}
                        aria-busy={busy}
                        onclick={() => startSend(protokoll, protokoll.delivery !== null)}
                      >
                        {protokoll.delivery ? 'Erneut senden' : 'Protokoll verschicken'}
                      </ActionButton>
                    {/if}
                    {#if !protokoll.delivery}
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
                      }}
                    >
                      Löschen<span class="sr-only"> ({protokoll.title})</span>
                    </ActionButton>
                  {/if}
                </div>
                {#if preview?.id === protokoll.id}
                  <div id="protokoll-preview-{protokoll.id}">
                    {#if preview.error}
                      <p
                        role="alert"
                        class="border-l-2 border-danger py-1 pl-4 text-sm text-danger"
                      >
                        <MessageText text={preview.error} />
                      </p>
                    {:else if preview.text !== null}
                      <pre
                        class="surface max-h-[75vh] overflow-auto whitespace-pre-wrap break-words p-4 font-sans">{preview.text}</pre>
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
                {#if protokoll.status === 'Freigegeben' && !data.sendingConfigured}
                  <p class="text-sm text-neutral-700">
                    Für den Versand ist noch kein Absender eingerichtet.
                  </p>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    {/snippet}
  </LoadState>
</div>

{#if creating}
  <ProtokollCreateDialog bind:creating oncreated={() => (filter = 'offen')} {notify} />
{/if}

<ProtokollFreigabeDialog
  open={approving !== null}
  title={approving?.title ?? ''}
  own={approving !== null && isOwn(approving)}
  draft={approving?.status === 'Entwurf'}
  version={approving?.etag ?? ''}
  consequence="Die jetzige Fassung der Datei gilt dann als freigegeben. Wird sie danach noch geändert, muss sie erneut freigegeben werden."
  busy={approveReloading || (approving !== null && busyId === approving.id)}
  error={approveError}
  onclose={() => {
    if (busyId === null && !approveReloading) {
      approving = null;
      approveConflict = false;
    }
  }}
  onreload={approveConflict ? reloadApproving : undefined}
  onconfirm={(ownConfirmed) => void approve(ownConfirmed)}
/>

{#if rejecting}
  <ProtokollRejectDialog bind:rejecting {busyId} {changeState} />
{/if}

{#if sending}
  <ProtokollSendDialog bind:sending {notify} />
{/if}

{#if deleting}
  <ProtokollDeleteDialog
    bind:deleting
    {notify}
    ondeleted={(id) => {
      if (preview?.id === id) preview = null;
    }}
  />
{/if}
