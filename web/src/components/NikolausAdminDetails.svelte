<script lang="ts">
  import {
    STATUS_CLASS,
    STATUS_LABEL,
    formatSlotKey,
    formatTimestamp,
    isActiveBooking,
  } from '../lib/nikolausAdmin';
  import type { StaffNikolausBooking } from '../lib/types';

  interface Props {
    booking: StaffNikolausBooking | null;
    onclose: () => void;
    /** Opens the message dialog for this booking. */
    onmessage?: (booking: StaffNikolausBooking) => void;
    /** Opens the reschedule dialog for this booking. */
    onmove?: (booking: StaffNikolausBooking) => void;
    /** Opens the cancel dialog for this booking. */
    oncancel?: (booking: StaffNikolausBooking) => void;
  }

  let { booking, onclose, onmessage, onmove, oncancel }: Props = $props();

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
  class="details-dialog m-auto w-[min(40rem,calc(100%-2rem))] rounded-[var(--radius-lg)] border border-neutral-200 bg-white p-0 shadow-lift"
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
          class="rounded-full p-2 text-neutral-700 hover:bg-[var(--color-brand-50)]"
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

      <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span class="pill border text-xs {STATUS_CLASS[booking.status]}">
          {STATUS_LABEL[booking.status]}
        </span>
        <span class="flex flex-wrap gap-2">
          {#if onmove && isActiveBooking(booking)}
            <button type="button" class="btn-secondary" onclick={() => booking && onmove(booking)}>
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
            </button>
          {/if}
          {#if onmessage}
            <button
              type="button"
              class="btn-secondary"
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
            </button>
          {/if}
          {#if oncancel && isActiveBooking(booking)}
            <button type="button" class="btn-danger" onclick={() => booking && oncancel(booking)}>
              Termin absagen
            </button>
          {/if}
        </span>
      </div>

      <dl class="mt-5 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
        <dt class="font-semibold text-neutral-700">Adresse</dt>
        <dd>
          {booking.street}, {booking.postalCode}
          {booking.city}
          {#if mapUrl}
            <a
              class="ml-1 text-brand-800 underline"
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
          <a class="text-brand-800 underline" href="mailto:{booking.email}">{booking.email}</a>
        </dd>

        <dt class="font-semibold text-neutral-700">Telefon</dt>
        <dd>
          {#if booking.phone}
            <a class="text-brand-800 underline" href="tel:{booking.phone.replace(/\s+/g, '')}"
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
    background: rgb(0 48 86 / 0.35);
    backdrop-filter: blur(2px);
  }
</style>
