<script lang="ts">
  import ActionButton from './ui/ActionButton.svelte';
  import { confirmAction } from '../lib/confirm';
  import { forgetRescue, RESCUE_EVENT, rescuedDialog } from '../lib/geretteteEingaben';

  /** Title of the form whose input waits since a new login in the iPhone app. */
  let dialog = $state(rescuedDialog(Date.now()));

  $effect(() => {
    const update = (): void => {
      dialog = rescuedDialog(Date.now());
    };
    window.addEventListener(RESCUE_EVENT, update);
    return () => window.removeEventListener(RESCUE_EVENT, update);
  });

  async function forget(): Promise<void> {
    const confirmed = await confirmAction({
      title: 'Gesicherte Eingaben löschen?',
      message: `Die Eingaben für „${dialog}“ von vor der neuen Anmeldung löschen? Danach sind sie weg.`,
      confirmLabel: 'Eingaben löschen',
    });
    if (confirmed) forgetRescue();
  }
</script>

{#if dialog}
  <section aria-labelledby="gerettete-eingaben" class="surface mb-4 space-y-2 p-4">
    <h2 id="gerettete-eingaben" class="font-serif text-lg text-brand-900">
      Deine Eingaben sind gesichert
    </h2>
    <p class="text-neutral-800">
      Öffne „{dialog}“ noch einmal. Das Formular setzt deine Eingaben von vor der neuen Anmeldung
      dann selbst ein. Sie bleiben höchstens eine Stunde in diesem Fenster.
    </p>
    <ActionButton onclick={forget}>Gesicherte Eingaben löschen</ActionButton>
  </section>
{/if}
