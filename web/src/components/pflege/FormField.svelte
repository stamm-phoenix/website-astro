<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** Id of the input; used for the label and the ids of hint and error. */
    id: string;
    label: string;
    error?: string;
    hint?: string;
    optional?: boolean;
    class?: string;
    /** Receives the attributes to spread onto the input. */
    children: Snippet<
      [{ id: string; 'aria-invalid': 'true' | undefined; 'aria-describedby': string | undefined }]
    >;
  }

  let {
    id,
    label,
    error,
    hint,
    optional = false,
    class: className = '',
    children,
  }: Props = $props();

  const describedBy = $derived(
    [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined
  );
</script>

<div class={className}>
  <label for={id} class="form-label">
    {label}
    {#if optional}<span class="font-normal text-neutral-700">(optional)</span>{/if}
  </label>
  {@render children({
    id,
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': describedBy,
  })}
  {#if hint}
    <p id="{id}-hint" class="mt-1 text-xs text-neutral-700">{hint}</p>
  {/if}
  {#if error}
    <p id="{id}-error" class="mt-1 text-sm text-[var(--color-dpsg-red)]">{error}</p>
  {/if}
</div>
