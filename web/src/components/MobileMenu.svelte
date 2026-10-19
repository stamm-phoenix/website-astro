<script lang="ts">
  import MenuToggle from './ui/MenuToggle.svelte';

  interface NavItem {
    href: string;
    label: string;
  }

  interface Props {
    nav: NavItem[];
    secondaryNav: NavItem[];
    /** Link to the login-protected area, shown separately below the main items. */
    staffLink?: NavItem;
    currentPath: string;
  }

  let { nav, secondaryNav, staffLink, currentPath }: Props = $props();

  let isOpen = $state(false);

  function isCurrent(href: string): boolean {
    return href === '/' ? currentPath === '/' : currentPath.startsWith(href);
  }

  function toggleMenu() {
    isOpen = !isOpen;
  }

  function closeMenu() {
    isOpen = false;
    document.querySelectorAll<HTMLDetailsElement>('#mobile-menu details').forEach((group) => {
      group.open = false;
    });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && isOpen) {
      closeMenu();
      document.getElementById('menu-btn')?.focus();
    }
  }

  function handleOutsideClick(event: MouseEvent) {
    const target = event.target as Node;
    const menuButton = document.getElementById('menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');

    if (
      isOpen &&
      menuButton &&
      mobileMenu &&
      !menuButton.contains(target) &&
      !mobileMenu.contains(target)
    ) {
      closeMenu();
    }
  }

  $effect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeydown);
      document.addEventListener('click', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('keydown', handleKeydown);
      document.removeEventListener('click', handleOutsideClick);
    };
  });
</script>

<!-- Mobile: hamburger -->
<div class="2xl:hidden">
  <MenuToggle id="menu-btn" open={isOpen} controls="mobile-menu" onclick={toggleMenu} />
</div>

<!-- Mobile menu panel -->
<div
  id="mobile-menu"
  class="menu-panel absolute right-3 top-[calc(100%+0.75rem)] z-50 mt-0 max-h-[calc(100dvh-9rem)] w-[calc(100%-1.5rem)] overflow-y-auto overscroll-contain rounded-sm border border-neutral-300 bg-surface px-4 py-1 shadow-soft 2xl:hidden"
  data-open={isOpen}
  inert={!isOpen}
>
  <ul class="flex flex-col divide-y divide-neutral-200">
    {#each nav as item (item.href)}
      <li>
        <a
          href={item.href}
          class="block py-3 text-sm font-semibold text-neutral-900 underline decoration-transparent decoration-2 underline-offset-[0.35em] hover:text-brand-900 hover:decoration-neutral-300 active:text-brand-700 aria-[current=page]:text-brand-900 aria-[current=page]:decoration-[var(--color-accent-500)]"
          aria-current={isCurrent(item.href) ? 'page' : undefined}
          onclick={closeMenu}
        >
          {item.label}
        </a>
      </li>
    {/each}
    <li>
      <details>
        <summary class="min-h-11 cursor-pointer py-3 text-sm font-semibold text-brand-900"
          >Stamm & Hilfe</summary
        >
        <ul class="border-l-2 border-neutral-200 pl-4">
          {#each secondaryNav as item (item.href)}
            <li>
              <a
                href={item.href}
                class="block py-3 text-sm text-brand-900"
                aria-current={isCurrent(item.href) ? 'page' : undefined}
                onclick={closeMenu}>{item.label}</a
              >
            </li>
          {/each}
        </ul>
      </details>
    </li>
    {#if staffLink}
      <li class="border-t-neutral-300!">
        <a
          href={staffLink.href}
          class="flex items-center gap-2 py-3 text-sm font-semibold text-link underline decoration-transparent decoration-2 underline-offset-[0.35em] hover:decoration-neutral-300 active:text-brand-700 aria-[current=page]:decoration-[var(--color-accent-500)]"
          aria-current={isCurrent(staffLink.href) ? 'page' : undefined}
          onclick={closeMenu}
        >
          <svg
            aria-hidden="true"
            class="size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="4" y="11" width="16" height="10" rx="2"></rect>
            <path d="M8 11V7a4 4 0 0 1 8 0v4"></path>
          </svg>
          {staffLink.label}
        </a>
      </li>
    {/if}
  </ul>
</div>
