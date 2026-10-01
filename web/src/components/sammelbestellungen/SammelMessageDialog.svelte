<script lang="ts">
  import { ApiError, sendApi } from '../../lib/api';
  import type { SammelBestellung } from '../../lib/types';
  import EditDialog from '../pflege/EditDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import RichTextEditor from '../pflege/RichTextEditor.svelte';

  interface Props {
    order: SammelBestellung | null;
    campaignTitle: string;
    onclose: () => void;
    onsent: (order: SammelBestellung) => void;
  }
  let { order, campaignTitle, onclose, onsent }: Props = $props();
  let subject = $state('');
  let message = $state('');
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  let error = $state<string | null>(null);
  let preparedFor = $state<string | null>(null);

  $effect(() => {
    if (order && order.id !== preparedFor) {
      preparedFor = order.id;
      subject = '';
      message = '';
      errors = {};
      error = null;
    }
  });
  /** Closes the message dialog only while no send request is active. */
  function close(): void {
    if (busy) return;
    preparedFor = null;
    onclose();
  }
  /** Sends the staff draft with the order version and retains it when delivery fails. */
  async function send(): Promise<void> {
    if (!order || busy) return;
    const recipient = order;
    const next: Record<string, string> = {};
    if (!subject.trim()) next.subject = 'Bitte einen Betreff angeben.';
    if (!message.replace(/<[^>]*>/g, '').trim()) next.message = 'Bitte eine Nachricht schreiben.';
    errors = next;
    if (Object.keys(next).length) return;
    busy = true;
    error = null;
    try {
      await sendApi('POST', `/intern/pflege/sammelbestellungen/orders/${recipient.id}/message`, {
        etag: recipient.etag,
        subject,
        message,
      });
      preparedFor = null;
      onsent(recipient);
    } catch (caught: unknown) {
      if (caught instanceof ApiError) {
        if (caught.fields) errors = { ...errors, ...caught.fields };
        error = caught.message;
      } else error = 'Die Nachricht konnte nicht gesendet werden. Bitte prüfe deine Verbindung.';
    } finally {
      busy = false;
    }
  }
</script>

<EditDialog
  open={order !== null}
  title="Nachricht an {order?.name ?? ''}"
  {busy}
  {error}
  submitLabel="Senden"
  busyLabel="Wird gesendet …"
  onsubmit={() => void send()}
  onclose={close}
>
  {#if order}
    <p class="break-words text-sm text-neutral-700">
      An: <span class="font-semibold text-brand-900">{order.name}</span> &lt;{order.email}&gt;
      <span class="mt-1 block">Sammelbestellung: {campaignTitle}</span>
    </p>
    {#if order.status === 'Storniert'}
      <p role="note" class="rounded-md bg-[#fff1e0] p-3 text-sm text-[#8a4a00]">
        Diese Bestellung ist storniert. Die Nachricht wird trotzdem verschickt.
      </p>
    {/if}
    <FormField id="sammel-msg-subject" label="Betreff" error={errors.subject}>
      {#snippet children(attrs)}
        <input
          {...attrs}
          class="form-input"
          maxlength="150"
          placeholder="z. B. Deine Bestellung ist abholbereit"
          bind:value={subject}
          disabled={busy}
        />
      {/snippet}
    </FormField>
    <div>
      <span id="sammel-msg-body-label" class="form-label">Nachricht</span>
      <RichTextEditor
        id="sammel-msg-body"
        labelledBy="sammel-msg-body-label"
        describedBy={errors.message ? 'sammel-msg-body-error' : 'sammel-msg-body-hint'}
        invalid={!!errors.message}
        bind:value={message}
      />
      {#if errors.message}
        <p id="sammel-msg-body-error" class="mt-1 text-sm text-[var(--color-dpsg-red)]">
          {errors.message}
        </p>
      {:else}
        <p id="sammel-msg-body-hint" class="mt-1 text-xs text-neutral-700">
          Die Familie erhält die Nachricht im Phoenix-Maildesign mit ihrem Bestelllink und deinem
          Vornamen. Antworten landen im Sammelbestellpostfach. Höchstens 5000 Zeichen.
        </p>
      {/if}
    </div>
  {/if}
</EditDialog>
