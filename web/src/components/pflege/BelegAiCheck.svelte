<script lang="ts">
  import type { BelegCheck } from '../../lib/types';
  interface Props {
    check: BelegCheck;
    isNew?: boolean;
  }
  let { check, isNew = false }: Props = $props();
</script>

{#if check.ok}
  <p role="note" class="rounded-md bg-success/5 p-3 text-xs text-success">
    KI-Vorprüfung: Der Beleg ist vollständig und gut lesbar.
  </p>
{:else}
  <div role="note" class="space-y-1 rounded-md bg-warning-soft p-3 text-xs text-warning">
    <p class="font-semibold">
      KI-Vorprüfung: {!check.isReceipt
        ? 'Das Foto zeigt anscheinend keinen Beleg.'
        : 'Das Foto ist so wohl nicht archivtauglich.'}
    </p>
    <ul class="list-disc space-y-0.5 pl-4">
      {#each check.issues as issue (issue)}
        <li>{issue}</li>
      {:else}
        {#if !check.complete}<li>Der Beleg ist nicht vollständig zu sehen.</li>{/if}
        {#if !check.readable}<li>Der Beleg ist nicht gut lesbar.</li>{/if}
      {/each}
    </ul>
    {#if isNew}
      <p>
        Am besten neu fotografieren. Einreichen geht trotzdem, das Kassenteam prüft jeden Beleg.
      </p>
    {/if}
  </div>
{/if}
{#if check.restrictedItems.length > 0}
  <div role="note" class="space-y-1 rounded-md bg-danger/5 p-3 text-xs text-danger">
    <p class="font-semibold">
      KI-Vorprüfung: Auf dem Beleg stehen anscheinend Dinge, die in der Jugendarbeit nicht
      abgerechnet werden dürfen:
    </p>
    <ul class="list-disc space-y-0.5 pl-4">
      {#each check.restrictedItems as item, index (index)}
        <li>{item}</li>
      {/each}
    </ul>
    {#if isNew}
      <p>
        Bitte nur die erlaubten Positionen abrechnen und das in der Bemerkung erklären. Die Kasse
        prüft das.
      </p>
    {/if}
  </div>
{/if}
