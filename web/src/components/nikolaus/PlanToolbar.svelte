<script lang="ts">
  import ReloadAction from '../ui/ReloadAction.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import type { Snippet } from 'svelte';
  interface Props {
    recalculateDisabled?: boolean;
    loading: boolean;
    loadedAt?: number | null;
    saveDisabled: boolean;
    saving: boolean;
    calculating?: boolean;
    /** Paragraphs of the „(i)“ next to „Neu berechnen“: what it does and what stays. */
    info: string[];
    onrecalculate: () => void;
    onreload: () => void;
    onsave: () => void;
    class?: string;
    /** Further actions such as the exports, shown before „Neu laden“. */
    children?: Snippet;
  }
  let {
    recalculateDisabled = false,
    loading,
    loadedAt = null,
    saveDisabled,
    saving,
    calculating = false,
    info,
    onrecalculate,
    onreload,
    onsave,
    class: className = '',
    children,
  }: Props = $props();
</script>

<div class="flex flex-wrap items-center gap-2 {className}">
  <ActionButton variant="primary" type="button" disabled={saveDisabled} onclick={onsave}
    >{saving ? 'Speichert …' : 'Speichern'}</ActionButton
  >
  <ActionButton
    variant="secondary"
    type="button"
    disabled={recalculateDisabled}
    onclick={onrecalculate}>{calculating ? 'Berechne …' : 'Neu berechnen'}</ActionButton
  >
  <InfoHint label="Neu berechnen">
    {#each info as paragraph (paragraph)}
      <p>{paragraph}</p>
    {/each}
  </InfoHint>
  {@render children?.()}
  <ReloadAction type="button" {loadedAt} disabled={loading} onclick={onreload}
    >{loading ? 'Lädt …' : 'Neu laden'}</ReloadAction
  >
</div>
