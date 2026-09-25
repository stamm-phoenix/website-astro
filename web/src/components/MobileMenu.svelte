<script lang="ts">
  interface NavItem {
    href: string;
    label: string;
  }

  interface Props {
    nav: NavItem[];
    /** Link to the login-protected area, shown separately below the main items. */
    staffLink?: NavItem;
    currentPath: string;
  }

  let { nav, staffLink, currentPath }: Props = $props();

  let isOpen = $state(false);

  function isCurrent(href: string): boolean {
    return href === '/' ? currentPath === '/' : currentPath.startsWith(href);
  }

  function toggleMenu() {
    isOpen = !isOpen;
  }

  function closeMenu() {
    isOpen = false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && isOpen) {
      closeMenu();
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
<div class="lg:hidden">
  <button
    id="menu-btn"
    type="button"
    aria-controls="mobile-menu"
    aria-expanded={isOpen}
    aria-label={isOpen ? 'Menü schließen' : 'Menü öffnen'}
    class="menu-toggle cursor-pointer inline-flex items-center justify-center rounded-md p-2 text-neutral-700 hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-900"
    onclick={toggleMenu}
  >
    <div class="w-6 h-6 flex flex-col justify-center items-center relative" aria-hidden="true">
      <span class="hamburger-line block absolute w-6 h-0.5 bg-neutral-900" class:open={isOpen}
      ></span>
      <span class="hamburger-line block absolute w-6 h-0.5 bg-neutral-900" class:open={isOpen}
      ></span>
      <span class="hamburger-line block absolute w-6 h-0.5 bg-neutral-900" class:open={isOpen}
      ></span>
    </div>
  </button>
</div>

<!-- Mobile menu panel -->
<div
  id="mobile-menu"
  class="absolute right-3 top-[calc(100%+0.75rem)] z-50 mt-0 w-[calc(100%-1.5rem)] rounded-md border border-neutral-200 bg-white/95 shadow-lift p-2 lg:hidden"
  class:hidden={!isOpen}
>
  <ul class="flex flex-col gap-1">
    {#each nav as item (item.href)}
      <li>
        <a
          href={item.href}
          class="block rounded-md px-3 py-2 text-sm font-semibold no-underline text-neutral-900 hover:bg-[var(--color-brand-50)] focus-visible:bg-[var(--color-brand-50)]"
          aria-current={isCurrent(item.href) ? 'page' : undefined}
          onclick={closeMenu}
        >
          {item.label}
        </a>
      </li>
    {/each}
    {#if staffLink}
      <li class="mt-1 border-t border-neutral-200 pt-1">
        <a
          href={staffLink.href}
          class="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold no-underline text-brand-800 hover:bg-[var(--color-brand-50)] focus-visible:bg-[var(--color-brand-50)]"
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

<style>
  .hamburger-line {
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    transform-origin: center;
  }
  .hamburger-line:nth-child(1) {
    transform: translateY(-0.45rem);
  }
  .hamburger-line:nth-child(2) {
    transform: translateY(0);
  }
  .hamburger-line:nth-child(3) {
    transform: translateY(0.45rem);
  }
  .hamburger-line.open:nth-child(1) {
    transform: rotate(45deg);
  }
  .hamburger-line.open:nth-child(2) {
    opacity: 0;
    transform: scaleX(0);
  }
  .hamburger-line.open:nth-child(3) {
    transform: rotate(-45deg);
  }
</style>
