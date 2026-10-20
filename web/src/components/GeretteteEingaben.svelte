<script lang="ts">
  import ActionButton from './ui/ActionButton.svelte';
  import { confirmAction } from '../lib/confirm';
  import { forgetRescue, readRescue } from '../lib/geretteteEingaben';

  let fields = $state(readRescue(Date.now()));
  let copied = $state<number | null>(null);
  let failed = $state<number | null>(null);

  async function copy(index: number, value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      copied = index;
      failed = null;
    } catch {
      failed = index;
      copied = null;
    }
  }

  async function hide(): Promise<void> {
    const confirmed = await confirmAction({
      title: 'Gerettete Eingaben löschen?',
      message: 'Die Eingaben von vor der neuen Anmeldung löschen? Danach sind sie weg.',
      confirmLabel: 'Eingaben löschen',
    });
    if (!confirmed) return;
    forgetRescue();
    fields = null;
  }
</script>

{#if fields}
  <section aria-labelledby="gerettete-eingaben" class="surface mb-4 space-y-3 p-4">
    <h2 id="gerettete-eingaben" class="font-serif text-lg text-brand-900">
      Deine Eingaben vor der neuen Anmeldung
    </h2>
    <p class="text-sm text-neutral-700">
      Öffne das Formular wieder, kopier die Werte zurück und speichere. Sie bleiben nur in diesem
      Fenster und höchstens eine Stunde.
    </p>
    <ul class="space-y-3">
      {#each fields as field, index (index)}
        <li class="border-t border-neutral-200 pt-3">
          <p class="text-sm font-semibold text-neutral-800">{field.label}</p>
          <p class="whitespace-pre-wrap text-neutral-800">{field.value}</p>
          <div class="mt-1 flex flex-wrap items-center gap-2">
            <ActionButton onclick={() => copy(index, field.value)}>
              {field.label} kopieren
            </ActionButton>
            <span role="status" class="text-sm">
              {#if copied === index}<span class="text-success">Kopiert.</span>
              {:else if failed === index}<span class="text-danger"
                  >Kopieren ging nicht, bitte von Hand abschreiben.</span
                >{/if}
            </span>
          </div>
        </li>
      {/each}
    </ul>
    <ActionButton onclick={hide}>Gerettete Eingaben löschen</ActionButton>
  </section>
{/if}
