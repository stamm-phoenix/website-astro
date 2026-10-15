/** Capture the card position before an action removes or replaces its DOM. */
export function taskFocusReturn(id?: number): () => void {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const card = id
    ? document.getElementById(`aufgabe-${id}`)
    : active?.closest<HTMLElement>('li[data-focus-item]');
  const cards = Array.from(document.querySelectorAll<HTMLElement>('li[data-focus-item]'));
  const index = card ? cards.indexOf(card) : -1;
  return () => {
    if (
      active?.isConnected &&
      !active.closest('[data-toast], dialog') &&
      !(active instanceof HTMLButtonElement && active.disabled)
    ) {
      focus(active);
      return;
    }
    const remaining = Array.from(document.querySelectorAll<HTMLElement>('li[data-focus-item]'));
    const current = card?.isConnected
      ? card
      : remaining[Math.min(Math.max(0, index), remaining.length - 1)];
    const control = current?.querySelector<HTMLElement>('button:not(:disabled)');
    if (control) {
      focus(control);
      return;
    }
    document.querySelector<HTMLElement>('[data-focus-fallback]')?.focus({ preventScroll: true });
  };
}

function focus(control: HTMLElement): void {
  control.focus({ preventScroll: true });
  requestAnimationFrame(() => {
    const card = control.closest('li[data-focus-item]');
    const toast = document.querySelector('[data-toast] > div');
    if (!card || !toast) return;
    const rect = card.getBoundingClientRect();
    const notice = toast.getBoundingClientRect();
    if (rect.bottom > notice.top && rect.top < notice.bottom)
      card.scrollIntoView({ block: 'center', behavior: 'instant' });
  });
}
