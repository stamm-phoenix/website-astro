<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import StaffModuleSearch from './StaffModuleSearch.svelte';
  import { authStore, fetchPrincipal } from '../lib/authStore.svelte';
  import { fetchNikolausStatus, nikolausStatusStore } from '../lib/nikolausStatusStore.svelte';
  import {
    favoritesStore,
    favoritesUnsaved,
    loadFavorites,
    saveFavorites,
  } from '../lib/staffFavoritesStore.svelte';
  import { guardUnsavedChanges } from '../lib/unsavedChanges';
  import Toast from './ui/Toast.svelte';
  import { loadRecent, recentStore, recordVisit } from '../lib/staffRecentStore.svelte';
  import {
    STAFF_DEFAULT_QUICK,
    STAFF_FAVORITE_PATHS,
    STAFF_HOME,
    type StaffModule,
  } from '../lib/staffModules';
  import { yourStaffModules, type StaffModuleGroup } from '../lib/staffSearch';
  import { HELP_CONTACTS } from '../lib/helpContacts';
  import {
    SWIPE_START,
    commits,
    moveTrack,
    panelDuration,
    releaseVelocity,
    rubberBand,
    settleDuration,
    settleEasing,
    settleTransition,
    startTrack,
    type SwipeTrack,
  } from '../lib/swipe';

  interface Props {
    sections: StaffModuleGroup[];
    /** Shown in the section „Nikolausdienst“ while the staff modules are switched on. */
    nikolausModules: StaffModule[];
    nikolausControl: StaffModule;
    /** The current page. */
    current: string;
    /** The pages above the current page; their module counts as current too. */
    ancestors: string[];
    /** The module of the current page, recorded as recently used; none on the start page. */
    module?: string;
  }

  let { sections, nikolausModules, nikolausControl, current, ancestors, module }: Props = $props();

  /** Areas in the bar between „Übersicht“ and „Menü“. */
  const QUICK_COUNT = 3;
  const nikolausActive = $derived(nikolausStatusStore.data?.staffActive === true);
  // Modules of the Nikolausdienst only while they are switched on (Steuerung always)
  const allModules = $derived([
    ...sections.flatMap((section) => section.modules),
    nikolausControl,
    ...(nikolausActive ? nikolausModules : []),
  ]);
  const groups = $derived<StaffModuleGroup[]>([
    ...sections,
    {
      id: 'nikolaus',
      title: 'Nikolausdienst',
      modules: [...(nikolausActive ? nikolausModules : []), nikolausControl],
    },
  ]);

  // Favorites first, then the recently used areas, filled up with the usual ones
  // Without favorites (load failed, login not checked) the bar still fills up
  const ready = $derived(
    recentStore.loaded &&
      (nikolausStatusStore.data !== null || nikolausStatusStore.error !== null) &&
      (favoritesStore.loaded ||
        favoritesStore.loadError !== null ||
        (!authStore.loading && !authStore.principal))
  );
  const quick = $derived.by(() => {
    const picked = yourStaffModules(
      favoritesStore.loaded ? favoritesStore.modules : [],
      recentStore.modules,
      allModules,
      QUICK_COUNT
    );
    return yourStaffModules(
      picked.map((entry) => entry.href),
      STAFF_DEFAULT_QUICK,
      allModules,
      QUICK_COUNT
    );
  });

  // Once shown, the bar keeps its areas while the start page loads the favorites again;
  // a module that was switched off meanwhile still leaves it
  let shownQuick = $state<StaffModule[] | null>(null);
  $effect(() => {
    if (ready) {
      shownQuick = quick;
      return;
    }
    const shown = untrack(() => shownQuick);
    const kept = shown?.filter((entry) => allModules.some((module) => module.href === entry.href));
    if (shown && kept && kept.length !== shown.length) shownQuick = kept;
  });

  let open = $state(false);

  function isCurrent(href: string): boolean {
    return href === current || ancestors.includes(href);
  }
  const home = $derived(current === STAFF_HOME.href);
  // The current page is highlighted in the bar; „Menü“ stands in for modules not in it
  const inBar = $derived(home || (shownQuick ?? []).some((entry) => isCurrent(entry.href)));

  // Favorites change with the star or a long press on every page; a change that failed to save
  // is lost when leaving, so ask first
  $effect(() => {
    const unguard = guardUnsavedChanges(favoritesUnsaved);
    return () => {
      unguard();
      // Leaving with an unsaved change was confirmed: the next page loads the saved favorites
      if (favoritesUnsaved()) {
        favoritesStore.modules = favoritesStore.saved;
        favoritesStore.loaded = false;
        favoritesStore.notice = null;
      }
    };
  });

  // The real height of the bar, also when a label takes two lines or the font is larger
  let bar = $state<HTMLElement>();
  $effect(() => {
    if (!bar) return;
    const element = bar;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => {
      root.style.setProperty('--staff-bar-measured', `${element.offsetHeight}px`);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--staff-bar-measured');
    };
  });

  onMount(() => {
    if (module) void recordVisit(module);
    else void loadRecent();
    void fetchPrincipal();
    // Whether Nikolaus modules may appear in the bar; the Steuerung refreshes it on a change
    void fetchNikolausStatus();
  });

  // The start page loads the favorites itself (StaffDashboard); elsewhere the bar needs them
  $effect(() => {
    const userId = authStore.principal?.userId;
    // A failed load is not repeated here, the start page offers „Erneut versuchen“
    if (
      !home &&
      userId &&
      !favoritesStore.loaded &&
      !favoritesStore.loading &&
      favoritesStore.loadError === null
    ) {
      void loadFavorites(userId, STAFF_FAVORITE_PATHS);
    }
  });

  let menuButton = $state<HTMLButtonElement>();
  let closeButton = $state<HTMLButtonElement>();
  let panel = $state<HTMLElement>();
  let panelHeader = $state<HTMLElement>();
  let list = $state<HTMLElement>();

  /*
   * The panel „Alle Bereiche“ slides up above the bar. `open` is what it is about to be (for
   * aria-expanded), `mounted` keeps it in the page while it slides away. `offset` moves it down:
   * 0 is fully open, its height fully closed; a finger on the panel or the bar sets it directly.
   * `settleMs` is the length of the current movement: 0 while a finger moves the panel and
   * with Reduced Motion, shorter than `--motion-panel` after a quick flick.
   */
  let mounted = $state(false);
  let offset = $state(0);
  let settleMs = $state(0);
  /** Curve of the current movement, starting at the speed of a released finger. */
  let settleCurve = $state('var(--motion-enter)');
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  const panelHeight = (): number => panel?.offsetHeight ?? window.innerHeight * 0.8;
  const nextFrame = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  /** How far the panel is open, 0 to 1; the dimming of the page follows it. */
  const progress = $derived(mounted ? Math.min(1, Math.max(0, 1 - offset / panelHeight())) : 0);

  /**
   * Moves the panel to `target`. `velocity` is the speed of a released finger towards it in
   * pixels per millisecond, so the movement goes on at that speed; 0 takes the full duration.
   * Returns the length of the movement.
   */
  function settle(target: number, velocity = 0): number {
    settleMs = settleDuration(target - offset, velocity, panelDuration());
    settleCurve = settleEasing(target - offset, velocity, settleMs);
    offset = target;
    return settleMs;
  }

  /** Puts the panel into the page below its open place, so it can slide or be pulled up. */
  async function mount(): Promise<void> {
    clearTimeout(closeTimer);
    if (mounted) return;
    settleMs = 0;
    offset = window.innerHeight;
    mounted = true;
    await tick();
    offset = panelHeight();
  }

  async function show(focus: boolean): Promise<void> {
    open = true;
    await mount();
    await nextFrame();
    settle(0);
    if (focus) closeButton?.focus({ preventScroll: true });
  }

  function hide(returnFocus: boolean, velocity = 0): void {
    open = false;
    const duration = settle(panelHeight(), velocity);
    clearTimeout(closeTimer);
    // Opened again meanwhile: `open` is true again and the panel stays
    closeTimer = setTimeout(() => (mounted = open), duration);
    if (returnFocus) menuButton?.focus();
  }

  /**
   * Keyboard focus leaving the panel and the bar for the covered page closes the panel. Safari
   * focuses the surrounding `<main tabindex="-1">` on a tap on „Menü“; that is no move away,
   * else the panel closes and the click opens it again.
   */
  function onfocusin(event: FocusEvent): void {
    const target = event.target;
    if (!open || !(target instanceof Node)) return;
    if (panel?.contains(target) || (bar && (bar.contains(target) || target.contains(bar)))) return;
    hide(false);
  }

  function toggleSheet(): void {
    if (suppressClick) return;
    if (open) hide(true);
    else void show(true);
  }

  function closeSheet(): void {
    hide(true);
  }

  function onkeydown(event: KeyboardEvent): void {
    if (open && event.key === 'Escape' && !event.defaultPrevented) closeSheet();
  }

  /*
   * Swiping. Down on the panel (from its title, or from the list once it is scrolled to the top)
   * pulls it along; let go below a third of its height or with a quick flick and it closes,
   * otherwise it springs back. Up on the bar pulls the panel out the same way. The rest of the
   * movement goes on at the speed the finger left it.
   */
  interface Swipe {
    track: SwipeTrack;
    active: boolean;
    fromHeader: boolean;
  }
  let swipe: Swipe | null = null;
  let barSwipe: Swipe | null = null;
  /** A swipe on the bar must not also follow the link it started on. */
  let suppressClick = false;

  function begin(event: TouchEvent, fromHeader = false): Swipe | null {
    if (event.touches.length !== 1) return null;
    const touch = event.touches[0];
    return {
      track: startTrack(touch.clientX, touch.clientY, event.timeStamp),
      active: false,
      fromHeader,
    };
  }

  function onPanelTouchStart(event: TouchEvent): void {
    // A second finger ends the pull: the panel goes back open instead of staying where it was
    if (swipe?.active) settle(0);
    const target = event.target;
    swipe = begin(event, target instanceof Node && !!panelHeader?.contains(target));
  }

  function onPanelTouchMove(event: TouchEvent): void {
    if (!swipe || event.touches.length !== 1) return;
    const { clientX: x, clientY: y } = event.touches[0];
    const { track } = swipe;
    const dy = y - track.startY;
    if (!swipe.active) {
      const atTop = swipe.fromHeader || (list?.scrollTop ?? 0) <= 0;
      if (dy > SWIPE_START && atTop) {
        swipe.active = true;
        track.startY = y;
        settleMs = 0;
      } else {
        // Scrolling the list, or a swipe that is not (yet) a pull
        if (Math.abs(dy) > SWIPE_START) swipe = null;
        return;
      }
    }
    event.preventDefault();
    const pulled = y - track.startY;
    // Down follows the finger; up past the open place gives a little and springs back
    offset = pulled >= 0 ? pulled : -rubberBand(-pulled);
    moveTrack(track, x, y, event.timeStamp);
  }

  function onPanelTouchEnd(event: TouchEvent): void {
    const ended = swipe;
    swipe = null;
    if (!ended?.active) return;
    // Positive downwards, towards closed
    const velocity = releaseVelocity(ended.track, 'y', event.timeStamp);
    if (commits(offset, velocity, panelHeight() / 3)) hide(false, velocity);
    else settle(0, -velocity);
  }

  function onBarTouchStart(event: TouchEvent): void {
    // A second finger ends the pull: the panel goes back down instead of staying half open
    if (barSwipe?.active) {
      barSwipe = null;
      hide(false);
      return;
    }
    barSwipe = open ? null : begin(event);
  }

  function onBarTouchMove(event: TouchEvent): void {
    if (!barSwipe || event.touches.length !== 1) return;
    const { clientX: x, clientY: y } = event.touches[0];
    const { track } = barSwipe;
    const pulled = track.startY - y;
    if (!barSwipe.active) {
      if (pulled > SWIPE_START) {
        barSwipe.active = true;
        track.startY = y;
        open = true;
        settleMs = 0;
        void mount();
      } else {
        if (Math.abs(pulled) > SWIPE_START) barSwipe = null;
        return;
      }
    }
    event.preventDefault();
    offset = Math.max(0, panelHeight() - (track.startY - y));
    moveTrack(track, x, y, event.timeStamp);
  }

  function onBarTouchEnd(event: TouchEvent): void {
    const ended = barSwipe;
    barSwipe = null;
    if (!ended?.active) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 400);
    const height = panelHeight();
    // Positive upwards, towards open
    const velocity = -releaseVelocity(ended.track, 'y', event.timeStamp);
    if (commits(height - offset, velocity, height / 4)) {
      open = true;
      settle(0, velocity);
    } else {
      hide(false, -velocity);
    }
  }

  // Touch moves must be able to stop the page from scrolling, which needs non-passive listeners
  $effect(() => {
    const element = panel;
    if (!element) return;
    element.addEventListener('touchmove', onPanelTouchMove, { passive: false });
    return () => element.removeEventListener('touchmove', onPanelTouchMove);
  });
  $effect(() => {
    const element = bar;
    if (!element) return;
    element.addEventListener('touchmove', onBarTouchMove, { passive: false });
    return () => element.removeEventListener('touchmove', onBarTouchMove);
  });
</script>

{#snippet moduleTitle(module: StaffModule)}
  {#each (module.wrap ?? module.title).split('|') as part, index (index)}{#if index > 0}<wbr
      />{/if}{part}{/each}
{/snippet}

{#snippet icon(path: string)}
  <svg
    aria-hidden="true"
    class="size-6 shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"><path d={path} /></svg
  >
{/snippet}

<nav
  bind:this={bar}
  aria-label="Schnellzugriff"
  data-sticky-bottom
  ontouchstart={onBarTouchStart}
  ontouchend={onBarTouchEnd}
  ontouchcancel={onBarTouchEnd}
  onclickcapture={(event) => {
    if (suppressClick) {
      event.preventDefault();
      event.stopPropagation();
    }
  }}
  class="staff-bottom-bar fixed inset-x-0 bottom-0 z-40 border-t border-neutral-300 bg-surface pb-[env(safe-area-inset-bottom)] print:hidden xl:hidden"
>
  <!-- Centered on tablets, so the areas stay close together -->
  <div class="mx-auto grid max-w-xl grid-cols-5" class:sheet-open={open}>
    <a href={STAFF_HOME.href} aria-current={home ? 'page' : undefined} class="staff-bar-item">
      {@render icon('M3 11l9-8 9 8M5 10v10h14V10')}
      <span>Übersicht</span>
    </a>
    {#if shownQuick}
      {#each shownQuick as entry (entry.href)}
        <a
          href={entry.href}
          data-astro-reload={entry.reload || undefined}
          aria-current={entry.href === current
            ? 'page'
            : isCurrent(entry.href)
              ? 'true'
              : undefined}
          class="staff-bar-item"
        >
          {@render icon(entry.icon)}
          <span>{@render moduleTitle(entry)}</span>
        </a>
      {/each}
    {:else}
      {#each { length: QUICK_COUNT }, index (index)}
        <span class="staff-bar-item" aria-hidden="true"></span>
      {/each}
    {/if}
    <button
      type="button"
      class="staff-bar-item"
      bind:this={menuButton}
      aria-expanded={open}
      aria-controls="staff-nav-panel"
      aria-current={inBar || open ? undefined : 'true'}
      onclick={toggleSheet}
    >
      {@render icon('M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z')}
      <span>Menü</span>
    </button>
  </div>
</nav>

{#if mounted}
  <!-- Dims the page above the bar; the bar stays usable, „Menü“ closes the panel again -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="staff-sheet-scrim fixed inset-x-0 top-0 z-30 print:hidden xl:hidden"
    style:opacity={progress}
    style:transition={settleTransition('opacity', settleMs, settleCurve)}
    onclick={closeSheet}
  ></div>
  <div
    bind:this={panel}
    id="staff-nav-panel"
    role="dialog"
    tabindex="-1"
    aria-labelledby="staff-nav-title"
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
        <button
          bind:this={closeButton}
          type="button"
          class="-mr-2 flex min-h-11 min-w-11 items-center justify-center rounded-sm p-2 text-neutral-700 hover:bg-[var(--color-brand-50)] hover:text-brand-900"
          aria-label="Schließen"
          onclick={closeSheet}
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
      <StaffModuleSearch
        {groups}
        variant="sheet"
        {current}
        {ancestors}
        onnavigate={() => hide(false)}
      />

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
          <li>
            <a href="/logout" class="inline-flex min-h-11 items-center font-semibold text-link">
              Abmelden
            </a>
          </li>
        </ul>
      </div>
    </div>
  </div>
{/if}

<svelte:window {onkeydown} />
<svelte:document {onfocusin} />

<!-- The result of a change to the favorites, wherever it was made -->
<Toast
  message={favoritesStore.notice?.text ?? null}
  kind={favoritesStore.notice?.kind}
  actionLabel={favoritesStore.notice?.kind === 'error' ? 'Erneut speichern' : undefined}
  duration={favoritesStore.notice?.kind === 'error' ? 0 : undefined}
  onaction={() => saveFavorites()}
  onclose={() => (favoritesStore.notice = null)}
/>

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
  .staff-bar-item {
    display: flex;
    min-height: 3.75rem;
    min-width: 0;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.125rem;
    padding: 0.375rem 0.125rem 0.25rem;
    border-top: 3px solid transparent;
    color: var(--color-neutral-700);
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.1;
    text-align: center;
    text-decoration: none;
    hyphens: auto;
    overflow-wrap: break-word;
    cursor: pointer;
  }
  /* While the panel is open, „Menü“ is marked instead of the current page */
  .staff-bar-item[aria-expanded='true'] {
    border-top-color: var(--color-accent-500);
    color: var(--color-brand-900);
    font-weight: 700;
  }
  .sheet-open .staff-bar-item[aria-current] {
    border-top-color: transparent;
    color: var(--color-neutral-700);
    font-weight: 600;
  }
  .staff-bar-item[aria-current] {
    border-top-color: var(--color-accent-500);
    color: var(--color-brand-900);
    font-weight: 700;
  }
  .staff-bar-item:hover {
    color: var(--color-brand-900);
  }
</style>
