<script lang="ts">
  import { untrack } from 'svelte';
  import { ApiError, fetchApi, postApi } from '../lib/api';
  import { formatNikolausDate } from '../lib/nikolausConfig';
  import type { NikolausBookingInfo } from '../lib/types';

  let id = $state('');
  let token = $state('');
  let booking = $state<NikolausBookingInfo | null>(null);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let busy = $state<'confirm' | 'cancel' | null>(null);
  let confirmCancel = $state(false);
  let justConfirmed = $state(false);

  $effect(() => {
    untrack(() => load());
  });

  async function load(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    id = params.get('id') ?? '';
    token = params.get('token') ?? '';

    if (!id || !token) {
      loadError =
        'Dieser Link ist unvollständig. Bitte verwenden Sie die vollständige Adresse aus der E-Mail.';
      loading = false;
      return;
    }

    try {
      booking = await fetchApi<NikolausBookingInfo>(
        `/nikolaus/bookings/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`
      );
    } catch (error: unknown) {
      loadError =
        error instanceof ApiError && error.code
          ? error.message
          : 'Die Buchung konnte nicht geladen werden. Bitte versuchen Sie es später erneut.';
    } finally {
      loading = false;
    }
  }

  async function runAction(action: 'confirm' | 'cancel'): Promise<void> {
    if (busy) return;
    busy = action;
    actionError = null;
    try {
      booking = await postApi<NikolausBookingInfo>(
        `/nikolaus/bookings/${encodeURIComponent(id)}/${action}`,
        { token }
      );
      justConfirmed = action === 'confirm';
      confirmCancel = false;
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === 'EXPIRED' && booking) {
        booking = { ...booking, status: 'expired' };
      } else if (error instanceof ApiError && error.code === 'CANCELLED' && booking) {
        booking = { ...booking, status: 'cancelled' };
      } else {
        actionError =
          error instanceof ApiError && error.code
            ? error.message
            : 'Das hat leider nicht geklappt. Bitte versuchen Sie es später erneut.';
      }
    } finally {
      busy = null;
    }
  }

  function slotText(info: NikolausBookingInfo): string {
    return info.slot
      ? `${formatNikolausDate(info.slot.date)}, ${info.slot.time}–${info.slot.endTime} Uhr`
      : 'Termin nicht mehr verfügbar';
  }

  function formatTime(iso: string): string {
    return new Intl.DateTimeFormat('de-DE', {
      day: 'numeric',
      month: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Berlin',
    }).format(new Date(iso));
  }
</script>

{#if loading}
  <div role="status" aria-live="polite" class="surface p-6">
    <span class="sr-only">Buchung wird geladen …</span>
    <div class="skeleton-element h-6 w-56 rounded"></div>
    <div class="skeleton-element mt-4 h-4 w-72 rounded"></div>
    <div class="skeleton-element mt-2 h-4 w-64 rounded"></div>
  </div>
{:else if loadError || !booking}
  <article role="alert" class="surface p-6 border-l-4! border-l-[var(--color-dpsg-red)]!">
    <h2 class="text-lg font-semibold text-brand-900">Buchung nicht gefunden</h2>
    <p class="mt-1 text-sm text-neutral-700">{loadError}</p>
    <p class="mt-3 text-sm">
      <a class="font-semibold text-brand-800 underline" href="/nikolaus">Zur Nikolaus-Anmeldung</a>
    </p>
  </article>
{:else}
  <article
    class={[
      'surface p-6 md:p-8 border-l-4!',
      booking.status === 'confirmed'
        ? 'border-l-[var(--color-dpsg-pfadfinder)]!'
        : 'border-l-[var(--color-dpsg-red)]!',
    ].join(' ')}
    aria-labelledby="booking-status-heading"
  >
    <div role="status" aria-live="polite">
      {#if booking.status === 'pending'}
        <h2 id="booking-status-heading" class="font-serif text-2xl font-semibold text-brand-900">
          Bitte bestätigen Sie Ihren Termin
        </h2>
        <p class="mt-2 text-neutral-800">
          Ihr Termin ist reserviert{booking.reservedUntil
            ? ` bis ${formatTime(booking.reservedUntil)} Uhr`
            : ''}. Erst mit Ihrer Bestätigung ist er verbindlich gebucht.
        </p>
      {:else if booking.status === 'confirmed'}
        <h2 id="booking-status-heading" class="font-serif text-2xl font-semibold text-brand-900">
          {justConfirmed
            ? '🎉 Vielen Dank – Ihr Termin ist bestätigt!'
            : 'Ihr Termin ist bestätigt'}
        </h2>
        <p class="mt-2 text-neutral-800">
          Der Nikolaus freut sich auf Ihren Besuch. Eine Bestätigung haben wir Ihnen auch per E-Mail
          geschickt.
        </p>
      {:else if booking.status === 'cancelled'}
        <h2 id="booking-status-heading" class="font-serif text-2xl font-semibold text-brand-900">
          Der Termin wurde abgesagt
        </h2>
        <p class="mt-2 text-neutral-800">
          Schade! Der Termin ist wieder freigegeben. Sie können jederzeit einen neuen Termin buchen.
        </p>
      {:else}
        <h2 id="booking-status-heading" class="font-serif text-2xl font-semibold text-brand-900">
          Die Reservierung ist abgelaufen
        </h2>
        <p class="mt-2 text-neutral-800">
          Der Termin wurde nicht rechtzeitig bestätigt und ist wieder freigegeben. Bitte melden Sie
          sich erneut an.
        </p>
      {/if}
    </div>

    <dl class="mt-6 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
      <dt class="text-neutral-700">Termin</dt>
      <dd class="font-semibold text-brand-900">{slotText(booking)}</dd>
      <dt class="text-neutral-700">Familie</dt>
      <dd class="text-neutral-900">{booking.familyName}</dd>
      <dt class="text-neutral-700">Krampus</dt>
      <dd class="text-neutral-900">
        {booking.withKrampus ? 'darf mit reinkommen' : 'bleibt draußen'}
      </dd>
    </dl>

    <div class="mt-8 flex flex-wrap items-center gap-3">
      {#if booking.status === 'pending'}
        <button
          type="button"
          class="action-primary"
          disabled={busy !== null}
          aria-busy={busy === 'confirm'}
          onclick={() => runAction('confirm')}
        >
          {busy === 'confirm' ? 'Wird bestätigt …' : 'Termin verbindlich bestätigen'}
        </button>
      {/if}

      {#if booking.status === 'pending' || booking.status === 'confirmed'}
        {#if confirmCancel}
          <span class="text-sm text-neutral-800">Wirklich absagen?</span>
          <button
            type="button"
            class="action-danger"
            disabled={busy !== null}
            aria-busy={busy === 'cancel'}
            onclick={() => runAction('cancel')}
          >
            {busy === 'cancel' ? 'Wird abgesagt …' : 'Ja, Termin absagen'}
          </button>
          <button
            type="button"
            class="action-secondary"
            disabled={busy !== null}
            onclick={() => (confirmCancel = false)}
          >
            Nein, behalten
          </button>
        {:else}
          <button
            type="button"
            class="action-secondary"
            disabled={busy !== null}
            onclick={() => (confirmCancel = true)}
          >
            Termin absagen
          </button>
        {/if}
      {/if}

      {#if booking.status === 'cancelled' || booking.status === 'expired'}
        <a href="/nikolaus" class="action-primary no-underline">Neuen Termin buchen</a>
      {/if}
    </div>

    {#if actionError}
      <p
        class="mt-4 rounded-md border border-[var(--color-dpsg-red)]/30 bg-[var(--color-dpsg-red)]/5 px-4 py-3 text-sm text-[var(--color-dpsg-red)]"
        role="alert"
      >
        {actionError}
      </p>
    {/if}
  </article>
{/if}

<style>
  .action-primary,
  .action-danger,
  .action-secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    padding: 0.75rem 1.5rem;
    font-size: 0.875rem;
    font-weight: 600;
    transition:
      transform 0.15s ease,
      background 0.15s ease;
  }
  .action-primary {
    background: var(--color-dpsg-red);
    color: white;
  }
  .action-danger {
    background: var(--color-brand-900);
    color: white;
  }
  .action-secondary {
    border: 1px solid var(--color-brand-300);
    background: white;
    color: var(--color-brand-900);
  }
  .action-primary:hover:not(:disabled),
  .action-danger:hover:not(:disabled) {
    transform: translateY(-1px);
  }
  .action-secondary:hover:not(:disabled) {
    background: var(--color-brand-50);
  }
  button:disabled {
    cursor: wait;
    opacity: 0.7;
  }
  .action-primary:focus-visible,
  .action-danger:focus-visible,
  .action-secondary:focus-visible {
    outline: 3px solid var(--color-brand-900);
    outline-offset: 2px;
  }
</style>
