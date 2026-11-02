/** From this width the head of a Planung (name up to the tabs) stays below the site header. */
const DESKTOP = '(min-width: 64rem)';

/**
 * Svelte action for the head of a Planung: sticks below the site header on desktops and lets
 * elements scrolled into view (focus, jumps to a dish) end below both.
 */
export function kopfLeiste(kopf: HTMLElement): { destroy: () => void } {
  const header = document.querySelector<HTMLElement>('body > header');
  const html = document.documentElement;
  const breit = window.matchMedia(DESKTOP);
  const messen = (): void => {
    const oben = header?.offsetHeight ?? 0;
    const unten = breit.matches ? oben + kopf.offsetHeight : 0;
    kopf.style.setProperty('--kopf-oben', `${oben}px`);
    // Other sticky parts of the Planung stay below the head
    html.style.setProperty('--essen-kopf-unten', `${unten}px`);
    html.style.scrollPaddingTop = unten ? `${unten + 8}px` : '';
  };
  const beobachter = new ResizeObserver(messen);
  if (header) beobachter.observe(header);
  beobachter.observe(kopf);
  breit.addEventListener('change', messen);
  messen();
  return {
    destroy: () => {
      beobachter.disconnect();
      breit.removeEventListener('change', messen);
      html.style.scrollPaddingTop = '';
      html.style.removeProperty('--essen-kopf-unten');
    },
  };
}
