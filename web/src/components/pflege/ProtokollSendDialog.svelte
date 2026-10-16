<script lang="ts">
  import EditDialog from './EditDialog.svelte';
  import { errorMessage, sendApi } from '../../lib/api';
  import { protokollePflege } from '../../lib/pflegeStore.svelte';
  import type { ProtokollSending } from '../../lib/protokolleView';
  interface Props {
    sending: ProtokollSending | null;
    notify: (text: string) => void;
  }
  let { sending = $bindable(), notify }: Props = $props();
  let sendError = $state<string | null>(null);
  let sendBusy = $state(false);

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
      sendError = errorMessage(
        error,
        'Es ist unklar, ob das Protokoll verschickt wurde. Lies den Hinweis zum Versand bei diesem Protokoll, bevor du noch einmal schickst.'
      );
      await protokollePflege.load({ force: true });
    } finally {
      sendBusy = false;
    }
  }
</script>

<EditDialog
  open={sending !== null}
  title={sending?.retry ? 'Erneut an alle Leitenden schicken?' : 'An alle Leitenden schicken?'}
  busy={sendBusy}
  error={sendError}
  submitLabel={sending ? `An ${sending.recipients} Personen schicken` : 'Schicken'}
  busyLabel="Wird verschickt …"
  submitDisabled={!sending || sending.recipients === 0}
  onsubmit={send}
  onclose={() => {
    if (!sendBusy) sending = null;
  }}
>
  {#if sending}
    <p class="text-sm text-neutral-800">
      „{sending.protokoll.title}“ geht als Datei mit Link an {sending.recipients} Personen aus CampFlow
      (alle Leitenden und alle mit dem Label „Protokollempfang“), in Blindkopie.
    </p>
    {#if sending.retry}
      <p class="text-sm text-danger">
        Ein früherer Versand wurde nicht bestätigt. Schick es nur erneut, wenn die Mail nicht in den
        „Gesendeten Elementen“ des Absenders liegt.
      </p>
    {/if}
    {#if sending.recipients === 0}
      <p class="text-sm text-danger">
        In CampFlow wurden keine Leitenden und niemand mit dem Label „Protokollempfang“ mit E-Mail
        gefunden.
      </p>
    {/if}
  {/if}
</EditDialog>
