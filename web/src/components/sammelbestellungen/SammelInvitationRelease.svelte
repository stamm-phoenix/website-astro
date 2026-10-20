<script lang="ts">
  import MessageText from '../ui/MessageText.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
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
        `Der Versand wurde unterbrochen. Prüfe deine Internetverbindung und tippe dann auf „${audience?.started ? 'Versand fortsetzen' : 'Sammelbestellung freigeben'}“.`
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
          ? 'Versand fortsetzen'
          : 'Sammelbestellung freigeben'}</ActionButton
  >
  <p class="mt-2 flex flex-wrap items-center gap-1 text-sm text-neutral-700">
    <span>Schickt die Einladung per E-Mail an alle Mitglieder.</span>
    <InfoHint
      label="Einladung"
      text="Die Einladung geht an die Haupt- und CC-Adressen aller aktuellen CampFlow-Mitglieder. Jede E-Mail-Adresse erhält sie einmal, auch bei Geschwistern."
    />
  </p>
  <div role="status" aria-live="polite">
    {#if audience?.started}<p class="mt-2 text-sm text-brand-900">
        {audience.sent} von {audience.total} Einladungen verschickt, {audience.pending} offen.
      </p>{:else if audience && audience.pending === 0}<p
        class="mt-2 text-sm font-semibold text-warning"
      >
        Keine E-Mail-Adressen im Verteiler. Nichts verschickt.
      </p>{/if}
  </div>
  {#if audience?.uncertain}<p class="mt-2 text-sm text-danger">
      {audience.uncertain} Adresse(n) mit unklarem Versand. Sie werden nicht erneut angeschrieben – bitte
      im Postfach prüfen.
    </p>{/if}
  {#if error}<p class="mt-2 text-sm text-danger" role="alert"><MessageText text={error} /></p>{/if}
</div>
<EditDialog
  open={confirm}
  busy={busy !== null}
  title={audience?.started ? 'Versand fortsetzen?' : 'Sammelbestellung freigeben?'}
  submitLabel="Ja, E-Mails senden"
  cancelLabel="Nein"
  onsubmit={() => void release()}
  onclose={() => (confirm = false)}
>
  <p>Die Einladung geht an {audience?.pending ?? 0} E-Mail-Adresse(n).</p>
</EditDialog>
