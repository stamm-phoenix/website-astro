<script lang="ts">
  /**
   * The „(i)“ next to a label or heading: a round button that opens a short explanation in a
   * popover. For the rule or consequence a screen cannot show by itself; everything the data or
   * the result shows stays out of the UI. Closes with Escape, a tap outside or when the focus
   * leaves it; the focus stays on the button, so keyboard users continue where they were.
   */
  import { tick, type Snippet } from 'svelte';

  interface Props {
    /** What the explanation is about; the button is named „Erklärung zu <label>“. */
    label: string;
    /** The explanation as plain text, one paragraph; `children` for several or with markup. */
    text?: string;
    children?: Snippet;
    class?: string;
  }
  let { label, text, children, class: className = '' }: Props = $props();

  const id = $props.id();
  let open = $state(false);
  /**
   * Viewport position of the panel: under the button, or above it when there is more room there,
   * kept inside the screen with a margin. A longer text than fits scrolls inside the panel.
   */
  let panelLeft = $state(0);
  /** Distance from the top of the screen when below the button, from the bottom when above. */
  let panelTop = $state<number | undefined>(0);
  let panelBottom = $state<number | undefined>(undefined);
  let panelWidth = $state(0);
  let panelMaxHeight = $state<number | undefined>(undefined);
  let root = $state<HTMLSpanElement | null>(null);
  let button = $state<HTMLButtonElement | null>(null);
  let panel = $state<HTMLSpanElement | null>(null);
  /** A text longer than the room scrolls; then the panel takes the focus for the arrow keys. */
  let scrolls = $state(false);

  function place(): void {
    const rect = button?.getBoundingClientRect();
    if (!rect) return;
    const margin = 16;
    const gap = 4;
    panelWidth = Math.min(352, window.innerWidth - 2 * margin);
    panelLeft = Math.min(Math.max(rect.left - 4, margin), window.innerWidth - margin - panelWidth);
    const below = Math.max(0, window.innerHeight - margin - rect.bottom - gap);
    const above = Math.max(0, rect.top - gap - margin);
    // The height of the whole text, whatever the current limit is
    const height = panel ? panel.scrollHeight + (panel.offsetHeight - panel.clientHeight) : 0;
    if (height <= below || below >= above) {
      panelTop = rect.bottom + gap;
      panelBottom = undefined;
      panelMaxHeight = below;
    } else {
      panelTop = undefined;
      panelBottom = window.innerHeight - rect.top + gap;
      panelMaxHeight = above;
    }
    scrolls = height > (panelMaxHeight ?? Infinity) + 1;
  }
  async function toggle(): Promise<void> {
    if (open) {
      open = false;
      return;
    }
    place();
    open = true;
    // Measure the rendered text to decide between below and above
    await tick();
    place();
  }

  function onPointerDown(event: PointerEvent): void {
    if (root && event.target instanceof Node && !root.contains(event.target)) open = false;
  }
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    // Only the popover closes, not a dialog around it
    event.preventDefault();
    event.stopPropagation();
    open = false;
    if (root?.contains(document.activeElement)) button?.focus();
  }
  function onFocusOut(event: FocusEvent): void {
    if (root && event.relatedTarget instanceof Node && !root.contains(event.relatedTarget)) {
      open = false;
    }
  }
</script>

<svelte:document
  onpointerdown={open ? onPointerDown : undefined}
  onkeydown={open ? onKeyDown : undefined}
  onscrollcapture={open ? place : undefined}
/>
<svelte:window onresize={open ? place : undefined} />

<span bind:this={root} class="info-hint {className}" onfocusout={onFocusOut}>
  <button
    bind:this={button}
    type="button"
    class="info-hint-button"
    aria-expanded={open}
    aria-controls={id}
    onclick={toggle}
  >
    <!-- Named by text, not aria-label, so a label lookup for the field finds only the field -->
    <span class="sr-only">Erklärung zu {label}</span>
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" stroke-width="1.5" />
      <circle cx="10" cy="6.4" r="1" fill="currentColor" />
      <path d="M8.6 8.75h1.9v4.5h1.1" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M8.5 13.25h3" fill="none" stroke="currentColor" stroke-width="1.5" />
    </svg>
  </button>
  {#if open}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard scrolling of a long explanation) -->
    <span
      {id}
      class="info-hint-panel"
      role="note"
      tabindex={scrolls ? 0 : undefined}
      aria-label={scrolls ? `Erklärung zu ${label}` : undefined}
      style:left="{panelLeft}px"
      style:top={panelTop === undefined ? undefined : `${panelTop}px`}
      style:bottom={panelBottom === undefined ? undefined : `${panelBottom}px`}
      style:width="{panelWidth}px"
      style:max-height={panelMaxHeight === undefined ? undefined : `${panelMaxHeight}px`}
      bind:this={panel}
    >
      {#if children}{@render children()}{:else}{text}{/if}
    </span>
  {/if}
</span>

<style>
  .info-hint {
    display: inline-flex;
    vertical-align: middle;
  }
  .info-hint-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* 44 px hit area around an 18 px icon, without pushing the neighbouring text apart. */
    width: 2.75rem;
    height: 2.75rem;
    margin: calc(var(--spacing) * -3.25) calc(var(--spacing) * -2);
    border: 0;
    border-radius: 9999px;
    background: transparent;
    color: var(--color-neutral-700);
    cursor: pointer;
  }
  .info-hint-button:hover,
  .info-hint-button[aria-expanded='true'] {
    color: var(--color-link);
  }
  .info-hint-panel {
    position: fixed;
    z-index: 60;
    display: block;
    padding: calc(var(--spacing) * 2.5) calc(var(--spacing) * 3);
    border: 1px solid var(--color-neutral-200);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    box-shadow: var(--shadow-lift);
    font-size: 0.875rem;
    font-weight: 400;
    line-height: 1.45;
    color: var(--color-neutral-800);
    text-align: left;
    white-space: normal;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .info-hint-panel :global(p + p) {
    margin-top: calc(var(--spacing) * 2);
  }
</style>
