<script lang="ts">
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';

  /**
   * Confirms the approval of minutes. Every leader may approve; one's own minutes need the box
   * „ohne zweite Person“ ticked, so skipping the review is a deliberate choice.
   */
  interface Props {
    open: boolean;
    /** Title of the minutes, named in the question. */
    title: string;
    /** Whether the user wrote the minutes. */
    own: boolean;
    /** Whether the minutes are still a draft, i.e. nobody reviewed them. */
    draft: boolean;
    /** What the approval does and whether the minutes can still change. */
    consequence: string;
    /** Version of the minutes being approved; a new version needs the box ticked again. */
    version: string;
    busy: boolean;
    error: string | null;
    onclose: () => void;
    onconfirm: (ownConfirmed: boolean) => void;
    /** Loads the current version after a conflict; the box must then be ticked again. */
    onreload?: () => Promise<void>;
  }
  let {
    open,
    title,
    own,
    draft,
    consequence,
    version,
    busy,
    error,
    onclose,
    onconfirm,
    onreload,
  }: Props = $props();

  let ownConfirmed = $state(false);
  let missing = $state(false);

  // Opening the dialog or loading another version clears the tick: it confirms only the
  // version the user saw
  $effect(() => {
    void version;
    if (open) {
      ownConfirmed = false;
      missing = false;
    }
  });
</script>

<ConfirmDialog
  {open}
  title={`„${title}“ freigeben?`}
  tone="neutral"
  submitLabel="Freigeben"
  busyLabel="Wird freigegeben …"
  {busy}
  error={missing
    ? 'Setz erst das Häkchen, wenn du dein Protokoll ohne zweite Person freigeben willst.'
    : error}
  {onclose}
  onreload={onreload
    ? async () => {
        await onreload();
        ownConfirmed = false;
        missing = false;
      }
    : undefined}
  onconfirm={() => {
    if (own && !ownConfirmed) {
      missing = true;
      return;
    }
    onconfirm(ownConfirmed);
  }}
>
  <p>{consequence}</p>
  {#if draft && !own}
    <p class="text-sm text-neutral-700">
      Es war noch nicht im Review. Gib es nur frei, wenn du es selbst durchgesehen hast.
    </p>
  {/if}
  {#if own}
    <p class="text-sm text-neutral-700">
      {#if draft}
        Das ist dein eigenes Protokoll. Möchtest du, dass noch jemand drüberschaut, gib es
        stattdessen zum Review.
      {:else}
        Das ist dein eigenes Protokoll. Gibst du es selbst frei, schaut niemand mehr drüber.
      {/if}
    </p>
    <label class="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
      <input
        type="checkbox"
        class="size-5 shrink-0"
        bind:checked={ownConfirmed}
        onchange={() => (missing = false)}
      />
      Ich habe mein Protokoll selbst geprüft und gebe es ohne zweite Person frei.
    </label>
  {/if}
  <p class="text-sm text-neutral-700">Verschickt wird es erst im nächsten Schritt.</p>
</ConfirmDialog>
