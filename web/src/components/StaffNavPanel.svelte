<script lang="ts">
  import StaffModuleSearch from './StaffModuleSearch.svelte';
  import { authStore } from '../lib/authStore.svelte';
  import { HELP_CONTACTS } from '../lib/helpContacts';
  import { settleTransition } from '../lib/swipe';
  import type { StaffModuleGroup } from '../lib/staffSearch';
  interface Props {
    mounted: boolean;
    open: boolean;
    progress: number;
    offset: number;
    settleMs: number;
    settleCurve: string;
    groups: StaffModuleGroup[];
    current: string;
    ancestors: string[];
    panel?: HTMLElement;
    panelHeader?: HTMLElement;
    list?: HTMLElement;
    closeButton?: HTMLButtonElement;
    onclose: () => void;
    onnavigate: () => void;
    onPanelTouchStart: (event: TouchEvent) => void;
    onPanelTouchEnd: (event: TouchEvent) => void;
  }
  let {
    mounted,
    open,
    progress,
    offset,
    settleMs,
    settleCurve,
    groups,
    current,
    ancestors,
    panel = $bindable(),
    panelHeader = $bindable(),
    list = $bindable(),
    closeButton = $bindable(),
    onclose,
    onnavigate,
    onPanelTouchStart,
    onPanelTouchEnd,
  }: Props = $props();
</script>

{#if mounted}
  <!-- Dims the page above the bar; the bar stays usable, „Menü“ closes the panel again -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="staff-sheet-scrim fixed inset-x-0 top-0 z-30 print:hidden xl:hidden"
    style:opacity={progress}
    style:transition={settleTransition('opacity', settleMs, settleCurve)}
    onclick={onclose}
  ></div>
  <div
    bind:this={panel}
    id="staff-nav-panel"
    tabindex="-1"
    aria-hidden={!open}
    inert={!open}
    style:transform="translateY({offset}px)"
    style:transition={settleTransition('transform', settleMs, settleCurve)}
    ontouchstart={onPanelTouchStart}
    ontouchend={onPanelTouchEnd}
    ontouchcancel={onPanelTouchEnd}
    class="staff-sheet fixed inset-x-0 z-[35] mx-auto flex w-full max-w-xl flex-col rounded-t-2xl border border-b-0 border-neutral-300 bg-surface shadow-lift print:hidden xl:hidden"
  >
    <div bind:this={panelHeader} class="shrink-0 border-b border-neutral-200">
      <!-- Grip: the panel can be pulled down to close it -->
      <div aria-hidden="true" class="mx-auto mt-2 h-1.5 w-10 rounded-full bg-neutral-300"></div>
      <div class="flex items-center justify-between gap-4 px-5 pt-1 pb-3">
        <h2 id="staff-nav-title" class="font-serif text-xl font-semibold text-brand-900">
          Alle Bereiche
        </h2>
        <a
          href="/logout"
          data-astro-reload
          class="ml-auto inline-flex min-h-11 items-center font-semibold text-link">Abmelden</a
        >
        <button
          bind:this={closeButton}
          type="button"
          class="-mr-2 flex min-h-11 min-w-11 items-center justify-center rounded-sm p-2 text-neutral-700 hover:bg-[var(--color-brand-50)] hover:text-brand-900"
          aria-label="Schließen"
          onclick={onclose}
        >
          <svg
            aria-hidden="true"
            class="size-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg
          >
        </button>
      </div>
    </div>
    <div
      bind:this={list}
      id="staff-nav"
      class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3"
    >
      <StaffModuleSearch {groups} variant="sheet" {current} {ancestors} {onnavigate} />

      <div class="mt-5 border-t border-neutral-300 pt-3 text-sm">
        <section aria-labelledby="staff-help-title">
          <h3 id="staff-help-title" class="m-0 text-sm font-semibold text-brand-900">
            Hilfe &amp; Kontakt
          </h3>
          <ul>
            <li>
              Technische Probleme:
              <a
                href="mailto:{HELP_CONTACTS.technik}"
                class="inline-flex min-h-11 items-center text-link">{HELP_CONTACTS.technik}</a
              >
            </li>
            <li>
              Alles andere:
              <a
                href="mailto:{HELP_CONTACTS.allgemein}"
                class="inline-flex min-h-11 items-center text-link">{HELP_CONTACTS.allgemein}</a
              >
            </li>
          </ul>
        </section>
        {#if authStore.principal}
          <p class="pt-1 text-neutral-700">
            Angemeldet als <span class="font-semibold">{authStore.principal.userDetails}</span>
          </p>
        {/if}
        <ul class="flex flex-wrap gap-x-6">
          <li>
            <a href="/" class="inline-flex min-h-11 items-center text-link">Zur Website</a>
          </li>
        </ul>
      </div>
    </div>
  </div>
{/if}

<style>
  /*
   * Above the bar at the bottom and behind it, so it slides out from under the bar; it keeps
   * clear of the header at the top, so its grip and rounded corners stay in view
   */
  .staff-sheet {
    bottom: var(--staff-bar-h, 0px);
    max-height: calc(100dvh - var(--staff-bar-h, 0px) - 6rem);
  }
  .staff-sheet-scrim {
    bottom: var(--staff-bar-h, 0px);
    background: var(--dialog-backdrop, rgb(0 48 86 / 0.35));
  }
</style>
