<script lang="ts">
  import EditDialog from '../pflege/EditDialog.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import ProtokollEmpfaenger from './ProtokollEmpfaenger.svelte';
  import { sendApi } from '../../lib/api';
  import type { ProtokollEditorDetail } from '../../lib/types';
  import type { ProtokollVersandAuswahl, ProtokollVersandPreview } from '../../lib/protokolleView';
  import {
    LIST_RELOADED,
    auswahlBody,
    auswahlCount,
    auswahlDirty,
    pendingProblem,
    personen,
    refreshAuswahl,
    startAuswahl,
    versandProblem,
  } from '../../lib/protokolleView';

  /**
   * Mailing approved minutes (#277): the button and the dialog with the recipients from
   * CampFlow. A second mailing is a retry the dialog warns about.
   */
  interface Props {
    detail: ProtokollEditorDetail;
    class?: string;
    /** Reloads the minutes after a mailing. */
    onchanged: () => Promise<unknown>;
    notify: (text: string, kind?: 'success' | 'warning' | 'error') => void;
  }
  let { detail, class: className = '', onchanged, notify }: Props = $props();

  let busy = $state(false);
  let sending = $state<ProtokollVersandAuswahl | null>(null);
  const sendCount = $derived(sending ? auswahlCount(sending) : 0);
  let sendError = $state<string | null>(null);

  const url = $derived(`/intern/pflege/protokoll-editor/${detail.id}/versand`);

  async function startSend(): Promise<void> {
    const retry = detail.versand?.state === 'attempted';
    busy = true;
    sendError = null;
    try {
      const preview = await sendApi<ProtokollVersandPreview>('POST', url, {
        action: 'preview',
        retry,
      });
      sending = startAuswahl(preview, retry);
    } catch (error: unknown) {
      notify(
        versandProblem(
          error,
          'Die Empfänger*innen konnten nicht aus CampFlow geladen werden, es wurde nichts verschickt. Prüfe deine Internetverbindung und versuche es noch einmal.'
        ),
        'error'
      );
    } finally {
      busy = false;
    }
  }

  async function send(): Promise<void> {
    if (!sending) return;
    sendError = pendingProblem(sending);
    if (sendError) return;
    busy = true;
    try {
      const result = await sendApi<{ recipients: number }>('POST', url, {
        action: 'send',
        etag: detail.etag,
        ...auswahlBody(sending),
      });
      sending = null;
      notify(`Protokoll an ${personen(result.recipients)} verschickt.`);
    } catch (error: unknown) {
      sendError = versandProblem(
        error,
        'Es ist unklar, ob das Protokoll verschickt wurde. Lies den Hinweis zum Versand auf dieser Seite, bevor du noch einmal schickst.'
      );
    } finally {
      busy = false;
      await onchanged();
      // An unconfirmed attempt turns the open dialog into an explicit retry
      if (sending) {
        sending.retry = detail.versand?.state === 'attempted';
        // A changed list in CampFlow is taken over, so the selection can be checked and sent
        const preview = await sendApi<ProtokollVersandPreview>('POST', url, {
          action: 'preview',
          retry: sending.retry,
        }).catch(() => null);
        if (sending && preview) {
          const refreshed = refreshAuswahl(sending, preview);
          sending = refreshed.auswahl;
          if (refreshed.changed) sendError = `${sendError ?? ''} ${LIST_RELOADED}`.trim();
        }
      }
    }
  }
</script>

<ActionButton
  class={className}
  variant={detail.versand ? 'danger' : 'primary'}
  disabled={busy}
  aria-busy={busy}
  onclick={startSend}
>
  {detail.versand ? 'Erneut senden' : 'Protokoll verschicken'}
</ActionButton>

<EditDialog
  open={sending !== null}
  title={sending?.retry ? 'Protokoll erneut verschicken?' : 'Protokoll verschicken?'}
  {busy}
  error={sendError}
  submitLabel={`An ${personen(sendCount)} schicken`}
  busyLabel="Wird verschickt …"
  submitDisabled={!sending || sendCount === 0}
  dirty={auswahlDirty(sending)}
  onsubmit={send}
  onclose={() => {
    if (!busy) sending = null;
  }}
>
  {#if sending}
    <p class="text-sm text-neutral-800">
      „{detail.title}“ geht als PDF mit Link an alle mit Häkchen.
    </p>
    {#if sending.retry}
      <p class="text-sm text-danger">
        Ein früherer Versand wurde nicht bestätigt. Schick es nur erneut, wenn die Mail nicht in den
        „Gesendeten Elementen“ des Absenders liegt.
      </p>
    {/if}
    <ProtokollEmpfaenger
      list={sending.list}
      bind:excluded={sending.excluded}
      bind:extra={sending.extra}
      bind:pending={sending.pending}
      disabled={busy}
    />
  {/if}
</EditDialog>
