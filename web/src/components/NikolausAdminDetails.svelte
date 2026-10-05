<script lang="ts">
  import ActionButton from './ui/ActionButton.svelte';
  import { untrack } from 'svelte';
  import {
    STATUS_LABEL,
    formatSlotKey,
    formatTimestamp,
    isActiveBooking,
  } from '../lib/nikolausAdmin';
  import type { BookingProblem } from '../lib/nikolausAdmin';
  import type { NikolausBookingStatus, StaffNikolausBooking } from '../lib/types';

  /** Small status dot colours (status shown as text, no pill). */
  const STATUS_DOT: Record<NikolausBookingStatus, string> = {
    confirmed: 'bg-[var(--color-dpsg-pfadfinder)]',
    pending: 'bg-[var(--color-dpsg-woelflinge)]',
    expired: 'bg-neutral-400',
    cancelled: 'bg-[var(--color-dpsg-red)]',
  };
  import { ApiError, sendApi } from '../lib/api';
  import TagInput from './pflege/TagInput.svelte';

  interface Props {
    booking: StaffNikolausBooking | null;
    /** Why this booking needs attention, if it does. */
    problem?: BookingProblem;
    onclose: () => void;
    /** Opens the message dialog for this booking. */
    onmessage?: (booking: StaffNikolausBooking) => void;
    /** Opens the reschedule dialog for this booking. */
    onmove?: (booking: StaffNikolausBooking) => void;
    /** Opens the cancel dialog for this booking. */
    oncancel?: (booking: StaffNikolausBooking) => void;
    /** Tags in use, offered while typing. */
    tagSuggestions?: string[];
    /** Called after the internal tags were saved. */
    ontagssaved?: (booking: StaffNikolausBooking) => void;
  }

  let {
    booking,
    problem,
    onclose,
    onmessage,
    onmove,
    oncancel,
    tagSuggestions = [],
    ontagssaved,
  }: Props = $props();

  let tags = $state<string[]>([]);
  let tagsSaving = $state(false);
  let tagsMessage = $state<{ text: string; error: boolean } | null>(null);
  const tagsChanged = $derived(
    booking !== null && tags.join('\u0000') !== booking.internalTags.join('\u0000')
  );

  // Start from the booking's tags whenever another booking is opened
  const bookingId = $derived(booking?.id ?? null);
  $effect(() => {
    void bookingId;
    untrack(() => {
      tags = booking ? [...booking.internalTags] : [];
      tagsMessage = null;
    });
  });

  async function saveTags(): Promise<void> {
    if (!booking) return;
    const current = booking;
    tagsSaving = true;
    tagsMessage = null;
    try {
      const saved = await sendApi<{ booking: StaffNikolausBooking }>(
        'PUT',
        `/intern/pflege/nikolaus-bookings/${current.id}/tags`,
        { tags, etag: current.etag }
      );
      ontagssaved?.(saved.booking);
      if (booking?.id === current.id) tags = [...saved.booking.internalTags];
      tagsMessage = { text: 'Tags gespeichert.', error: false };
    } catch (error: unknown) {
      tagsMessage = {
        text:
          error instanceof ApiError && error.fields?.tags
            ? error.fields.tags
            : error instanceof ApiError
              ? error.message
              : 'Die Tags konnten nicht gespeichert werden.',
        error: true,
      };
    } finally {
      tagsSaving = false;
    }
  }

  let dialog = $state<HTMLDialogElement | null>(null);

  $effect(() => {
    if (!dialog) return;
    if (booking && !dialog.open) dialog.showModal();
    if (!booking && dialog.open) dialog.close();
  });

  const mapUrl = $derived(
    booking?.location
      ? `https://www.openstreetmap.org/?mlat=${booking.location.lat}&mlon=${booking.location.lon}#map=17/${booking.location.lat}/${booking.location.lon}`
      : null
  );
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="booking-details-heading"
  class="details-dialog m-auto w-[min(40rem,calc(100%-2rem))] rounded-[var(--radius-lg)] border border-neutral-200 bg-surface p-0 shadow-lift"
  {onclose}
  onclick={(event) => {
    if (event.target === dialog) dialog?.close();
  }}
>
  {#if booking}
    <div class="p-5 md:p-6">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 id="booking-details-heading" class="font-serif text-2xl font-semibold text-brand-900">
            Familie {booking.familyName}
          </h2>
          <p class="mt-1 font-semibold text-brand-800">{formatSlotKey(booking.slotKey)}</p>
        </div>
        <button
          type="button"
          class="-m-1 flex size-11 items-center justify-center rounded-sm text-neutral-700 hover:bg-[var(--color-brand-50)] active:bg-[var(--color-brand-100)]"
          aria-label="Details schließen"
          onclick={() => dialog?.close()}
        >
          <svg
            aria-hidden="true"
            class="size-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {#if problem}
        <p
          role="note"
          class="mt-3 border-l-4 border-[var(--color-dpsg-red)] py-1 pl-3 text-sm text-[var(--color-dpsg-red)]"
        >
          <span class="font-semibold">
            {problem === 'overbooked'
              ? 'Dieser Termin ist überbucht.'
              : 'Dieser Termin wird nicht mehr angeboten.'}
          </span>
          {problem === 'overbooked' ? 'Es gibt mehr Buchungen als Teams.' : ''} Bitte mit der Familie
          Kontakt aufnehmen und die Buchung auf einen freien Termin verlegen.
        </p>
      {/if}

      <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span class="inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
          <span class="size-2 shrink-0 rounded-full {STATUS_DOT[booking.status]}" aria-hidden="true"
          ></span>
          {STATUS_LABEL[booking.status]}
        </span>
        <span class="flex flex-wrap gap-2">
          {#if onmove && isActiveBooking(booking)}
            <ActionButton
              variant="secondary"
              type="button"
              onclick={() => booking && onmove(booking)}
            >
              <svg
                aria-hidden="true"
                class="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M8 3v4M16 3v4M4 9h16M5 5h14v15H5zM10 15h6M13 12l3 3-3 3" />
              </svg>
              Termin verlegen
            </ActionButton>
          {/if}
          {#if onmessage}
            <ActionButton
              variant="secondary"
              type="button"
              onclick={() => booking && onmessage(booking)}
            >
              <svg
                aria-hidden="true"
                class="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M4 6h16v12H4zM4 7l8 6 8-6" />
              </svg>
              Nachricht schreiben
            </ActionButton>
          {/if}
          {#if oncancel && isActiveBooking(booking)}
            <ActionButton
              variant="danger"
              type="button"
              onclick={() => booking && oncancel(booking)}
            >
              Termin absagen
            </ActionButton>
          {/if}
        </span>
      </div>

      <section
        aria-labelledby="booking-tags-heading"
        class="mt-5 border-t border-neutral-200 pt-4 text-sm"
      >
        <h3 id="booking-tags-heading" class="font-semibold text-brand-900">
          <label for="booking-tags-input">Interne Tags</label>
        </h3>
        <p id="booking-tags-hint" class="text-xs text-neutral-700">
          Nur für unsere Planung, z. B. „Wölflinge“. Die Familie sieht die Tags nie. Helfende mit
          passendem negativem Tag kommen nicht in das Team dieser Familie.
        </p>
        <TagInput
          id="booking-tags-input"
          {tags}
          suggestions={tagSuggestions}
          describedBy="booking-tags-hint"
          onchange={(next) => {
            tags = next;
            tagsMessage = null;
          }}
        />
        <div class="mt-2 flex flex-wrap items-center gap-3">
          <ActionButton
            variant="secondary"
            type="button"
            class="px-3! py-1! text-xs!"
            disabled={!tagsChanged || tagsSaving}
            onclick={saveTags}
          >
            {tagsSaving ? 'Speichert …' : 'Tags speichern'}
          </ActionButton>
          <span
            role="status"
            aria-live="polite"
            class="text-xs {tagsMessage?.error
              ? 'text-[var(--color-dpsg-red)]'
              : 'text-[var(--color-dpsg-pfadfinder)]'}">{tagsMessage?.text ?? ''}</span
          >
        </div>
      </section>

      <dl class="mt-5 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
        <dt class="font-semibold text-neutral-700">Adresse</dt>
        <dd>
          {booking.street}, {booking.postalCode}
          {booking.city}
          {#if mapUrl}
            <a
              class="ml-1 text-link underline"
              href={mapUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Karte{booking.location?.approximate ? ' (ungefähr)' : ''}
            </a>
          {/if}
        </dd>

        {#if booking.addressNotes}
          <dt class="font-semibold text-neutral-700">Hinweise zur Adresse</dt>
          <dd class="whitespace-pre-line">{booking.addressNotes}</dd>
        {/if}

        <dt class="font-semibold text-neutral-700">Kinder</dt>
        <dd>{booking.childrenCount}</dd>

        <dt class="font-semibold text-neutral-700">Krampus</dt>
        <dd>{booking.withKrampus ? 'Ja' : 'Nein'}</dd>

        {#if booking.hidingPlace}
          <dt class="font-semibold text-neutral-700">Ablageort Geschenke/Zettel/Spende</dt>
          <dd class="whitespace-pre-line">{booking.hidingPlace}</dd>
        {/if}

        {#if booking.notes}
          <dt class="font-semibold text-neutral-700">Bemerkungen</dt>
          <dd class="whitespace-pre-line">{booking.notes}</dd>
        {/if}

        <dt class="font-semibold text-neutral-700">E-Mail</dt>
        <dd>
          <a class="text-link underline" href="mailto:{booking.email}">{booking.email}</a>
        </dd>

        <dt class="font-semibold text-neutral-700">Telefon</dt>
        <dd>
          {#if booking.phone}
            <a class="text-link underline" href="tel:{booking.phone.replace(/\s+/g, '')}"
              >{booking.phone}</a
            >
          {:else}
            –
          {/if}
        </dd>

        {#if booking.status === 'pending'}
          <dt class="font-semibold text-neutral-700">Reserviert bis</dt>
          <dd>{formatTimestamp(booking.reservedUntil)}</dd>
        {/if}

        <dt class="font-semibold text-neutral-700">Bestätigt am</dt>
        <dd>{formatTimestamp(booking.confirmedAt)}</dd>

        <dt class="font-semibold text-neutral-700">Zuletzt geändert</dt>
        <dd>{formatTimestamp(booking.changedAt)}</dd>
      </dl>
    </div>
  {/if}
</dialog>

<style>
  .details-dialog::backdrop {
    background: var(--dialog-backdrop, rgb(0 48 86 / 0.35));
  }
</style>
