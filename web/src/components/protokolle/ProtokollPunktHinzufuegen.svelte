<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import Aktionsraster from '../ui/Aktionsraster.svelte';
  import type { AktionKapitel } from './ProtokollAktionDialog.svelte';

  /**
   * The buttons under the agenda: a new item, or a new chapter from an Aktion. Each stands in
   * its own row, because the labels do not fit half the width of a phone.
   */
  interface Props {
    /** The agenda is full. */
    disabled?: boolean;
    onpunkt: () => void;
    onaktion: (art: AktionKapitel) => void;
  }
  let { disabled = false, onpunkt, onaktion }: Props = $props();
</script>

<div class="border-t border-neutral-200 pt-4">
  <Aktionsraster>
    <ActionButton class="col-span-2" onclick={onpunkt} {disabled}>+ Tagesordnungspunkt</ActionButton
    >
    <ActionButton class="col-span-2" onclick={() => onaktion('Planung')} {disabled}>
      + Planungskapitel aus Aktion
    </ActionButton>
    <ActionButton class="col-span-2" onclick={() => onaktion('Reflexion')} {disabled}>
      + Reflexionskapitel aus Aktion
    </ActionButton>
  </Aktionsraster>
</div>
