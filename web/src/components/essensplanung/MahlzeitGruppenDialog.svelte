<script lang="ts">
  import ModalDialog from '../ui/ModalDialog.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import type { PlanKontext } from './planKontext';

  /**
   * Which groups eat at a meal. Each box is saved at once; a group left out there does not count
   * for the dishes of the meal.
   */

  interface Props {
    kontext: PlanKontext;
    /** The meal; null: closed. */
    mahlzeitId: number | null;
    onclose: () => void;
  }
  let { kontext, mahlzeitId, onclose }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const mahlzeit = $derived(
    mahlzeitId === null
      ? undefined
      : ansicht.tage.flatMap((tag) => tag.mahlzeiten).find((m) => m.id === mahlzeitId)
  );
  /** Why the last change failed, shown in the dialog, which covers the page's notice. */
  let fehler = $state<string | null>(null);

  async function setze(box: HTMLInputElement, gruppeId: number, name: string): Promise<void> {
    if (!mahlzeit) return;
    const isst = box.checked;
    fehler = null;
    const id = mahlzeit.id;
    const ok = await kontext.aendern(
      () => kontext.api.senden('PUT', `/mahlzeiten/${id}/gruppen`, { gruppeId, isst }),
      `${name} ${isst ? 'isst' : 'isst nicht'} bei ${mahlzeit.kennung} mit.`
    );
    if (ok) return;
    fehler = kontext.fehler;
    // The box shows what is saved again
    box.checked = !mahlzeit?.ohneGruppen.includes(gruppeId);
  }
</script>

<ModalDialog
  open={mahlzeitId !== null}
  title={mahlzeit ? `Wer isst bei ${mahlzeit.kennung} ${mahlzeit.name}?` : 'Mahlzeit gelöscht'}
  closeDisabled={kontext.busy}
  {onclose}
>
  <div class="min-h-0 space-y-3 overflow-y-auto px-5 py-4">
    {#if fehler}<p class="text-sm text-danger" role="alert">{fehler}</p>{/if}
    {#if mahlzeit}
      <fieldset>
        <legend class="sr-only">Gruppen</legend>
        {#each ansicht.gruppen as gruppe (gruppe.id)}
          <label class="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={!mahlzeit.ohneGruppen.includes(gruppe.id)}
              disabled={kontext.busy}
              onchange={(event) => void setze(event.currentTarget, gruppe.id, gruppe.name)}
            />
            {gruppe.name}
          </label>
        {/each}
      </fieldset>
    {:else}
      <p class="text-neutral-700">Diese Mahlzeit gibt es nicht mehr.</p>
    {/if}
    <div class="flex justify-end pt-2">
      <ActionButton type="button" onclick={onclose}>Fertig</ActionButton>
    </div>
  </div>
</ModalDialog>
