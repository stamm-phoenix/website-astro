/**
 * Browser storage key of the compact view of the Leitendenbereich (`kompakt`), per device. Also
 * read by the inline script of StaffLayout, so a page never shows the normal spacing first.
 */
export const DENSITY_KEY = 'phoenix:staff-density:v1';

/**
 * The switch next to the theme toggle. Only pages with the switch (the Leitendenbereich) get
 * `data-density`; global.css derives every spacing from it.
 */
export function initDensity(): void {
  let compact = false;
  try {
    compact = localStorage.getItem(DENSITY_KEY) === 'kompakt';
  } catch {
    /* The switch still works for this visit when storage is blocked. */
  }
  function apply(target: Document = document): void {
    const root = target.documentElement;
    if (compact && target.querySelector('[data-density-toggle]')) root.dataset.density = 'compact';
    else delete root.dataset.density;
  }
  function refresh(): void {
    apply();
    document.querySelectorAll<HTMLButtonElement>('[data-density-toggle]').forEach((button) => {
      button.hidden = false;
      button.setAttribute('aria-pressed', String(compact));
      button.title = 'Kompakte Ansicht';
    });
  }
  refresh();
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-density-toggle]'))
      return;
    compact = !compact;
    try {
      if (compact) localStorage.setItem(DENSITY_KEY, 'kompakt');
      else localStorage.removeItem(DENSITY_KEY);
    } catch {
      /* Keep the choice in memory. */
    }
    refresh();
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== DENSITY_KEY && event.key !== null) return;
    compact = event.newValue === 'kompakt';
    refresh();
  });
  document.addEventListener('astro:before-swap', (event) => {
    apply((event as Event & { newDocument: Document }).newDocument);
  });
  document.addEventListener('astro:page-load', refresh);
}
