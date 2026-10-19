<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { TransitionBeforeSwapEvent } from 'astro:transitions/client';
  import StaffModuleSearch from './StaffModuleSearch.svelte';
  import { fetchNikolausStatus, nikolausStatusStore } from '../lib/nikolausStatusStore.svelte';
  import { STAFF_HOME, type StaffModule } from '../lib/staffModules';
  import type { StaffModuleGroup } from '../lib/staffSearch';
  import { HELP_CONTACTS } from '../lib/helpContacts';
  import { SIDEBAR_KEY } from '../lib/staffSidebar';

  interface Props {
    sections: StaffModuleGroup[];
    nikolausModules: StaffModule[];
    nikolausControl: StaffModule;
    current: string;
    ancestors: string[];
  }

  let { sections, nikolausModules, nikolausControl, current, ancestors }: Props = $props();

  const groups = $derived<StaffModuleGroup[]>([
    ...sections,
    {
      id: 'nikolaus',
      title: 'Nikolausdienst',
      modules: [...(nikolausStatusStore.data?.staffActive ? nikolausModules : []), nikolausControl],
    },
  ]);

  let input = $state<HTMLInputElement>();
  // Tailwind's `xl`, in rem like there, so a larger default font moves both alike
  const WIDE = '(min-width: 80rem)';
  const wide = (): boolean => window.matchMedia(WIDE).matches;

  /**
   * Reduced to its icons. The choice stays in this browser (`SIDEBAR_KEY`); StaffLayout reads it
   * before the page shows, so a full page load starts folded as well.
   */
  let collapsed = $state(
    typeof document !== 'undefined' &&
      document.documentElement.dataset.staffSidebar === 'eingeklappt'
  );
  /** Width changes animate only after the page has shown, not while it loads. */
  let animate = $state(false);

  onMount(() => {
    requestAnimationFrame(() => (animate = true));
    // The sidebar only shows on wide screens: load what it needs once the window is wide
    const media = window.matchMedia(WIDE);
    let started = false;
    function start(): void {
      if (started || !media.matches) return;
      started = true;
      void fetchNikolausStatus();
    }
    start();
    media.addEventListener('change', start);
    return () => media.removeEventListener('change', start);
  });

  function setCollapsed(value: boolean): void {
    collapsed = value;
    const stored = value ? 'eingeklappt' : 'ausgeklappt';
    document.documentElement.dataset.staffSidebar = stored;
    try {
      localStorage.setItem(SIDEBAR_KEY, stored);
    } catch {
      // Without browser storage the choice lasts until the next full page load
    }
  }

  /**
   * The name that slides out next to an icon of the folded sidebar while it is pointed at or has
   * the focus. Fixed on the page, because the scrolling sidebar would clip it.
   */
  interface Flyout {
    top: number;
    left: number;
    height: number;
    label: string;
    icon: string;
    current: boolean;
  }
  let nav = $state<HTMLElement>();
  /**
   * The item under the pointer and the one with the focus, kept apart: following a link moves the
   * focus for a moment, which must not hide and slide out again the name the pointer is still on.
   */
  let hovered = $state<HTMLElement | null>(null);
  let focused = $state<HTMLElement | null>(null);
  /** Whether the focus moved after the pointer did; the latest of the two decides. */
  let focusLast = $state(false);
  /**
   * Counts page changes and scrolling, so the name shown marks the new current area and stays
   * next to its item.
   */
  let moves = $state(0);
  /**
   * While a page changes, the view transition covers the page and takes the pointer away from the
   * sidebar for a moment; that is not the person moving it.
   */
  let changingPage = false;

  const flyout = $derived.by((): Flyout | null => {
    void moves;
    const item = collapsed ? (focusLast ? (focused ?? hovered) : (hovered ?? focused)) : null;
    if (!item?.isConnected) return null;
    const rect = item.getBoundingClientRect();
    return {
      top: rect.top,
      left: rect.left,
      height: rect.height,
      label: item.dataset.flyout ?? '',
      icon: item.dataset.flyoutIcon ?? '',
      // From the props, which follow the page change, not from the markup updated after them
      current: ((href) => href !== null && (href === current || ancestors.includes(href)))(
        item.getAttribute('href')
      ),
    };
  });

  function itemOf(event: Event): HTMLElement | null {
    const target = event.target;
    const item = target instanceof Element ? target.closest<HTMLElement>('[data-flyout]') : null;
    return item && nav?.contains(item) ? item : null;
  }
  /** Scrolling moves the items away from the pointer, not from the focus. */
  function onscroll(): void {
    moves++;
    // The scrolling carried over to the new page leaves the pointer on its item
    if (!changingPage) hovered = null;
  }
  onMount(() => {
    const leaving = (): void => {
      changingPage = true;
    };
    // Moving the kept sidebar into the new page resets its scrolling, so it is carried over
    let scrolled = 0;
    // The transition covers the page until its animation ends, after the new page has loaded
    const swapping = (event: TransitionBeforeSwapEvent): void => {
      scrolled = nav?.scrollTop ?? 0;
      void event.viewTransition.finished.finally(() => {
        changingPage = false;
      });
    };
    const swapped = (): void => {
      if (nav) nav.scrollTop = scrolled;
    };
    const changed = (): void => {
      moves++;
    };
    // Only once the new page is loaded: a change stopped before (unsaved input) never swaps
    document.addEventListener('astro:after-preparation', leaving);
    document.addEventListener('astro:before-swap', swapping);
    document.addEventListener('astro:after-swap', swapped);
    document.addEventListener('astro:page-load', changed);
    return () => {
      document.removeEventListener('astro:after-preparation', leaving);
      document.removeEventListener('astro:before-swap', swapping);
      document.removeEventListener('astro:after-swap', swapped);
      document.removeEventListener('astro:page-load', changed);
    };
  });

  async function search(): Promise<void> {
    if (collapsed) setCollapsed(false);
    await tick();
    input?.focus();
    input?.select();
  }

  function onkeydown(event: KeyboardEvent): void {
    // The text editors use Strg+K for links
    if (event.defaultPrevented) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && wide()) {
      event.preventDefault();
      void search();
    }
  }
</script>

<!-- Where the pointer is, also outside the sidebar: after a view transition no leave event comes -->
<svelte:window
  {onkeydown}
  onpointerover={(event) => {
    if (changingPage) return;
    hovered = itemOf(event);
    focusLast = false;
  }}
/>

<!-- Only a visual repeat of the name; the item itself carries it for screen readers -->
{#if flyout}
  <div
    aria-hidden="true"
    data-testid="staff-flyout"
    class="staff-flyout pointer-events-none fixed z-50 flex items-center gap-3 border border-neutral-300 bg-surface pr-4 pl-2 text-[0.95rem] whitespace-nowrap text-brand-900 shadow-lift {flyout.current
      ? 'font-semibold'
      : ''}"
    class:is-current={flyout.current}
    style:top="{flyout.top}px"
    style:left="{flyout.left}px"
    style:min-height="{flyout.height}px"
  >
    {#if flyout.icon}<svg
        class="size-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"><path d={flyout.icon} /></svg
      >{/if}
    <span>{flyout.label}</span>
  </div>
{/if}

<nav
  bind:this={nav}
  onfocusin={(event) => {
    // Only the keyboard focus; a click focuses the link too, but the pointer shows its name
    const item = itemOf(event);
    focused = item?.matches(':focus-visible') ? item : null;
    focusLast = true;
  }}
  onfocusout={() => (focused = null)}
  {onscroll}
  aria-label="Bereiche des Leitendenbereichs"
  class="staff-sidebar hidden shrink-0 self-start overflow-x-hidden border-r border-neutral-200 print:hidden xl:sticky xl:top-24 xl:block xl:max-h-[calc(100dvh-7rem)] xl:overflow-y-auto xl:overscroll-contain {collapsed
    ? 'w-14 pr-2'
    : 'w-64 pr-4'} {animate
    ? 'transition-[width,padding] duration-200 ease-out motion-reduce:transition-none'
    : ''}"
>
  <button
    type="button"
    class="mb-1 flex min-h-11 w-full items-center gap-3 px-2 text-sm whitespace-nowrap text-neutral-700 hover:bg-[var(--color-brand-50)] hover:text-brand-900 pointer-fine:min-h-9"
    aria-expanded={!collapsed}
    data-flyout="Seitenleiste ausklappen"
    data-flyout-icon="M4 4h16v16H4zM9 4v16M13 10l2 2-2 2"
    onclick={() => setCollapsed(!collapsed)}
  >
    <svg
      aria-hidden="true"
      class="size-4 shrink-0 transition-transform motion-reduce:transition-none"
      class:rotate-180={collapsed}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"><path d="M4 4h16v16H4zM9 4v16M16 10l-2 2 2 2" /></svg
    >
    <span
      class="staff-fold transition-opacity motion-reduce:transition-none {collapsed
        ? 'opacity-0'
        : ''}">{collapsed ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen'}</span
    >
  </button>
  <a
    href={STAFF_HOME.href}
    aria-current={current === STAFF_HOME.href ? 'page' : undefined}
    data-flyout="Übersicht"
    data-flyout-icon="M3 11l9-8 9 8M5 10v10h14V10"
    class="staff-home-link mb-3 flex whitespace-nowrap min-h-11 items-center gap-3 px-2 font-semibold text-brand-900 no-underline hover:underline pointer-fine:min-h-9"
  >
    <svg
      aria-hidden="true"
      class="size-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"><path d="M3 11l9-8 9 8M5 10v10h14V10" /></svg
    >
    <span
      class="staff-fold transition-opacity motion-reduce:transition-none {collapsed
        ? 'opacity-0'
        : ''}">Übersicht</span
    >
  </a>
  <StaffModuleSearch
    {groups}
    variant="sidebar"
    {current}
    {ancestors}
    {collapsed}
    onexpand={search}
    bind:input
  />
  <section
    aria-labelledby="staff-sidebar-help"
    class="staff-fold mt-6 w-56 border-t border-neutral-200 px-2 pt-3 pb-2 text-sm transition-opacity motion-reduce:transition-none"
    class:invisible={collapsed}
    class:opacity-0={collapsed}
  >
    <h2 id="staff-sidebar-help" class="m-0 text-sm font-semibold text-brand-900">
      Hilfe &amp; Kontakt
    </h2>
    <ul class="mt-1">
      <li>
        <a
          href="mailto:{HELP_CONTACTS.technik}"
          class="text-link flex min-h-11 flex-col justify-center break-all"
          ><span class="text-xs text-neutral-700">Technische Probleme</span
          >{HELP_CONTACTS.technik}</a
        >
      </li>
      <li>
        <a
          href="mailto:{HELP_CONTACTS.allgemein}"
          class="text-link flex min-h-11 flex-col justify-center break-all"
          ><span class="text-xs text-neutral-700">Alles andere</span>{HELP_CONTACTS.allgemein}</a
        >
      </li>
    </ul>
  </section>
</nav>

<style>
  .staff-home-link[aria-current] {
    background: var(--color-brand-50);
    box-shadow: inset 3px 0 0 var(--color-accent-500);
  }
  /*
   * Folded on the last visit (StaffLayout reads it before the page shows): look folded already
   * while the page loads, until the component takes over
   */
  :global(html[data-staff-sidebar='eingeklappt'] astro-island[ssr]) .staff-sidebar {
    width: 3.5rem;
    padding-right: 0.5rem;
  }
  :global(html[data-staff-sidebar='eingeklappt'] astro-island[ssr] .staff-fold) {
    opacity: 0;
    visibility: hidden;
  }

  /* Slides out of the icon to the right */
  .staff-flyout {
    animation: staff-flyout-in 150ms ease-out;
  }
  .staff-flyout.is-current {
    box-shadow:
      inset 3px 0 0 var(--color-accent-500),
      var(--shadow-lift);
  }
  @keyframes staff-flyout-in {
    from {
      clip-path: inset(0 calc(100% - 2.5rem) 0 0);
    }
    to {
      clip-path: inset(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .staff-flyout {
      animation: none;
    }
  }
</style>
