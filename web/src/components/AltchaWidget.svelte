<script lang="ts">
  import type {} from 'altcha/types/svelte';
  import type { WidgetMethods } from 'altcha/types';

  /**
   * Self-hosted ALTCHA proof of work for the public forms (no cookies, no third party).
   * The parent calls `solve()` before submitting and `reset()` after each attempt, because
   * the API accepts every solved challenge only once.
   */

  let widget = $state<(HTMLElement & WidgetMethods) | null>(null);
  let payload: string | null = null;

  $effect(() => {
    // The widget touches the DOM when it loads, so it is only imported in the browser.
    void Promise.all([import('altcha'), import('altcha/i18n/de')]);
  });

  /** Keeps the widget payload only while its state is verified. */
  function onStateChange(event: CustomEvent<{ payload?: string; state: string }>): void {
    payload = event.detail.state === 'verified' ? (event.detail.payload ?? null) : null;
  }

  /**
   * Returns the solved proof of work; starts it if the visitor submits before it finished.
   * Returns null if the widget is absent, verification throws, or no payload is returned.
   */
  export async function solve(): Promise<string | null> {
    if (payload) return payload;
    if (!widget) return null;
    try {
      return (await widget.verify())?.payload ?? null;
    } catch {
      return null;
    }
  }

  /** Clears the used proof, so the next submission solves a new challenge. */
  export function reset(): void {
    payload = null;
    widget?.reset();
  }
</script>

<altcha-widget
  bind:this={widget}
  challenge="/api/altcha/challenge"
  auto="onfocus"
  language="de"
  onstatechange={onStateChange}
></altcha-widget>

<style>
  altcha-widget {
    display: block;
    /* Theme tokens, so the widget follows the light and dark theme. */
    --altcha-color-base: var(--color-field);
    --altcha-color-base-content: var(--color-neutral-900);
    --altcha-color-neutral: var(--field-border);
    --altcha-color-primary: var(--color-action);
    --altcha-color-primary-content: var(--color-on-action);
    --altcha-color-error: var(--color-danger);
    --altcha-color-success: var(--color-success);
    --altcha-border-radius: var(--radius-sm);
    --altcha-checkbox-border-radius: var(--radius-sm);
    --altcha-input-border-radius: var(--radius-sm);
    --altcha-max-width: 100%;
  }
</style>
