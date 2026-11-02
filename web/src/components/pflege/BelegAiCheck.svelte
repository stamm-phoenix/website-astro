<script lang="ts">
  import type { BelegCheck } from '../../lib/types';
  interface Props {
    check: BelegCheck | null;
    warnings?: string[];
    isNew?: boolean;
    /** Texts for receipts the Kasse checks; the Essensplanung keeps its receipts to itself. */
    kasse?: boolean;
  }
  let { check, warnings = [], isNew = false, kasse = true }: Props = $props();
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
      {check?.ok && warnings.length === 0
        ? 'Beleg geprüft: vollständig und lesbar.'
        : check && !check.isReceipt
          ? 'Das Foto zeigt möglicherweise keinen Beleg.'
          : 'Foto prüfen:'}
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
        {kasse
          ? 'Die automatische Prüfung konnte die Angaben lesen. Kannst du sie auch lesen, reich ihn so ein.'
          : 'Die automatische Prüfung konnte die Angaben lesen. Kannst du sie auch lesen, speichere ihn so.'}
      </p>
    {:else if isNew && needsCheck}
      <p>{kasse ? 'Einreichen geht trotzdem.' : 'Speichern geht trotzdem.'}</p>
    {/if}
    {#if check?.restrictedItems.length}
      <p class="font-semibold">
        {kasse ? 'Diese Positionen prüft die Kasse:' : 'Nicht jugendfreie Positionen:'}
      </p>
      <ul class="list-disc pl-4">
        {#each check.restrictedItems as item, index (index)}<li>{item}</li>{/each}
      </ul>
      {#if isNew && kasse}
        <p>Trag nur den erlaubten Betrag ein und erkläre das in der Bemerkung.</p>
      {/if}
    {/if}
  </div>
{/if}
