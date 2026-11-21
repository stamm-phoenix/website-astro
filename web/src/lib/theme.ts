type Theme = 'light' | 'dark';
const STORAGE_KEY = 'phoenix-theme';

/** Persist a choice that differs from the operating system. Otherwise follow the system. */
export function initTheme(): void {
  const preference = matchMedia('(prefers-color-scheme: dark)');
  let choice: Theme | null = null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') choice = saved;
  } catch {
    /* The switch still works for this visit when storage is blocked. */
  }
  const system = (): Theme => (preference.matches ? 'dark' : 'light');
  const current = (): Theme => choice ?? system();
  function apply(page: Document = document): void {
    if (choice) page.documentElement.dataset.theme = choice;
    else delete page.documentElement.dataset.theme;
    page
      .querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
      ?.setAttribute('content', choice ?? 'light dark');
  }
  function refresh(): void {
    apply();
    const dark = current() === 'dark';
    document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach((button) => {
      button.hidden = false;
      button.setAttribute('aria-pressed', String(dark));
      button.title = 'Dunkles Theme';
    });
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
      meta.removeAttribute('media');
      meta.content = dark ? '#181614' : '#f8f5ef';
    });
  }
  refresh();
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-theme-toggle]')) return;
    const next: Theme = current() === 'dark' ? 'light' : 'dark';
    // Switching back to what the system shows ends the override, so the page follows it again.
    choice = next === system() ? null : next;
    try {
      if (choice) localStorage.setItem(STORAGE_KEY, choice);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* Keep the choice in memory. */
    }
    refresh();
  });
  preference.addEventListener('change', () => {
    if (!choice) refresh();
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    choice = event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : null;
    refresh();
  });
  document.addEventListener('astro:before-swap', (event) => {
    apply((event as Event & { newDocument: Document }).newDocument);
  });
  document.addEventListener('astro:page-load', refresh);
}
