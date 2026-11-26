<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import Aktionsraster from '../ui/Aktionsraster.svelte';
  import { errorMessage, sendApi } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import { kiFehlerText } from '../../lib/essensplanungKi';
  import { essensplanungSteuerung } from '../../lib/pflegeStore.svelte';
  import type { KiDoppelte } from '../../../../api/lib/essen-zutat-zentral-model';
  import type { StaffEssenSteuerung } from '../../lib/types/essen';

  /**
   * „Doppelte finden (KI)“ in the central list: the AI groups ingredients that are the same thing
   * under different names; the user picks the one to keep and merges the group.
   */

  interface Props {
    data: StaffEssenSteuerung;
    onnotice: (message: string | null, kind?: 'success' | 'error') => void;
  }
  let { data, onnotice }: Props = $props();

  interface Gruppe {
    ids: number[];
    behalten: number;
    grund: string;
    fehler: string | null;
  }
  let gruppen = $state<Gruppe[] | null>(null);
  let sucht = $state(false);
  let fehler = $state<string | null>(null);
  let speichert = $state(false);

  const zutat = $derived(new Map(data.zutaten.map((z) => [z.id, z])));
  const kategorieName = $derived(new Map(data.kategorien.map((k) => [k.id, k.name])));
  /** Groups whose ingredients are all still in the list. */
  const offen = $derived(
    (gruppen ?? []).filter((g) => g.ids.filter((id) => zutat.has(id)).length > 1)
  );

  async function suchen(): Promise<void> {
    if (sucht) return;
    sucht = true;
    fehler = null;
    try {
      const antwort = await sendApi<KiDoppelte>('POST', '/intern/essensplanung/ki/doppelte');
      gruppen = antwort.gruppen.map((g) => ({ ...g, fehler: null }));
    } catch (error: unknown) {
      fehler = kiFehlerText(error);
    } finally {
      sucht = false;
    }
  }

  async function zusammenlegen(gruppe: Gruppe): Promise<void> {
    if (speichert) return;
    const bleibt = zutat.get(gruppe.behalten);
    const andere = gruppe.ids.filter((id) => id !== gruppe.behalten && zutat.has(id));
    if (!bleibt || !andere.length) return;
    if (
      !(await confirmAction({
        title: `${andere.length + 1} Zutaten zu „${bleibt.name}“ zusammenlegen?`,
        message: `${andere.map((id) => `„${zutat.get(id)?.name}“`).join(', ')} verschwinden aus der Liste; Planungen, die sie nutzen, nutzen dann „${bleibt.name}“ mit ihren Mengen.`,
        confirmLabel: 'Zusammenlegen',
      }))
    )
      return;
    speichert = true;
    gruppe.fehler = null;
    onnotice(null);
    try {
      for (const von of andere) {
        const result = await sendApi<{ view: StaffEssenSteuerung }>(
          'POST',
          '/intern/pflege/essensplanung-zutaten/zusammenlegen',
          { von, nach: gruppe.behalten }
        );
        essensplanungSteuerung.set(result.view);
      }
      onnotice(`Zutaten zu „${bleibt.name}“ zusammengelegt.`);
    } catch (error: unknown) {
      gruppe.fehler = errorMessage(
        error,
        'Das Zusammenlegen hat nicht geklappt; was schon zusammengelegt ist, bleibt so. Lade die Liste neu und versuche es noch einmal.'
      );
    } finally {
      speichert = false;
    }
  }

  function auslassen(gruppe: Gruppe): void {
    gruppen = (gruppen ?? []).filter((g) => g !== gruppe);
  }
</script>

<ActionButton type="button" disabled={sucht} onclick={() => void suchen()}>
  {sucht ? 'Die KI sucht …' : 'Doppelte finden (KI)'}
</ActionButton>
{#if fehler}<p class="text-sm text-danger" role="alert">{fehler}</p>{/if}
{#if gruppen}
  <section class="surface space-y-3 p-4" aria-labelledby="doppelte-titel">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 id="doppelte-titel" class="font-semibold text-brand-900">Doppelte Zutaten</h3>
      <ActionButton type="button" disabled={speichert} onclick={() => (gruppen = null)}>
        Schließen
      </ActionButton>
    </div>
    <p class="text-sm text-neutral-700">
      Von der KI erzeugt und ungeprüft. Entscheide selbst, was davon stimmt.
    </p>
    {#if offen.length}
      <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
        {#each offen as gruppe (gruppe.ids.join())}
          <li class="space-y-2 py-3">
            <fieldset>
              <legend class="text-sm text-neutral-700">Behalten:</legend>
              {#each gruppe.ids.filter((id) => zutat.has(id)) as id (id)}
                <label class="flex min-h-11 items-center gap-2">
                  <input type="radio" value={id} bind:group={gruppe.behalten} />
                  <span>
                    <span class="font-semibold text-neutral-900">{zutat.get(id)?.name}</span>
                    <span class="text-sm text-neutral-700">
                      {kategorieName.get(zutat.get(id)?.kategorieId ?? 0) ?? ''}
                    </span>
                  </span>
                </label>
              {/each}
            </fieldset>
            {#if gruppe.grund}<p class="text-sm text-neutral-700">{gruppe.grund}</p>{/if}
            <Aktionsraster role="group" aria-label="Doppelte Zutaten">
              <ActionButton
                type="button"
                variant="primary"
                disabled={speichert}
                onclick={() => void zusammenlegen(gruppe)}
              >
                Zusammenlegen
              </ActionButton>
              <ActionButton type="button" disabled={speichert} onclick={() => auslassen(gruppe)}>
                Nicht doppelt
              </ActionButton>
            </Aktionsraster>
            {#if gruppe.fehler}<p class="text-sm text-danger" role="alert">{gruppe.fehler}</p>{/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-sm text-neutral-700" role="status">Keine doppelten Zutaten gefunden.</p>
    {/if}
  </section>
{/if}
