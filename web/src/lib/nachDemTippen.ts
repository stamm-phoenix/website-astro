/**
 * Work that should wait for the tap that started it. Leaving a field with a tap elsewhere fires
 * `focusout` on pointerdown, before the click on the tapped button; work that blocks the page
 * (a save that disables the buttons while it runs) would swallow that click.
 */

/** Whether a finger or mouse button is down anywhere on the page. */
let gedrueckt = false;

if (typeof window !== 'undefined') {
  const hoch = (): void => {
    // After the click of the same tap
    setTimeout(() => (gedrueckt = false));
  };
  window.addEventListener('pointerdown', () => (gedrueckt = true), true);
  window.addEventListener('pointerup', hoch, true);
  window.addEventListener('pointercancel', hoch, true);
}

/** Runs `arbeit` now, or after the click of the tap that is down. */
export function nachDemTippen(arbeit: () => void): void {
  if (!gedrueckt) return arbeit();
  const fertig = (): void => {
    window.removeEventListener('pointerup', fertig, true);
    window.removeEventListener('pointercancel', fertig, true);
    setTimeout(arbeit);
  };
  window.addEventListener('pointerup', fertig, true);
  window.addEventListener('pointercancel', fertig, true);
}
