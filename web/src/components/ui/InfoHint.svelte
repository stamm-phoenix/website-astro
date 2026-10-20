<script lang="ts">
  /**
   * The „(i)“ next to a label or heading: a round button that opens a short explanation in a
   * popover. For the rule or consequence a screen cannot show by itself; everything the data or
   * the result shows stays out of the UI. Closes with Escape, a tap outside or when the focus
   * leaves it; the focus stays on the button, so keyboard users continue where they were.
   */
  import type { Snippet } from 'svelte';

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
  /** Viewport position of the panel: under the button, kept inside the screen with a margin. */
  let panelLeft = $state(0);
  let panelTop = $state(0);
  let panelWidth = $state(0);
  let root = $state<HTMLSpanElement | null>(null);
  let button = $state<HTMLButtonElement | null>(null);

  function place(): void {
    const rect = button?.getBoundingClientRect();
    if (!rect) return;
    const margin = 16;
    panelWidth = Math.min(352, window.innerWidth - 2 * margin);
    panelLeft = Math.min(Math.max(rect.left - 4, margin), window.innerWidth - margin - panelWidth);
    panelTop = rect.bottom + 4;
  }
  function toggle(): void {
    if (open) {
      open = false;
      return;
    }
    place();
    open = true;
  }

  function onPointerDown(event: PointerEvent): void {
    if (root && event.target instanceof Node && !root.contains(event.target)) open = false;
  }
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
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
    aria-label="Erklärung zu {label}"
    aria-expanded={open}
    aria-controls={id}
    onclick={toggle}
  >
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" stroke-width="1.5" />
      <circle cx="10" cy="6.4" r="1" fill="currentColor" />
      <path d="M8.6 8.75h1.9v4.5h1.1" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M8.5 13.25h3" fill="none" stroke="currentColor" stroke-width="1.5" />
    </svg>
  </button>
  {#if open}
    <span
      {id}
      class="info-hint-panel"
      role="note"
      style:left="{panelLeft}px"
      style:top="{panelTop}px"
      style:width="{panelWidth}px"
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
    margin: -0.8125rem -0.5rem;
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
    padding: 0.625rem 0.75rem;
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
  }
  .info-hint-panel :global(p + p) {
    margin-top: 0.5rem;
  }
</style>
