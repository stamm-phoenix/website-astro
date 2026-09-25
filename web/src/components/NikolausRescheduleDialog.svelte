<script lang="ts">
  import { ApiError, sendApi } from '../lib/api';
  import { formatShortDate, formatSlotKey, getFreeSlots } from '../lib/nikolausAdmin';
  import type {
    NikolausMoveRequest,
    NikolausMoveResult,
    StaffNikolausBooking,
    StaffNikolausSlot,
  } from '../lib/types';
  import EditDialog from './pflege/EditDialog.svelte';
  import FormField from './pflege/FormField.svelte';
  import RichTextEditor from './pflege/RichTextEditor.svelte';

  interface Props {
    request: NikolausMoveRequest | null;
    slots: StaffNikolausSlot[];
    bookings: StaffNikolausBooking[];
    onclose: () => void;
    ondone: (result: NikolausMoveResult) => void;
    /** Called when the server rejected the move because the data was outdated. */
    onstale: () => void;
  }

  let { request, slots, bookings, onclose, ondone, onstale }: Props = $props();

  let target = $state('');
  let message = $state('');
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  let error = $state<string | null>(null);
  /** Request the form was prepared for, to reset it for a new one. */
  let preparedFor = $state<NikolausMoveRequest | null>(null);

  const booking = $derived(request?.booking ?? null);
  const options = $derived(
    booking ? getFreeSlots(slots, bookings).filter((f) => f.slot.key !== booking.slotKey) : []
  );
  const optionsByDate = $derived(
    Object.entries(
      options.reduce<Record<string, typeof options>>((groups, option) => {
        (groups[option.slot.date] ??= []).push(option);
        return groups;
      }, {})
    )
  );

  $effect(() => {
    if (request && request !== preparedFor) {
      preparedFor = request;
      target =
        request.target && options.some((o) => o.slot.key === request.target) ? request.target : '';
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
    if (!target) {
      errors = { target: 'Bitte einen neuen Termin auswählen.' };
      return;
    }
    errors = {};
    busy = true;
    error = null;
    try {
      const result = await sendApi<{ id: string; mailSent: boolean }>(
        'POST',
        `/intern/nikolaus/bookings/${booking.id}/reschedule`,
        { fromSlot: booking.slotKey, toSlot: target, message }
      );
      preparedFor = null;
      ondone({ booking, target, mailSent: result.mailSent });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.fields) errors = { ...errors, ...err.fields };
        error = err.message;
        if (err.status === 409) onstale();
      } else {
        error = 'Das Verlegen hat nicht geklappt. Bitte prüfe deine Verbindung.';
      }
    } finally {
      busy = false;
    }
  }
</script>

<EditDialog
  open={request !== null}
  title="Termin verlegen – Familie {booking?.familyName ?? ''}"
  {busy}
  {error}
  submitLabel={busy ? 'Wird verlegt …' : 'Verlegen und benachrichtigen'}
  onsubmit={submit}
  onclose={close}
>
  {#if booking}
    <p class="text-sm">
      Bisher: <span class="font-semibold text-brand-900">{formatSlotKey(booking.slotKey)}</span>
    </p>

    {#if booking.status === 'pending'}
      <p role="note" class="rounded-md bg-[#fff1e0] p-3 text-sm text-[#8a4a00]">
        Diese Buchung ist noch nicht bestätigt. Die Reservierung läuft nach dem Verlegen unverändert
        weiter.
      </p>
    {/if}

    <FormField id="move-target" label="Neuer Termin" error={errors.target}>
      {#snippet children(attrs)}
        {#if options.length === 0}
          <p id={attrs.id} class="mt-1 text-sm text-neutral-700">
            Es gibt derzeit keinen freien Termin in der Zukunft.
          </p>
        {:else}
          <select {...attrs} class="form-input" bind:value={target}>
            <option value="" disabled>Bitte wählen</option>
            {#each optionsByDate as [date, group] (date)}
              <optgroup label={formatShortDate(date)}>
                {#each group as option (option.slot.key)}
                  <option value={option.slot.key}>
                    {formatShortDate(option.slot.date)} · {option.slot.time}–{option.slot.endTime} Uhr
                    ({option.free}
                    frei)
                  </option>
                {/each}
              </optgroup>
            {/each}
          </select>
        {/if}
      {/snippet}
    </FormField>

    <div>
      <span id="move-message-label" class="form-label">
        Erklärung für die Familie <span class="font-normal text-neutral-700">(optional)</span>
      </span>
      <RichTextEditor
        id="move-message"
        labelledBy="move-message-label"
        describedBy={errors.message ? 'move-message-error' : 'move-message-hint'}
        invalid={!!errors.message}
        bind:value={message}
      />
      {#if errors.message}
        <p id="move-message-error" class="mt-1 text-sm text-[var(--color-dpsg-red)]">
          {errors.message}
        </p>
      {:else}
        <p id="move-message-hint" class="mt-1 text-xs text-neutral-700">
          Die Familie wird in jedem Fall per E-Mail über den neuen Termin informiert – mit dieser
          Erklärung, falls du eine schreibst.
        </p>
      {/if}
    </div>
  {/if}
</EditDialog>
