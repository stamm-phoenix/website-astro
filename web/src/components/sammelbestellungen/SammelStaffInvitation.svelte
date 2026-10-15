<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import SammelInvitationRelease from './SammelInvitationRelease.svelte';
  import { formatDateTime } from '../../lib/format';
  import { isSammelOpen } from '../../lib/sammelbestellung';
  import type { SammelStaffView } from '../../lib/types';
  interface Props {
    view: SammelStaffView;
    busy: boolean;
    loading: boolean;
    onerror: (text: string) => void;
  }
  let { view, busy, loading, onerror }: Props = $props();
  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  /** Copies the shared campaign invitation, with manual-copy guidance on clipboard failure. */
  async function copyInvitation(): Promise<void> {
    if (!view) return;
    try {
      await navigator.clipboard.writeText(view.invitationUrl);
      // Confirmed on the button itself; the page message is far away from it.
      copied = true;
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => (copied = false), 3000);
    } catch {
      onerror('Bitte markiere und kopiere den Einladungslink im Textfeld.');
    }
  }
</script>

<section aria-labelledby="invite-heading" class="mt-6 max-w-3xl">
  <h2 id="invite-heading" class="font-serif text-xl font-semibold text-brand-900">
    Einladung über CampFlow
  </h2>
  <p class="mt-2 text-sm text-neutral-700">
    {formatDateTime(view.campaign.startsAt)} bis {formatDateTime(view.campaign.endsAt)} Uhr ·
    {isSammelOpen(view.campaign) ? 'Bestellzeitraum offen' : 'Bestellzeitraum geschlossen'}
  </p>
  <p class="mt-3 text-sm text-neutral-700">
    Diesen Link erhalten alle Mitglieder in derselben CampFlow-Mail. Die Website verschickt
    anschließend die persönlichen Bestelllinks. Der Einladungslink ist nur für Mitglieder bestimmt.
  </p>
  <label class="form-label mt-4" for="invitation-url">Gemeinsamer Einladungslink</label>
  <div class="flex flex-col gap-2 sm:flex-row">
    <input
      id="invitation-url"
      class="form-input min-w-0 flex-1"
      readonly
      value={view.invitationUrl}
    /><ActionButton
      type="button"
      variant="secondary"
      disabled={view.campaign.archived}
      onclick={() => void copyInvitation()}
      ><span aria-live="polite"
        >{copied ? 'Link kopiert' : 'Link kopieren'}{#if copied}<span aria-hidden="true">
            ✓</span
          >{/if}</span
      ></ActionButton
    >
  </div>
  <SammelInvitationRelease
    campaignId={view.campaign.id}
    disabled={!isSammelOpen(view.campaign) || busy || loading}
  />
</section>
