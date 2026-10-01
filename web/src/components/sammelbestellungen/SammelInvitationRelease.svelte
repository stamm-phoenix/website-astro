<script lang="ts">
  import EditDialog from '../pflege/EditDialog.svelte';
  import { sendApi } from '../../lib/api';
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
  let busy = $state(false);
  let confirm = $state(false);
  let error = $state<string | null>(null);
  const endpoint = $derived('/intern/pflege/sammelbestellungen/' + campaignId + '/invite');
  async function preview(): Promise<void> {
    busy = true;
    error = null;
    try {
      audience = await sendApi<Audience>('POST', endpoint, { action: 'preview' });
      confirm = audience.pending > 0;
    } catch (caught) {
      error =
        caught instanceof Error ? caught.message : 'Der Verteiler konnte nicht geladen werden.';
    } finally {
      busy = false;
    }
  }
  async function release(): Promise<void> {
    if (!audience || busy) return;
    confirm = false;
    busy = true;
    error = null;
    try {
      while (audience.pending > 0)
        audience = await sendApi<Audience>('POST', endpoint, {
          action: 'send',
          version: audience.version,
        });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Der Versand wurde unterbrochen.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="mt-4">
  <button class="btn-primary" disabled={disabled || busy} onclick={() => void preview()}
    >{busy
      ? 'Versand läuft …'
      : audience?.started
        ? 'Versandstand laden / fortsetzen'
        : 'Sammelbestellung freigeben'}</button
  >
  <p class="mt-2 text-sm text-neutral-700">
    Sendet die Einladung an Haupt- und CC-Adressen aktueller CampFlow-Mitglieder. Jede
    E-Mail-Adresse erhält sie einmal, auch bei Geschwistern.
  </p>
  {#if audience?.started}<p class="mt-2 text-sm text-brand-900" role="status" aria-live="polite">
      {audience.sent} von {audience.total} Einladungen an den Maildienst übergeben. {audience.pending}
      noch offen.
    </p>{/if}
  {#if audience?.uncertain}<p class="mt-2 text-sm text-[var(--color-dpsg-red)]">
      Bei {audience.uncertain} Adresse(n) ist der Versand noch nicht bestätigt oder der Ausgang unklar.
      Sie werden nicht automatisch erneut angeschrieben. Bitte die gesendeten Mails im Postfach prüfen.
    </p>{/if}
  {#if error}<p class="mt-2 text-sm text-[var(--color-dpsg-red)]" role="alert">{error}</p>{/if}
</div>
<EditDialog
  open={confirm}
  {busy}
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
