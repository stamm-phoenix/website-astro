<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    loadStaffSettings,
    saveStaffSetting,
    settingsStore,
  } from '../lib/staffSettingsStore.svelte';
  import StaffModuleSearch from './StaffModuleSearch.svelte';
  import { fetchNikolausStatus, nikolausStatusStore } from '../lib/nikolausStatusStore.svelte';
  import { STAFF_HOME, type StaffModule } from '../lib/staffModules';
  import type { StaffModuleGroup } from '../lib/staffSearch';
  import { HELP_CONTACTS } from '../lib/helpContacts';
  import { errorMessage } from '../lib/api';
  import Toast from './ui/Toast.svelte';

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

  /** Reduced to its icons; the choice is saved per person (`staff-settings-model.ts`). */
  /**
   * The choice shown but not confirmed as saved; it wins over answers to other settings, which
   * still hold the previous one, and is what „Erneut speichern“ saves.
   */
  let choice = $state<boolean | null>(null);
  const collapsed = $derived(choice ?? settingsStore.settings.seitenleiste === 'eingeklappt');
  /** Width changes animate only once the saved choice is known, not while the page loads. */
  let animate = $state(false);

  onMount(() => {
    // The sidebar only shows on wide screens: load what it needs once the window is wide
    const media = window.matchMedia(WIDE);
    let started = false;
    function start(): void {
      if (started || !media.matches) return;
      started = true;
      void fetchNikolausStatus();
      void loadStaffSettings().finally(() => requestAnimationFrame(() => (animate = true)));
    }
    start();
    media.addEventListener('change', start);
    return () => media.removeEventListener('change', start);
  });

  /** Why the last choice was not saved; it stays shown until the next visit. */
  let saveError = $state<string | null>(null);

  function setCollapsed(value: boolean): void {
    choice = value;
    saveError = null;
    saveStaffSetting('seitenleiste', value ? 'eingeklappt' : 'ausgeklappt').then(
      () => {
        // The settings hold it now; a newer choice waits for its own answer
        if (choice !== value) return;
        choice = null;
        saveError = null;
      },
      (error: unknown) => {
        // A newer choice brings its own result
        if (choice !== value) return;
        saveError = errorMessage(
          error,
          'Die Seitenleiste bleibt so, aber deine Wahl wurde nicht gespeichert; beim nächsten Öffnen erscheint sie wie vorher. Prüfe deine Internetverbindung und klick auf „Erneut speichern“.'
        );
      }
    );
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
  let flyout = $state<Flyout | null>(null);
  let nav = $state<HTMLElement>();

  function showFlyout(event: Event): void {
    const target = event.target;
    const item =
      collapsed && target instanceof Element ? target.closest<HTMLElement>('[data-flyout]') : null;
    if (!item || !nav?.contains(item)) {
      flyout = null;
      return;
    }
    const rect = item.getBoundingClientRect();
    flyout = {
      top: rect.top,
      left: rect.left,
      height: rect.height,
      label: item.dataset.flyout ?? '',
      icon: item.dataset.flyoutIcon ?? '',
      current: item.hasAttribute('aria-current'),
    };
  }
  function hideFlyout(): void {
    flyout = null;
  }
  $effect(() => {
    if (!collapsed) flyout = null;
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

<svelte:window {onkeydown} />

<Toast
  message={saveError}
  kind="error"
  actionLabel="Erneut speichern"
  duration={0}
  onaction={() => setCollapsed(collapsed)}
  onclose={() => (saveError = null)}
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
  onpointerover={showFlyout}
  onpointerleave={hideFlyout}
  onfocusin={showFlyout}
  onfocusout={hideFlyout}
  onscroll={hideFlyout}
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
    <span class="transition-opacity motion-reduce:transition-none {collapsed ? 'opacity-0' : ''}"
      >{collapsed ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen'}</span
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
    <span class="transition-opacity motion-reduce:transition-none {collapsed ? 'opacity-0' : ''}"
      >Übersicht</span
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
    class="mt-6 w-56 border-t border-neutral-200 px-2 pt-3 pb-2 text-sm transition-opacity motion-reduce:transition-none"
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
