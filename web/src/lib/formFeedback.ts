/** Announces invalid fields after an attempted save and focuses the first correction. */
export function observeFormFeedback(
  form: HTMLFormElement,
  announce: (count: number) => void
): () => void {
  let attempted = false;
  let awaitingErrors = false;
  let frame = 0;
  let lastCount = 0;

  function update(): void {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!attempted || !form.isConnected) return;
      const fields = [
        ...form.querySelectorAll<HTMLElement>('[aria-invalid="true"], [data-form-error="true"]'),
      ].filter((field) => !field.closest('[inert], [hidden]') && field.getClientRects().length > 0);
      // Several choices can share one correction, e.g. selecting at least one scout group.
      const count = new Set(
        fields.map((field) => field.closest('[data-form-error-group]') ?? field)
      ).size;
      if (count !== lastCount || awaitingErrors) announce(count);
      lastCount = count;
      if (awaitingErrors && fields.length > 0) {
        awaitingErrors = false;
        fields[0].focus({ preventScroll: true });
        fields[0].scrollIntoView({ block: 'nearest' });
      }
    });
  }
  function submitted(): void {
    attempted = true;
    awaitingErrors = true;
    announce(0);
    update();
  }
  const observer = new MutationObserver(update);
  observer.observe(form, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-invalid', 'data-form-error', 'inert'],
  });
  form.addEventListener('submit', submitted);
  return () => {
    form.removeEventListener('submit', submitted);
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}
