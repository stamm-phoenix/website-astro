<script lang="ts">
  import { ApiError, sendApi } from '../lib/api';
  import { STATUS_LABEL, formatSlotKey } from '../lib/nikolausAdmin';
  import type { StaffNikolausBooking } from '../lib/types';
  import EditDialog from './pflege/EditDialog.svelte';
  import FormField from './pflege/FormField.svelte';
  import RichTextEditor from './pflege/RichTextEditor.svelte';

  interface Props {
    /** Booking whose family receives the message; the dialog is open while set. */
    booking: StaffNikolausBooking | null;
    onclose: () => void;
    onsent: (booking: StaffNikolausBooking) => void;
  }

  let { booking, onclose, onsent }: Props = $props();

  let subject = $state('');
  let message = $state('');
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  let error = $state<string | null>(null);
  /** Id of the booking the form was prepared for, to reset it for another booking. */
  let preparedFor = $state<string | null>(null);

  const inactive = $derived(booking?.status === 'cancelled' || booking?.status === 'expired');

  $effect(() => {
    if (booking && booking.id !== preparedFor) {
      preparedFor = booking.id;
      subject = '';
      message = '';
      errors = {};
      error = null;
    }
  });

  function close(): void {
    if (busy) return;
    preparedFor = null;
    onclose();
  }

  async function send(): Promise<void> {
    if (!booking) return;
    const next: Record<string, string> = {};
    if (!subject.trim()) next.subject = 'Bitte einen Betreff angeben.';
    if (!message.replace(/<[^>]*>/g, '').trim()) next.message = 'Bitte eine Nachricht schreiben.';
    errors = next;
    if (Object.keys(next).length > 0) return;

    busy = true;
    error = null;
    try {
      await sendApi('POST', `/intern/nikolaus/bookings/${booking.id}/message`, {
        subject,
        message,
      });
      const sentTo = booking;
      preparedFor = null;
      onsent(sentTo);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.fields) errors = { ...errors, ...err.fields };
        error = err.message;
      } else {
        error = 'Die Nachricht konnte nicht gesendet werden. Bitte prüfe deine Verbindung.';
      }
    } finally {
      busy = false;
    }
  }
</script>

<EditDialog
  open={booking !== null}
  title="Nachricht an Familie {booking?.familyName ?? ''}"
  {busy}
  {error}
  submitLabel={busy ? 'Wird gesendet …' : 'Senden'}
  onsubmit={send}
  onclose={close}
>
  {#if booking}
    <p class="text-sm text-neutral-700">
      An: <span class="font-semibold text-brand-900">Familie {booking.familyName}</span>
      &lt;{booking.email}&gt; · {formatSlotKey(booking.slotKey)}
    </p>

    {#if inactive}
      <p role="note" class="rounded-md bg-[#fff1e0] p-3 text-sm text-[#8a4a00]">
        Diese Buchung ist „{STATUS_LABEL[booking.status]}“. Die Nachricht wird trotzdem verschickt.
      </p>
    {/if}

    <FormField id="msg-subject" label="Betreff" error={errors.subject}>
      {#snippet children(attrs)}
        <input
          {...attrs}
          class="form-input"
          maxlength="150"
          placeholder="z. B. Kleine Verspätung am Nikolausabend"
          bind:value={subject}
        />
      {/snippet}
    </FormField>

    <div>
      <span id="msg-body-label" class="form-label">Nachricht</span>
      <RichTextEditor
        id="msg-body"
        labelledBy="msg-body-label"
        describedBy={errors.message ? 'msg-body-error' : 'msg-body-hint'}
        invalid={!!errors.message}
        bind:value={message}
      />
      {#if errors.message}
        <p id="msg-body-error" class="mt-1 text-sm text-[var(--color-dpsg-red)]">
          {errors.message}
        </p>
      {:else}
        <p id="msg-body-hint" class="mt-1 text-xs text-neutral-700">
          Die Familie bekommt die Nachricht im Design der Nikolaus-Mails, unterschrieben mit deinem
          Vornamen. Antworten landen im Nikolaus-Postfach.
        </p>
      {/if}
    </div>
  {/if}
</EditDialog>
