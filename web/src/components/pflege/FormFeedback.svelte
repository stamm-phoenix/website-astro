<script lang="ts">
  import { observeFormFeedback } from '../../lib/formFeedback';

  interface Props {
    form: HTMLFormElement | null;
  }
  let { form }: Props = $props();
  let count = $state(0);
  $effect(() => {
    if (form) return observeFormFeedback(form, (value) => (count = value));
  });
</script>

<div
  role={count > 0 ? 'alert' : undefined}
  aria-live="assertive"
  aria-atomic="true"
  class="text-sm text-danger"
>
  {#if count > 0}
    <p class="mb-3">
      {count === 1
        ? 'Bitte prüfe das markierte Feld.'
        : `Bitte prüfe die ${count} markierten Felder.`}
    </p>
  {/if}
</div>
