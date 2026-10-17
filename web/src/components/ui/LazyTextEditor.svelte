<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import type TextEditor from './TextEditor.svelte';

  /**
   * `TextEditor` loaded only when it is shown, for dialogs inside large islands (Nikolaus,
   * Sammelbestellungen): the editor is a chunk of its own that most visits never need.
   */
  type Props = ComponentProps<typeof TextEditor>;
  let { value = $bindable(), ...rest }: Props = $props();
</script>

{#await import('./TextEditor.svelte')}
  <div class="skeleton-element mt-1 h-32 rounded-md" role="status" aria-live="polite">
    <span class="sr-only">Textfeld wird geladen …</span>
  </div>
{:then editor}
  <editor.default bind:value {...rest} />
{:catch}
  <p class="mt-1 text-sm text-danger" role="alert">
    Das Textfeld konnte nicht geladen werden. Lade die Seite neu und öffne den Dialog noch einmal.
  </p>
{/await}
