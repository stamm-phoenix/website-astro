<script lang="ts">
  import ReloadAction from '../ui/ReloadAction.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  interface Props {
    recalculateDisabled?: boolean;
    printDisabled?: boolean;
    loading: boolean;
    saveDisabled: boolean;
    saving: boolean;
    calculating?: boolean;
    title: string;
    onrecalculate: () => void;
    onreload: () => void;
    onsave: () => void;
    class?: string;
  }
  let {
    recalculateDisabled = false,
    printDisabled = false,
    loading,
    saveDisabled,
    saving,
    calculating = false,
    title,
    onrecalculate,
    onreload,
    onsave,
    class: className = '',
  }: Props = $props();
</script>

<div class="flex flex-wrap gap-2 {className}">
  <ActionButton variant="primary" type="button" disabled={saveDisabled} onclick={onsave}
    >{saving ? 'Speichert …' : 'Speichern'}</ActionButton
  >
  <ActionButton
    variant="secondary"
    type="button"
    disabled={recalculateDisabled}
    onclick={onrecalculate}
    {title}>{calculating ? 'Berechne …' : 'Neu berechnen'}</ActionButton
  >
  <ActionButton
    variant="secondary"
    type="button"
    disabled={printDisabled}
    onclick={() => window.print()}>Drucken</ActionButton
  >
  <ReloadAction type="button" disabled={loading} onclick={onreload}
    >{loading ? 'Lädt …' : 'Neu laden'}</ReloadAction
  >
</div>
