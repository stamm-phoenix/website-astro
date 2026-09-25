<script lang="ts">
  import { ApiError, sendApi } from '../lib/api';
  import { formatSlotKey } from '../lib/nikolausAdmin';
  import type { StaffNikolausBooking } from '../lib/types';
  import EditDialog from './pflege/EditDialog.svelte';
  import RichTextEditor from './pflege/RichTextEditor.svelte';

  interface Props {
    /** Booking to cancel; the dialog is open while set. */
    booking: StaffNikolausBooking | null;
    onclose: () => void;
    ondone: (booking: StaffNikolausBooking, mailSent: boolean) => void;
    /** Called when the server rejected the cancellation because the data was outdated. */
    onstale: () => void;
  }

  let { booking, onclose, ondone, onstale }: Props = $props();

  let message = $state('');
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  let error = $state<string | null>(null);
  /** Booking the form was prepared for, to reset it for another one. */
  let preparedFor = $state<StaffNikolausBooking | null>(null);

  $effect(() => {
    if (booking && booking !== preparedFor) {
      preparedFor = booking;
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

  async function submit(): Promise<void> {
    if (!booking) return;
    busy = true;
    error = null;
    try {
      const result = await sendApi<{ mailSent: boolean }>(
        'POST',
        `/intern/nikolaus/bookings/${booking.id}/cancel`,
        { fromSlot: booking.slotKey, message }
      );
      const cancelled = booking;
      preparedFor = null;
      ondone(cancelled, result.mailSent);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.fields) errors = { ...errors, ...err.fields };
        error = err.message;
        if (err.status === 409) onstale();
      } else {
        error = 'Das Absagen hat nicht geklappt. Bitte prüfe deine Verbindung.';
      }
    } finally {
      busy = false;
    }
  }
</script>

<EditDialog
  open={booking !== null}
  title="Termin absagen – Familie {booking?.familyName ?? ''}"
  {busy}
  {error}
  submitLabel={busy ? 'Wird abgesagt …' : 'Absagen und benachrichtigen'}
  onsubmit={submit}
  onclose={close}
>
  {#if booking}
    <p role="note" class="rounded-md bg-[#f7e3e5] p-3 text-sm text-[var(--color-dpsg-red)]">
      Der Termin <strong>{formatSlotKey(booking.slotKey)}</strong> wird abgesagt und der Platz wieder
      frei. Das lässt sich nicht rückgängig machen – die Familie müsste sich neu anmelden.
    </p>

    <div>
      <span id="cancel-message-label" class="form-label">
        Erklärung für die Familie <span class="font-normal text-neutral-700">(optional)</span>
      </span>
      <RichTextEditor
        id="cancel-message"
        labelledBy="cancel-message-label"
        describedBy={errors.message ? 'cancel-message-error' : 'cancel-message-hint'}
        invalid={!!errors.message}
        bind:value={message}
      />
      {#if errors.message}
        <p id="cancel-message-error" class="mt-1 text-sm text-[var(--color-dpsg-red)]">
          {errors.message}
        </p>
      {:else}
        <p id="cancel-message-hint" class="mt-1 text-xs text-neutral-700">
          Die Familie wird in jedem Fall per E-Mail über die Absage informiert – mit dieser
          Erklärung, falls du eine schreibst.
        </p>
      {/if}
    </div>
  {/if}
</EditDialog>
