<script lang="ts">
  import MessageText from '../ui/MessageText.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import EditDialog from '../pflege/EditDialog.svelte';
  import { errorMessage, sendApi } from '../../lib/api';
  interface Props {
    campaignId: string;
    disabled: boolean;
  }
  interface Audience {
    total: number;
    pending: number;
    sent: number;
    uncertain: number;
    started: boolean;
    version?: string;
  }
  let { campaignId, disabled }: Props = $props();
  let audience = $state<Audience | null>(null);
  let busy = $state<'preview' | 'send' | null>(null);
  let confirm = $state(false);
  let error = $state<string | null>(null);
  const endpoint = $derived('/intern/pflege/sammelbestellungen/' + campaignId + '/invite');
  async function preview(): Promise<void> {
    busy = 'preview';
    error = null;
    try {
      audience = await sendApi<Audience>('POST', endpoint, { action: 'preview' });
      confirm = audience.pending > 0;
    } catch (caught) {
      error = errorMessage(
        caught,
        'Der Verteiler konnte nicht geladen werden. Prüfe deine Internetverbindung und versuche es noch einmal.'
      );
    } finally {
      busy = null;
    }
  }
  async function release(): Promise<void> {
    if (!audience || busy) return;
    confirm = false;
    busy = 'send';
    error = null;
    try {
      while (audience.pending > 0)
        audience = await sendApi<Audience>('POST', endpoint, {
          action: 'send',
          version: audience.version,
        });
    } catch (caught) {
      error = errorMessage(
        caught,
        'Der Versand wurde unterbrochen. Prüfe deine Internetverbindung und tippe noch einmal auf „Sammelbestellung freigeben“.'
      );
    } finally {
      busy = null;
    }
  }
</script>

<div class="mt-4">
  <ActionButton
    variant="primary"
    type="button"
    disabled={disabled || busy !== null}
    onclick={() => void preview()}
    >{busy === 'send'
      ? 'Versand läuft …'
      : busy === 'preview'
        ? 'Verteiler wird geladen …'
        : audience?.started
          ? 'Versandstand laden / fortsetzen'
          : 'Sammelbestellung freigeben'}</ActionButton
  >
  <p class="mt-2 text-sm text-neutral-700">
    Sendet die Einladung an Haupt- und CC-Adressen aktueller CampFlow-Mitglieder. Jede
    E-Mail-Adresse erhält sie einmal, auch bei Geschwistern.
  </p>
  <div role="status" aria-live="polite">
    {#if audience?.started}<p class="mt-2 text-sm text-brand-900">
        {audience.sent} von {audience.total} Einladungen an den Maildienst übergeben. {audience.pending}
        noch offen.
      </p>{:else if audience && audience.pending === 0}<p
        class="mt-2 text-sm font-semibold text-warning"
      >
        Es wurde keine E-Mail versendet: Im CampFlow-Verteiler gibt es keine E-Mail-Adressen für
        diese Einladung.
      </p>{/if}
  </div>
  {#if audience?.uncertain}<p class="mt-2 text-sm text-danger">
      Bei {audience.uncertain} Adresse(n) ist der Versand noch nicht bestätigt oder der Ausgang unklar.
      Sie werden nicht automatisch erneut angeschrieben. Bitte die gesendeten Mails im Postfach prüfen.
    </p>{/if}
  {#if error}<p class="mt-2 text-sm text-danger" role="alert"><MessageText text={error} /></p>{/if}
</div>
<EditDialog
  open={confirm}
  busy={busy !== null}
  title="Sammelbestellung freigeben?"
  submitLabel="Ja, E-Mails senden"
  cancelLabel="Nein"
  onsubmit={() => void release()}
  onclose={() => (confirm = false)}
>
  <p>
    Sicher, dass du die Sammelbestellung freigeben willst? Es wird eine E-Mail an {audience?.pending ??
      0} eindeutige E-Mail-Adresse(n) geschickt.
  </p>
  {#if audience?.started}<p class="mt-2 text-sm text-neutral-700">
      Bereits versuchte Adressen werden ausgelassen. Der Versand wird fortgesetzt.
    </p>{/if}
</EditDialog>
