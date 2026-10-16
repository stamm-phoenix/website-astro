<script lang="ts">
  import type { BelegCheck } from '../../lib/types';
  interface Props {
    check: BelegCheck | null;
    warnings?: string[];
    isNew?: boolean;
  }
  let { check, warnings = [], isNew = false }: Props = $props();
  const needsCheck = $derived(warnings.length > 0 || !check?.ok || !!check?.restrictedItems.length);
</script>

{#if check || warnings.length}
  <div
    role="note"
    class="space-y-2 border-l-2 p-3 text-sm {needsCheck
      ? 'border-warning bg-warning-soft text-warning'
      : 'border-success bg-success-soft text-success'}"
  >
    <p class="font-semibold">
      Automatische Prüfung: {check?.ok && warnings.length === 0
        ? 'Der Beleg ist vollständig und lesbar.'
        : check && !check.isReceipt
          ? 'Das Foto zeigt möglicherweise keinen Beleg.'
          : 'Bitte prüfe die Hinweise zum Foto.'}
    </p>
    {#if warnings.length}
      <ul class="list-disc space-y-1 pl-4">
        {#each warnings as warning (warning)}<li>{warning}</li>{/each}
      </ul>
    {/if}
    {#if check && !check.ok}
      <ul class="list-disc space-y-1 pl-4">
        {#each check.issues as issue (issue)}<li>{issue}</li>{:else}
          {#if !check.complete}<li>Der Beleg ist nicht vollständig zu sehen.</li>{/if}
          {#if !check.readable}<li>Der Beleg ist nicht gut lesbar.</li>{/if}
        {/each}
      </ul>
    {/if}
    {#if check?.ok && warnings.length}
      <p>
        Die automatische Prüfung konnte die Angaben lesen. Wenn du selbst alles gut lesen kannst,
        kannst du den Beleg so einreichen.
      </p>
    {:else if isNew && needsCheck}
      <p>
        Prüfe, ob alle Angaben gut lesbar sind. Falls nicht, fotografiere den Beleg noch einmal.
        Einreichen geht trotzdem; die Kasse prüft jeden Beleg.
      </p>
    {/if}
    {#if check?.restrictedItems.length}
      <p class="font-semibold">Diese Positionen prüft die Kasse:</p>
      <ul class="list-disc pl-4">
        {#each check.restrictedItems as item, index (index)}<li>{item}</li>{/each}
      </ul>
      {#if isNew}<p>
          Rechne nur die erlaubten Positionen ab und erkläre das in der Bemerkung.
        </p>{/if}
    {/if}
  </div>
{/if}
