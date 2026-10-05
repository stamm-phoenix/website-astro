type Theme = 'light' | 'dark';
const STORAGE_KEY = 'phoenix-theme';

/** Persist an explicit choice. Otherwise follow the operating system. */
export function initTheme(): void {
  const preference = matchMedia('(prefers-color-scheme: dark)');
  let choice: Theme | null = null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') choice = saved;
  } catch {
    /* The switch still works for this visit when storage is blocked. */
  }
  const current = (): Theme => choice ?? (preference.matches ? 'dark' : 'light');
  function apply(root: HTMLElement = document.documentElement): void {
    if (choice) root.dataset.theme = choice;
    else delete root.dataset.theme;
  }
  function refresh(): void {
    apply();
    const dark = current() === 'dark';
    document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach((button) => {
      button.hidden = false;
      button.setAttribute('aria-pressed', String(dark));
      button.title = dark ? 'Helles Theme einschalten' : 'Dunkles Theme einschalten';
      button.querySelectorAll<SVGElement>('[data-theme-icon]').forEach((icon) => {
        icon.style.display = icon.dataset.themeIcon === (dark ? 'light' : 'dark') ? '' : 'none';
        icon.removeAttribute('hidden');
      });
    });
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
      meta.removeAttribute('media');
      meta.content = dark ? '#101b26' : '#f8f5ef';
    });
  }
  refresh();
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-theme-toggle]')) return;
    choice = current() === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(STORAGE_KEY, choice);
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
    apply((event as Event & { newDocument: Document }).newDocument.documentElement);
  });
  document.addEventListener('astro:page-load', refresh);
}
