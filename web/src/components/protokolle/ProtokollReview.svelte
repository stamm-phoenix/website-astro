<script lang="ts">
  import EditDialog from '../pflege/EditDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import { ApiError, errorMessage, fetchFile, saveFile, sendApi } from '../../lib/api';
  import { PROTOKOLL_STATUS, formatDateTime } from '../../lib/protokollEditor';
  import type { ProtokollEditorDetail } from '../../lib/types';

  /**
   * Review, approval and mailing of minutes from the editor (#277, step 2): who gave them to
   * the review, the note of a reviewer, the filed PDF and the buttons of the reviewers.
   */
  interface Props {
    detail: ProtokollEditorDetail;
    login: string;
    /** Reloads the minutes after a step. */
    onchanged: () => Promise<unknown>;
    notify: (text: string, kind?: 'success' | 'warning' | 'error') => void;
  }
  let { detail, login, onchanged, notify }: Props = $props();

  let busy = $state(false);
  let approving = $state(false);
  let approveError = $state<string | null>(null);
  let rejecting = $state<{ note: string } | null>(null);
  let rejectError = $state<string | null>(null);
  let rejectFieldError = $state<string | null>(null);
  let sending = $state<{ recipients: number; version: string; retry: boolean } | null>(null);
  let sendError = $state<string | null>(null);

  const status = $derived(PROTOKOLL_STATUS[detail.status]);
  const own = $derived(login !== '' && detail.createdBy.toLowerCase() === login.toLowerCase());
  const draftPdf = $derived(detail.status === 'entwurf' || detail.status === 'review');

  /** Who gave the minutes to the review, approved and sent them, one line each. */
  const lines = $derived.by(() => {
    const result: string[] = [];
    if (detail.submittedBy && detail.status !== 'entwurf') {
      result.push(
        `Zum Review gegeben von ${detail.submittedBy} am ${formatDateTime(detail.submittedAt)}`
      );
    }
    if (detail.approvedBy) {
      result.push(`Freigegeben von ${detail.approvedBy} am ${formatDateTime(detail.approvedAt)}`);
    }
    if (detail.versand?.state === 'sent') {
      result.push(
        `An ${detail.versand.recipients} Leitende verschickt am ${formatDateTime(detail.versand.at)}`
      );
    }
    return result;
  });

  function url(suffix = ''): string {
    return `/intern/pflege/protokoll-editor/${detail.id}${suffix}`;
  }

  async function downloadPdf(): Promise<void> {
    busy = true;
    try {
      const { blob, fileName } = await fetchFile(`/intern/protokoll-editor/${detail.id}/pdf`);
      saveFile(blob, fileName ?? `${detail.date} ${detail.title}.pdf`);
    } catch (error: unknown) {
      notify(
        errorMessage(
          error,
          'Das PDF konnte nicht erstellt werden. Prüfe deine Internetverbindung und tippe noch einmal auf „PDF herunterladen“.'
        ),
        'error'
      );
    } finally {
      busy = false;
    }
  }

  async function approve(): Promise<void> {
    busy = true;
    approveError = null;
    try {
      const result = await sendApi<{ fileName: string }>('POST', url('/review'), {
        action: 'approve',
        etag: detail.etag,
      });
      approving = false;
      notify(`Freigegeben. „${result.fileName}“ liegt jetzt im Protokoll-Ordner.`);
      await onchanged();
    } catch (error: unknown) {
      approveError = errorMessage(
        error,
        'Das Protokoll wurde nicht freigegeben. Tippe noch einmal auf „Freigeben“.'
      );
      if (error instanceof ApiError && error.status === 409) await onchanged();
    } finally {
      busy = false;
    }
  }

  async function reject(): Promise<void> {
    if (!rejecting) return;
    busy = true;
    rejectError = null;
    rejectFieldError = null;
    try {
      const result = await sendApi<{ mailSent: boolean }>('POST', url('/review'), {
        action: 'reject',
        etag: detail.etag,
        note: rejecting.note,
      });
      rejecting = null;
      notify(
        result.mailSent
          ? `Zurückgegeben. ${detail.createdBy} bekommt den Hinweis per Mail.`
          : 'Zurückgegeben. Die Mail mit dem Hinweis ging nicht raus.',
        result.mailSent ? 'success' : 'warning'
      );
      await onchanged();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields?.note) rejectFieldError = error.fields.note;
      else
        rejectError = errorMessage(
          error,
          'Das Protokoll wurde nicht zurückgegeben. Dein Hinweis ist noch da. Tippe noch einmal auf „Zurückgeben“.'
        );
    } finally {
      busy = false;
    }
  }

  async function startSend(): Promise<void> {
    const retry = detail.versand?.state === 'attempted';
    busy = true;
    sendError = null;
    try {
      const preview = await sendApi<{ recipients: number; version: string }>(
        'POST',
        url('/versand'),
        { action: 'preview', retry }
      );
      sending = { ...preview, retry };
    } catch (error: unknown) {
      notify(
        errorMessage(
          error,
          'Die Leitenden konnten nicht geladen werden, es wurde nichts verschickt. Prüfe deine Internetverbindung und versuche es noch einmal.'
        ),
        'error'
      );
    } finally {
      busy = false;
    }
  }

  async function send(): Promise<void> {
    if (!sending) return;
    busy = true;
    sendError = null;
    try {
      const result = await sendApi<{ recipients: number }>('POST', url('/versand'), {
        action: 'send',
        etag: detail.etag,
        version: sending.version,
        retry: sending.retry,
      });
      sending = null;
      notify(`An ${result.recipients} Leitende verschickt.`);
    } catch (error: unknown) {
      sendError = errorMessage(
        error,
        'Es ist unklar, ob das Protokoll verschickt wurde. Lies den Hinweis zum Versand auf dieser Seite, bevor du noch einmal schickst.'
      );
    } finally {
      busy = false;
      await onchanged();
    }
  }
</script>

<section class="space-y-3 border-b border-neutral-200 pb-4" aria-labelledby="review-titel">
  <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
    <h2 id="review-titel" class="font-serif text-xl text-brand-900">Review und Versand</h2>
    <StatusLabel label={status.label} tone={status.tone} />
  </div>

  {#if lines.length > 0}
    <p class="text-sm text-neutral-700">
      {#each lines as line, index (line)}
        {#if index > 0}<br />{/if}{line}
      {/each}
    </p>
  {/if}

  {#if detail.status === 'entwurf' && detail.reviewNote}
    <div class="border-l-2 border-warning py-1 pl-4 text-sm">
      <p class="font-semibold text-warning">Zurückgegeben mit dem Hinweis:</p>
      <p class="whitespace-pre-line text-neutral-800">{detail.reviewNote}</p>
    </div>
  {/if}

  {#if detail.status === 'entwurf'}
    <p class="text-sm text-neutral-700">
      Ist das Protokoll fertig, gibt es die schreibende Person zum Review. Nach der Freigabe liegt
      es als PDF im Protokoll-Ordner und lässt sich nicht mehr ändern.
    </p>
  {:else if detail.status === 'review' && !detail.reviewer}
    <p class="text-sm text-neutral-700">Wartet auf die Freigabe durch die Reviewer*innen.</p>
  {:else if detail.status === 'review' && own}
    <p class="text-sm text-neutral-700">Dein eigenes Protokoll gibt jemand anderes frei.</p>
  {/if}

  {#if detail.versand?.state === 'attempted'}
    <p class="border-l-2 border-danger py-1 pl-4 text-sm text-danger">
      Der Versand wurde gestartet, aber nicht bestätigt. Bitte im Postfach des Absenders unter
      „Gesendete Elemente“ nachsehen, bevor du erneut sendest.
    </p>
  {/if}
  {#if detail.status === 'freigegeben' && detail.reviewer && !detail.sendingConfigured}
    <p class="text-sm text-neutral-700">Für den Versand ist noch kein Absender eingerichtet.</p>
  {/if}

  <div class="flex flex-wrap gap-2">
    <ActionButton disabled={busy} onclick={downloadPdf}>
      {draftPdf ? 'PDF-Vorschau' : 'PDF herunterladen'}
    </ActionButton>
    {#if detail.ablage?.webUrl}
      <a
        class="btn-secondary"
        href={detail.ablage.webUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        Im Protokoll-Ordner öffnen<span class="sr-only"> (neues Fenster)</span>
      </a>
    {/if}
    {#if detail.status === 'review' && detail.reviewer}
      {#if !own}
        <ActionButton
          variant="primary"
          disabled={busy}
          onclick={() => {
            approving = true;
            approveError = null;
          }}
        >
          Freigeben
        </ActionButton>
      {/if}
      <ActionButton
        disabled={busy}
        onclick={() => {
          rejecting = { note: '' };
          rejectError = null;
          rejectFieldError = null;
        }}
      >
        Zurückgeben
      </ActionButton>
    {/if}
    {#if detail.status === 'freigegeben' && detail.reviewer && detail.sendingConfigured}
      <ActionButton
        variant={detail.versand ? 'danger' : 'primary'}
        disabled={busy}
        aria-busy={busy}
        onclick={startSend}
      >
        {detail.versand ? 'Erneut senden' : 'An alle Leitenden schicken'}
      </ActionButton>
    {/if}
  </div>
  {#if draftPdf}
    <p class="text-xs text-neutral-700">
      Die Vorschau zeigt den zuletzt gespeicherten Stand, als Entwurf gekennzeichnet.
    </p>
  {/if}
</section>

<ConfirmDialog
  open={approving}
  title="Protokoll freigeben?"
  tone="neutral"
  submitLabel="Freigeben"
  busyLabel="Wird freigegeben …"
  {busy}
  error={approveError}
  onclose={() => {
    if (!busy) approving = false;
  }}
  onconfirm={approve}
>
  <p>
    „{detail.title}“ wird als PDF im Protokoll-Ordner abgelegt. Danach lässt es sich nicht mehr
    ändern.
  </p>
  <p class="text-sm text-neutral-700">Verschickt wird es erst im nächsten Schritt.</p>
</ConfirmDialog>

<EditDialog
  open={rejecting !== null}
  title="Protokoll zurückgeben"
  {busy}
  error={rejectError}
  submitLabel="Zurückgeben"
  busyLabel="Wird zurückgegeben …"
  onsubmit={reject}
  onclose={() => {
    if (!busy) rejecting = null;
  }}
>
  {#if rejecting}
    <FormField
      id="protokoll-review-note"
      label="Was fehlt noch?"
      hint={detail.createdBy ? `Geht per Mail an ${detail.createdBy}.` : undefined}
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
  {busy}
  error={sendError}
  submitLabel={sending ? `An ${sending.recipients} Leitende schicken` : 'Schicken'}
  busyLabel="Wird verschickt …"
  submitDisabled={!sending || sending.recipients === 0}
  onsubmit={send}
  onclose={() => {
    if (!busy) sending = null;
  }}
>
  {#if sending}
    <p class="text-sm text-neutral-800">
      „{detail.title}“ geht als PDF mit Link an {sending.recipients} Leitende aus CampFlow, in Blindkopie.
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
