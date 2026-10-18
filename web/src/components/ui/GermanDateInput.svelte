<script lang="ts">
  import { parseGermanDate } from '../../lib/germanDate';
  import { onMount } from 'svelte';
  interface Props {
    id: string;
    name?: string;
    value: string;
    onchange: (value: string) => void;
    required?: boolean;
    'aria-invalid'?: 'true';
    'aria-describedby'?: string;
  }
  let {
    id,
    name,
    value,
    onchange,
    required = false,
    'aria-invalid': invalid,
    'aria-describedby': describedBy,
  }: Props = $props();
  let input = $state<HTMLInputElement | null>(null);
  let picker = $state<HTMLInputElement | null>(null);
  let raw = $derived(value ? value.split('-').reverse().join('.') : '');
  let error = $state(false);
  let fallback = $state(false);
  function commit(): boolean {
    const next = parseGermanDate(raw, required);
    error = next === null;
    if (next !== null) onchange(next);
    return next !== null;
  }
  onMount(() => {
    const form = input?.form;
    function validate(event: SubmitEvent): void {
      if (commit()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      input?.focus();
    }
    form?.addEventListener('submit', validate, true);
    return () => form?.removeEventListener('submit', validate, true);
  });
</script>

<div class="relative">
  <input
    {id}
    {name}
    bind:this={input}
    class="form-input pr-14"
    lang="de-DE"
    inputmode="numeric"
    placeholder="TT.MM.JJJJ"
    maxlength="10"
    {required}
    bind:value={raw}
    aria-invalid={error ? 'true' : invalid}
    aria-describedby={[describedBy, error ? `${id}-format-error` : ''].filter(Boolean).join(' ') ||
      undefined}
    oninput={() => {
      error = false;
      const next = parseGermanDate(raw, required);
      if (next !== null) onchange(next);
    }}
    onblur={commit}
  />
  <button
    type="button"
    class="absolute right-0 top-0 flex min-h-11 min-w-11 items-center justify-center text-neutral-700"
    aria-label="Kalender öffnen"
    onclick={() => {
      try {
        picker?.showPicker();
      } catch {
        fallback = true;
      }
    }}
    ><svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      ><path
        d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
      /></svg
    ></button
  >
  <input
    bind:this={picker}
    type="date"
    lang="de-DE"
    {value}
    class={fallback ? 'form-input mt-2' : 'pointer-events-none absolute size-px opacity-0'}
    tabindex={fallback ? 0 : -1}
    aria-hidden={!fallback}
    aria-label="Datum im Kalender wählen"
    onchange={(event) => {
      onchange(event.currentTarget.value);
      error = false;
    }}
  />
</div>
{#if error}<p id="{id}-format-error" role="alert" class="mt-1 text-sm text-danger">
    Bitte ein gültiges Datum als TT.MM.JJJJ eingeben.
  </p>{/if}
