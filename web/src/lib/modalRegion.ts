/** Makes a custom modal's ancestors' siblings inert, preserving their previous state. */
export function isolateModal(region: HTMLElement): () => void {
  const changed: HTMLElement[] = [];
  let branch: HTMLElement | null = region;
  while (branch && branch !== document.body) {
    for (const sibling of branch.parentElement?.children ?? []) {
      if (sibling instanceof HTMLElement && sibling !== branch && !sibling.inert) {
        sibling.inert = true;
        changed.push(sibling);
      }
    }
    branch = branch.parentElement;
  }
  function trap(event: KeyboardEvent): void {
    // Native dialogs opened from this region manage their own top-layer focus.
    if (event.key !== 'Tab' || document.querySelector('dialog[open]')) return;
    const focusable = [
      ...region.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]'),
    ].filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(':disabled') &&
        !element.closest('[inert], [hidden], [aria-hidden="true"]') &&
        element.getClientRects().length > 0
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  region.addEventListener('keydown', trap);
  return () => {
    region.removeEventListener('keydown', trap);
    for (const element of changed) element.inert = false;
  };
}
