<script lang="ts">
  import StatusLabel from './ui/StatusLabel.svelte';
  import MessageText from './ui/MessageText.svelte';
  import ActionButton from './ui/ActionButton.svelte';
  import ModalDialog from './ui/ModalDialog.svelte';
  import InfoHint from './ui/InfoHint.svelte';
  import { untrack } from 'svelte';
  import {
    STATUS_LABEL,
    STATUS_TONE,
    PROBLEM_LABEL,
    formatSlotKey,
    formatTimestamp,
    isActiveBooking,
  } from '../lib/nikolausAdmin';
  import type { BookingProblem } from '../lib/nikolausAdmin';
  import type { StaffNikolausBooking } from '../lib/types';

  import { ApiError, errorMessage, sendApi } from '../lib/api';
  import TagInput from './pflege/TagInput.svelte';
  import { confirmAction } from '../lib/confirm';
  import { guardUnsavedChanges } from '../lib/unsavedChanges';
  import { fetchNikolausOverview, nikolausAdminStore } from '../lib/nikolausAdminStore.svelte';

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
  let tagsConflict = $state(false);
  let tagsRevision = $state(0);
  let tagDraft = $state('');
  let askingToDiscard = $state(false);
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
      tagsConflict = false;
      tagDraft = '';
    });
  });

  $effect(() => {
    if (booking && (tagsChanged || tagDraft.trim() !== '')) {
      return guardUnsavedChanges(() => true);
    }
  });

  async function mayLeave(): Promise<boolean> {
    if (tagsSaving || askingToDiscard) return false;
    if (!booking || (!tagsChanged && !tagDraft.trim())) return true;
    askingToDiscard = true;
    try {
      return await confirmAction({
        title: `Merkmale von Familie ${booking.familyName} verwerfen?`,
        message:
          'Die Merkmale sind noch nicht gespeichert. Wenn du weitergehst, gehen deine Änderungen verloren.',
        confirmLabel: 'Änderungen verwerfen',
        cancelLabel: 'Weiter bearbeiten',
      });
    } finally {
      askingToDiscard = false;
    }
  }

  async function leave(action: () => void): Promise<void> {
    if (await mayLeave()) action();
  }

  async function saveTags(): Promise<void> {
    if (!booking || tagsSaving || tagsConflict) return;
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
      tagsMessage = { text: 'Merkmale gespeichert.', error: false };
    } catch (error: unknown) {
      tagsConflict = error instanceof ApiError && error.status === 409;
      tagsMessage = {
        text:
          (tagsConflict &&
            'Die Merkmale wurden inzwischen geändert. Deine Eingaben sind noch da. Lade die aktuelle Fassung, bevor du weiterarbeitest.') ||
          (error instanceof ApiError && error.fields?.tags) ||
          errorMessage(
            error,
            'Die Merkmale wurden nicht gespeichert. Deine Änderungen sind noch da. Tippe noch einmal auf „Merkmale speichern“.'
          ),
        error: true,
      };
    } finally {
      tagsSaving = false;
    }
  }

  async function reloadTags(): Promise<void> {
    if (!booking || tagsSaving || askingToDiscard) return;
    const current = booking;
    askingToDiscard = true;
    try {
      if (
        !(await confirmAction({
          title: `Aktuelle Merkmale von Familie ${current.familyName} laden?`,
          message: 'Die aktuelle Fassung ersetzt deine ungespeicherten Merkmale.',
          confirmLabel: 'Aktuelle Fassung laden',
          cancelLabel: 'Weiter bearbeiten',
        }))
      )
        return;
      tagsSaving = true;
      await fetchNikolausOverview({ force: true });
      if (nikolausAdminStore.error) {
        tagsMessage = {
          text: `${nikolausAdminStore.error} Deine Eingaben sind noch da.`,
          error: true,
        };
        return;
      }
      const fresh = nikolausAdminStore.data?.bookings.find((b) => b.id === current.id);
      if (!fresh) {
        tagsMessage = {
          text: 'Die Anmeldung wurde inzwischen gelöscht. Deine Eingaben sind noch da; schließe die Details, wenn du sie nicht mehr brauchst.',
          error: true,
        };
        return;
      }
      ontagssaved?.(fresh);
      tags = [...fresh.internalTags];
      tagsRevision++;
      tagDraft = '';
      tagsConflict = false;
      tagsMessage = { text: 'Aktuelle Merkmale geladen.', error: false };
    } finally {
      askingToDiscard = false;
      tagsSaving = false;
    }
  }

  const mapUrl = $derived(
    booking?.location
      ? `https://www.openstreetmap.org/?mlat=${booking.location.lat}&mlon=${booking.location.lon}#map=17/${booking.location.lat}/${booking.location.lon}`
      : null
  );
</script>

<ModalDialog
  open={booking !== null}
  title={booking ? `Familie ${booking.familyName}` : ''}
  closeLabel="Details schließen"
  size="medium"
  dismissOnBackdrop
  closeDisabled={tagsSaving || askingToDiscard}
  onclose={() => leave(onclose)}
>
  {#if booking}
    <div class="overflow-y-auto px-5 py-4 md:px-6">
      <p class="font-semibold text-brand-800">{formatSlotKey(booking.slotKey)}</p>
      {#if problem}
        <p
          role="note"
          class="mt-3 border-l-4 border-danger py-1 pl-3 text-sm font-semibold text-danger"
        >
          {PROBLEM_LABEL[problem]}{problem === 'overbooked' ? ' – mehr Buchungen als Teams' : ''}.
        </p>
      {/if}

      <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
        <StatusLabel label={STATUS_LABEL[booking.status]} tone={STATUS_TONE[booking.status]} dot />
        <span class="flex flex-wrap gap-2">
          {#if onmove && isActiveBooking(booking)}
            <ActionButton
              variant="secondary"
              type="button"
              disabled={tagsSaving || askingToDiscard}
              onclick={() => leave(() => booking && onmove(booking))}
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
              disabled={tagsSaving || askingToDiscard}
              onclick={() => leave(() => booking && onmessage(booking))}
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
              disabled={tagsSaving || askingToDiscard}
              onclick={() => leave(() => booking && oncancel(booking))}
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
        <div class="flex items-center gap-1">
          <h3 id="booking-tags-heading" class="font-semibold text-brand-900">
            <label for="booking-tags-input">Merkmale für die Einteilung</label>
          </h3>
          <InfoHint
            label="Merkmale für die Einteilung"
            text="Steht hier z. B. „Wölflinge“ und bei einer helfenden Person unter „Nicht zu Familien mit“ ebenfalls „Wölflinge“, wird diese Person nicht zu dieser Familie eingeteilt."
          />
        </div>
        <p id="booking-tags-hint" class="text-xs text-neutral-700">Die Familie sieht das nicht.</p>
        {#key `${booking.id}:${tagsRevision}`}<TagInput
            id="booking-tags-input"
            {tags}
            disabled={tagsSaving}
            ondraftchange={(value) => (tagDraft = value)}
            suggestions={tagSuggestions}
            describedBy="booking-tags-hint"
            onchange={(next) => {
              tags = next;
              tagsMessage = null;
            }}
          />{/key}
        <div class="mt-2 flex flex-wrap items-center gap-3">
          <ActionButton
            variant="secondary"
            type="button"
            class="px-3! py-1! text-xs!"
            disabled={!tagsChanged || tagsSaving || tagsConflict}
            onclick={saveTags}
          >
            {tagsSaving ? 'Speichert …' : 'Merkmale speichern'}
          </ActionButton>
          {#if tagsConflict}<ActionButton
              type="button"
              variant="secondary"
              disabled={tagsSaving || askingToDiscard}
              onclick={reloadTags}>Aktuelle Fassung laden</ActionButton
            >{/if}
          <span
            role="status"
            aria-live="polite"
            class="text-xs {tagsMessage?.error ? 'text-danger' : 'text-success'}"
            >{#if tagsMessage}<MessageText text={tagsMessage.text} />{/if}</span
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
</ModalDialog>
