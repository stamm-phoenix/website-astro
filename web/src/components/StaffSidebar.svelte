<script lang="ts">
  import { onMount } from 'svelte';
  import StaffModuleSearch from './StaffModuleSearch.svelte';
  import { fetchNikolausStatus, nikolausStatusStore } from '../lib/nikolausStatusStore.svelte';
  import { STAFF_HOME, type StaffModule } from '../lib/staffModules';
  import type { StaffModuleGroup } from '../lib/staffSearch';
  import { HELP_CONTACTS } from '../lib/helpContacts';

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
  const wide = (): boolean => window.matchMedia('(min-width: 1280px)').matches;

  onMount(() => {
    // The sidebar only shows on wide screens; phones ask when the sheet opens
    if (wide()) void fetchNikolausStatus();
  });

  function onkeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && wide()) {
      event.preventDefault();
      input?.focus();
      input?.select();
    }
  }
</script>

<svelte:window {onkeydown} />

<nav
  aria-label="Bereiche des Leitendenbereichs"
  class="staff-sidebar hidden w-64 shrink-0 self-start border-r border-neutral-200 pr-4 print:hidden xl:sticky xl:top-24 xl:block xl:max-h-[calc(100dvh-7rem)] xl:overflow-y-auto xl:overscroll-contain"
>
  <a
    href={STAFF_HOME.href}
    aria-current={current === STAFF_HOME.href ? 'page' : undefined}
    class="staff-home-link mb-3 flex min-h-11 items-center gap-3 px-2 font-semibold text-brand-900 no-underline hover:underline pointer-fine:min-h-9"
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
    Übersicht
  </a>
  <StaffModuleSearch {groups} variant="sidebar" {current} {ancestors} bind:input />
  <section
    aria-labelledby="staff-sidebar-help"
    class="mt-6 border-t border-neutral-200 px-2 pt-3 pb-2 text-sm"
  >
    <h2 id="staff-sidebar-help" class="m-0 text-sm font-semibold text-brand-900">
      Hilfe &amp; Kontakt
    </h2>
    <p class="mt-1 text-neutral-700">
      Technik: <a
        href="mailto:{HELP_CONTACTS.technik}"
        class="text-link inline-flex min-h-11 items-center break-all">{HELP_CONTACTS.technik}</a
      >
    </p>
    <p class="mt-1 text-neutral-700">
      Alles andere: <a
        href="mailto:{HELP_CONTACTS.allgemein}"
        class="text-link inline-flex min-h-11 items-center break-all">{HELP_CONTACTS.allgemein}</a
      >
    </p>
  </section>
</nav>

<style>
  .staff-home-link[aria-current] {
    background: var(--color-brand-50);
    box-shadow: inset 3px 0 0 var(--color-accent-500);
  }
</style>
