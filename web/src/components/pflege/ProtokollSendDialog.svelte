<script lang="ts">
  import EditDialog from './EditDialog.svelte';
  import { sendApi } from '../../lib/api';
  import { protokollePflege } from '../../lib/pflegeStore.svelte';
  import ProtokollEmpfaenger from '../protokolle/ProtokollEmpfaenger.svelte';
  import type { ProtokollSending, ProtokollVersandPreview } from '../../lib/protokolleView';
  import {
    LIST_RELOADED,
    auswahlBody,
    auswahlCount,
    auswahlDirty,
    pendingProblem,
    personen,
    refreshAuswahl,
    versandProblem,
  } from '../../lib/protokolleView';
  interface Props {
    sending: ProtokollSending | null;
    notify: (text: string) => void;
  }
  let { sending = $bindable(), notify }: Props = $props();
  let sendError = $state<string | null>(null);
  let sendBusy = $state(false);
  const sendCount = $derived(sending ? auswahlCount(sending) : 0);

  async function send(): Promise<void> {
    if (!sending) return;
    sendError = pendingProblem(sending);
    if (sendError) return;
    sendBusy = true;
    try {
      const { protokoll } = sending;
      const result = await sendApi<{ recipients: number }>(
        'POST',
        `/intern/pflege/protokolle/${encodeURIComponent(protokoll.id)}/versand`,
        { action: 'send', ...auswahlBody(sending), etag: protokoll.etag }
      );
      sending = null;
      notify(`„${protokoll.title}“ an ${personen(result.recipients)} verschickt.`);
      await protokollePflege.load({ force: true });
    } catch (error: unknown) {
      sendError = versandProblem(
        error,
        'Es ist unklar, ob das Protokoll verschickt wurde. Lies den Hinweis zum Versand bei diesem Protokoll, bevor du noch einmal schickst.'
      );
      await protokollePflege.load({ force: true });
      // Keep the selection, but continue with the current version; an unconfirmed attempt
      // turns the dialog into an explicit retry
      const current = protokollePflege.state.data?.items.find(
        (p) => p.id === sending?.protokoll.id
      );
      if (sending && current) {
        sending = {
          ...sending,
          protokoll: current,
          retry: current.delivery?.state === 'attempted',
        };
        // A changed list in CampFlow is taken over, so the selection can be checked and sent
        const retry = sending.retry;
        const preview = await sendApi<ProtokollVersandPreview>(
          'POST',
          `/intern/pflege/protokolle/${encodeURIComponent(current.id)}/versand`,
          { action: 'preview', retry }
        ).catch(() => null);
        if (sending && preview) {
          const refreshed = refreshAuswahl(sending, preview);
          sending = refreshed.auswahl;
          if (refreshed.changed) sendError = `${sendError ?? ''} ${LIST_RELOADED}`.trim();
        }
      }
    } finally {
      sendBusy = false;
    }
  }
</script>

<EditDialog
  open={sending !== null}
  title={sending?.retry ? 'Protokoll erneut verschicken?' : 'Protokoll verschicken?'}
  busy={sendBusy}
  error={sendError}
  submitLabel={`An ${personen(sendCount)} schicken`}
  busyLabel="Wird verschickt …"
  submitDisabled={!sending || sendCount === 0}
  dirty={auswahlDirty(sending)}
  onsubmit={send}
  onclose={() => {
    if (!sendBusy) sending = null;
  }}
>
  {#if sending}
    <p class="text-sm text-neutral-800">
      „{sending.protokoll.title}“ geht als Datei mit Link in Blindkopie an alle mit Häkchen. Dabei
      sind alle Leitenden und alle mit dem Label „Protokollempfang“ aus CampFlow.
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
      disabled={sendBusy}
    />
  {/if}
</EditDialog>
