/**
 * Work that should wait for the tap that started it. Leaving a field with a tap elsewhere moves
 * the focus before the click on the tapped button arrives (on pointerdown, on touch screens
 * after the finger is lifted); work that blocks the page, like a save that disables the buttons
 * while it runs, would swallow that click.
 */

/** How long a tap may take from lifting the finger to its click; longer is no tap (scrolling). */
const KLICK_MS = 600;

/** A finger or mouse button is down. */
let unten = false;
/** When it was last lifted. */
let hochZeit = -Infinity;
/** Whether that tap brought its click already. */
let geklickt = true;

if (typeof window !== 'undefined') {
  const hoch = (): void => {
    unten = false;
    hochZeit = performance.now();
  };
  window.addEventListener(
    'pointerdown',
    () => {
      unten = true;
      geklickt = false;
    },
    true
  );
  window.addEventListener('pointerup', hoch, true);
  window.addEventListener('pointercancel', hoch, true);
  window.addEventListener('click', () => (geklickt = true), true);
}

/** Runs `arbeit` now, or after the click of the tap that is under way. */
export function nachDemTippen(arbeit: () => void): void {
  if (!unten && (geklickt || performance.now() - hochZeit > KLICK_MS)) return arbeit();
  let erledigt = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const los = (): void => {
    if (erledigt) return;
    erledigt = true;
    clearTimeout(timer);
    window.removeEventListener('click', los, true);
    window.removeEventListener('pointerup', hoch, true);
    window.removeEventListener('pointercancel', hoch, true);
    // After the handlers of the click
    setTimeout(arbeit);
  };
  const hoch = (): void => {
    clearTimeout(timer);
    timer = setTimeout(los, KLICK_MS);
  };
  window.addEventListener('click', los, true);
  if (unten) {
    window.addEventListener('pointerup', hoch, true);
    window.addEventListener('pointercancel', hoch, true);
  } else timer = setTimeout(los, KLICK_MS);
}
