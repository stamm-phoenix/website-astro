import { fotoUpload, isActive, uploadTotals } from './fotoUploadState.svelte';

let wakeLock: { release: () => Promise<void> } | null = null;
let speedTimer: ReturnType<typeof setInterval> | null = null;

/** Keeps the phone's screen on while uploading: a locked phone stops the upload. */
export function startKeepAwake(): void {
  void requestWakeLock();
  document.addEventListener('visibilitychange', onVisibilityChange);
  let lastSent = uploadTotals.sent;
  let lastTime = performance.now();
  if (speedTimer) clearInterval(speedTimer);
  speedTimer = setInterval(() => {
    const sent = uploadTotals.sent;
    const now = performance.now();
    const current = Math.max(0, sent - lastSent) / ((now - lastTime) / 1000);
    lastSent = sent;
    lastTime = now;
    const previous = fotoUpload.bytesPerSecond;
    fotoUpload.bytesPerSecond = previous === null ? current : previous * 0.7 + current * 0.3;
  }, 2000);
}

export function stopKeepAwake(): void {
  document.removeEventListener('visibilitychange', onVisibilityChange);
  if (speedTimer) clearInterval(speedTimer);
  speedTimer = null;
  void wakeLock?.release().catch(() => undefined);
  wakeLock = null;
}

function onVisibilityChange(): void {
  // The browser releases the lock when the page is hidden
  if (document.visibilityState === 'visible' && isActive()) void requestWakeLock();
}

async function requestWakeLock(): Promise<void> {
  const nav = navigator as Navigator & {
    wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
  };
  try {
    const lock = (await nav.wakeLock?.request('screen')) ?? null;
    // The upload may have ended while the lock was being granted
    if (lock && !isActive()) void lock.release().catch(() => undefined);
    else if (lock) {
      void wakeLock?.release().catch(() => undefined);
      wakeLock = lock;
    }
  } catch {
    // Not supported or not allowed (e.g. battery saver); the upload works anyway
  }
}
