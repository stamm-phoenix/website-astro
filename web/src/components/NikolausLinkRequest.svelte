<script lang="ts">
  import ActionButton from './ui/ActionButton.svelte';
  import { ApiError, postApi } from '../lib/api';
  import { NIKOLAUS_MAX_LENGTH, isValidNikolausEmail } from '../lib/nikolausConfig';
  import type { NikolausLinkRequested } from '../lib/types';

  interface Props {
    /** Prefix for element IDs, so the component can appear several times. */
    idPrefix: string;
    /** Known address, e.g. from the booking form; otherwise an input field is shown. */
    email?: string;
  }

  let { idPrefix, email: fixedEmail }: Props = $props();

  let email = $state('');
  let website = $state('');
  let error = $state<string | null>(null);
  let sending = $state(false);
  let sentTo = $state<{ email: string; cooldownMinutes: number } | null>(null);

  const address = $derived((fixedEmail ?? email).trim());

  async function requestLink(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (sending) return;

    if (!isValidNikolausEmail(address)) {
      error = 'Bitte geben Sie eine gültige E-Mail-Adresse an.';
      document.getElementById(`${idPrefix}-link-email`)?.focus();
      return;
    }

    error = null;
    sending = true;
    try {
      const result = await postApi<NikolausLinkRequested>('/nikolaus/manage/resend-link', {
        email: address,
        website,
      });
      sentTo = { email: address, cooldownMinutes: result.cooldownMinutes };
    } catch (err: unknown) {
      error =
        err instanceof ApiError && err.code
          ? err.message
          : 'Das hat leider nicht geklappt. Bitte versuchen Sie es später erneut.';
    } finally {
      sending = false;
    }
  }
</script>

{#if sentTo}
  <div
    class="border-l-4 border-[var(--color-dpsg-pfadfinder)] py-1 pl-4 text-sm text-neutral-800"
    role="status"
  >
    <p>
      <strong>Fast geschafft!</strong>
      {#if fixedEmail}
        Wir haben Ihnen einen neuen Link zur Terminverwaltung an <strong>{sentTo.email}</strong> geschickt.
      {:else}
        Falls es für <strong>{sentTo.email}</strong> einen Termin gibt, haben wir Ihnen gerade einen neuen
        Link zur Terminverwaltung geschickt.
      {/if}
    </p>
    <p class="mt-2 text-neutral-700">
      Keine E-Mail erhalten? Bitte schauen Sie auch im Spam-Ordner nach. Pro Termin verschicken wir
      höchstens alle {sentTo.cooldownMinutes} Minuten einen neuen Link – haben Sie gerade erst einen angefordert,
      verwenden Sie bitte den aus dieser E-Mail.
    </p>
  </div>
{:else}
  <form class="space-y-3" novalidate onsubmit={requestLink}>
    {#if !fixedEmail}
      <div>
        <label for="{idPrefix}-link-email" class="text-sm font-semibold text-brand-900">
          E-Mail-Adresse Ihrer Buchung
        </label>
        <input
          id="{idPrefix}-link-email"
          type="email"
          autocomplete="email"
          maxlength={NIKOLAUS_MAX_LENGTH.email}
          required
          bind:value={email}
          oninput={() => (error = null)}
          class={[
            'mt-1 block w-full max-w-md rounded-md border bg-surface px-3 py-2.5 text-base text-neutral-900 shadow-sm',
            'focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)]',
            error ? 'border-danger' : 'border-neutral-300',
          ].join(' ')}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby="{idPrefix}-link-hint{error ? ` ${idPrefix}-link-error` : ''}"
        />
      </div>
      <!-- Honeypot for bots, hidden from humans and assistive technology -->
      <div class="hp" aria-hidden="true">
        <label for="{idPrefix}-link-website">Website</label>
        <input
          id="{idPrefix}-link-website"
          type="text"
          tabindex="-1"
          autocomplete="off"
          bind:value={website}
        />
      </div>
    {/if}

    <p id="{idPrefix}-link-hint" class="text-sm text-neutral-700">
      <strong class="font-semibold text-neutral-900">Hinweis:</strong>
      Mit dem neuen Link funktioniert der Link aus Ihrer bisherigen E-Mail nicht mehr. Ihr Termin selbst
      bleibt unverändert.
    </p>

    {#if error}
      <p id="{idPrefix}-link-error" class="text-sm text-[var(--color-dpsg-red)]" role="alert">
        {error}
      </p>
    {/if}

    <ActionButton
      variant="secondary"
      type="submit"
      class="disabled:cursor-wait"
      disabled={sending}
      aria-busy={sending}
    >
      {sending ? 'Wird gesendet …' : 'Neuen Link per E-Mail schicken'}
    </ActionButton>
  </form>
{/if}

<style>
  .hp {
    position: absolute;
    left: -10000px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }
</style>
