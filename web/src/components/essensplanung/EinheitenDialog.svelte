<script lang="ts">
  import { untrack } from 'svelte';
  import ModalDialog from '../ui/ModalDialog.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import EinheitFeld from './EinheitFeld.svelte';
  import { confirmAction } from '../../lib/confirm';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { leseMenge, mengeFeld } from '../../lib/essensplanungGerichte';
  import { kiFehlerText } from '../../lib/essensplanungKi';
  import { eigeneEinheiten, vorschau } from '../../lib/essensplanungEinheiten';
  import {
    einheitenVorkommen,
    sichererFaktor,
    vorkommendeEinheiten,
    type KiEinheiten,
  } from '../../../../api/lib/essen-einheiten-model';
  import { einheitText } from '../../../../api/lib/essen-gerichte-model';
  import type { PlanungZutat } from '../../lib/types';
  import type { PlanKontext } from './planKontext';

  /**
   * „Einheiten vereinheitlichen“: the amounts of one ingredient in different units converted into
   * one. The AI proposes the unit and how much each unit is; the member sees every amount before
   * and after, may change unit and factors, and „Übernehmen“ saves all of them in one change.
   */

  interface Props {
    kontext: PlanKontext;
    zutat: PlanungZutat;
    onclose: () => void;
  }
  let { kontext, zutat, onclose }: Props = $props();
  const ansicht = $derived(kontext.ansicht);

  const einheiten = $derived(vorkommendeEinheiten(einheitenVorkommen(ansicht, zutat.id)));
  let ziel = $state(untrack(() => einheiten[0] ?? 'g'));
  /** What one of each unit is in the target unit, as typed, by the unit in lower case. */
  let faktoren = $state<Record<string, string>>({});
  let ki = $state<KiEinheiten | null>(null);
  let fragt = $state(false);
  let kiFehler = $state<string | null>(null);
  let fehler = $state<string | null>(null);
  let geaendert = $state(false);
  /** Counts what is typed, so a proposal that arrives later does not replace it. */
  let eingaben = 0;
  $effect(() => guardUnsavedChanges(() => geaendert));

  const key = (einheit: string) => einheit.toLocaleLowerCase('de');

  /** The factor of a unit: certain ones (g in kg) worked out, else as typed. */
  function faktor(einheit: string): number | null {
    const sicher = ziel ? sichererFaktor(einheit, ziel) : null;
    if (sicher !== null) return sicher;
    const zahl = leseMenge(faktoren[key(einheit)] ?? '');
    return zahl !== null && !Number.isNaN(zahl) && zahl > 0 ? zahl : null;
  }

  const zeilen = $derived(
    ziel
      ? vorschau(
          ansicht,
          zutat.id,
          ziel,
          new Map(
            einheiten.flatMap((einheit) => {
              const wert = faktor(einheit);
              return wert === null ? [] : [[key(einheit), wert] as const];
            })
          )
        )
      : []
  );
  const fehlt = $derived(zeilen.some((zeile) => zeile.menge === null));
  /** Only amounts that change are saved. */
  const neu = $derived(zeilen.filter((zeile) => zeile.nachher !== zeile.vorher));

  async function vorschlagHolen(): Promise<void> {
    fragt = true;
    kiFehler = null;
    const stand = eingaben;
    try {
      const antwort = await kontext.api.senden<KiEinheiten>('POST', '/ki/einheiten', {
        planungZutatId: zutat.id,
      });
      ki = antwort;
      // Typed meanwhile: the own unit and factors stay, the proposal is only shown
      if (eingaben !== stand) return;
      ziel = antwort.ziel;
      faktoren = Object.fromEntries(
        antwort.faktoren.map((f) => [key(f.einheit), f.faktor === null ? '' : mengeFeld(f.faktor)])
      );
    } catch (error: unknown) {
      kiFehler = kiFehlerText(error);
    } finally {
      fragt = false;
    }
  }
  // The proposal is asked for right away; without it unit and factors are typed by hand
  $effect(() => {
    untrack(() => void vorschlagHolen());
  });

  let speichert = $state(false);
  async function uebernehmen(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (speichert || fehlt || !neu.length) return;
    fehler = null;
    speichert = true;
    const ok = await kontext.aendern(
      () =>
        kontext.api.senden('PUT', `/zutaten/${zutat.id}/einheiten`, {
          zeilen: neu.map((z) => ({
            stelle: z.stelle,
            id: z.id,
            etag: z.etag,
            menge: z.menge,
            einheit: z.einheit,
            von: z.von,
          })),
        }),
      `${zutat.name} steht jetzt in ${einheitText(ziel)}.`
    );
    speichert = false;
    if (ok) {
      geaendert = false;
      onclose();
    } else fehler = kontext.fehler;
  }

  async function schliessen(): Promise<void> {
    if (speichert) return;
    if (
      geaendert &&
      !(await confirmAction({
        title: 'Umrechnen abbrechen?',
        message: `Die Mengen von ${zutat.name} bleiben, wie sie sind.`,
        confirmLabel: 'Abbrechen',
      }))
    )
      return;
    onclose();
  }
</script>

<ModalDialog open title="Einheiten von {zutat.name}" size="wide" onclose={() => void schliessen()}>
  <form
    class="min-h-0 space-y-3 overflow-y-auto px-5 py-4 text-sm"
    onsubmit={uebernehmen}
    oninput={() => {
      geaendert = true;
      eingaben += 1;
    }}
  >
    <fieldset class="min-w-0 space-y-3" disabled={speichert}>
      <div class="flex flex-wrap items-center gap-2">
        <label class="font-semibold text-neutral-900" for="einheiten-ziel">Alles in</label>
        <EinheitFeld
          id="einheiten-ziel"
          bind:einheit={ziel}
          art={zutat.einheitenart}
          eigene={eigeneEinheiten(ansicht)}
          class="form-input w-32"
          invalid={!ziel}
        />
        <ActionButton type="button" disabled={fragt} onclick={() => void vorschlagHolen()}
          >{fragt
            ? 'KI überlegt …'
            : ki
              ? 'Neu vorschlagen (KI)'
              : 'Vorschlag der KI'}</ActionButton
        >
        <InfoHint
          label="Einheiten vereinheitlichen"
          text="Die KI schlägt eine Einheit in Haushaltsmengen vor und schätzt, wie viel jede andere Einheit davon ist. An die KI gehen nur der Name der Zutat, ihre Mengen mit Einheit und die Namen der Gerichte. Du kannst alles ändern; übernommen wird erst, was du bestätigst."
        />
      </div>
      {#if kiFehler}<p class="text-danger" role="alert">{kiFehler}</p>{/if}
      {#if ki}
        <p class="text-neutral-700" role="status">
          <span class="font-semibold">KI-Schätzung, ungeprüft:</span>
          {ki.begruendung || `Vorschlag: ${einheitText(ki.ziel)}.`}
        </p>
      {/if}

      <fieldset class="flex flex-wrap gap-x-4 gap-y-2">
        <legend class="sr-only">Umrechnung je Einheit</legend>
        {#each einheiten.filter((e) => key(e) !== key(ziel)) as einheit (key(einheit))}
          {@const sicher = ziel ? sichererFaktor(einheit, ziel) : null}
          <div class="flex items-center gap-1">
            <span class="whitespace-nowrap">1 {einheitText(einheit)} =</span>
            {#if sicher !== null}
              <span class="tabular-nums">{mengeFeld(sicher)}</span>
            {:else}
              <input
                class="form-input w-20 tabular-nums"
                inputmode="decimal"
                autocomplete="off"
                aria-label="So viel {einheitText(ziel || '?')} ist 1 {einheitText(einheit)}"
                aria-invalid={faktor(einheit) === null ? 'true' : undefined}
                placeholder="?"
                bind:value={faktoren[key(einheit)]}
              />
            {/if}
            <span>{ziel ? einheitText(ziel) : ''}</span>
          </div>
        {/each}
      </fieldset>

      <div class="overflow-x-auto">
        <table class="w-full text-left">
          <thead class="border-b border-neutral-300 text-neutral-700">
            <tr>
              <th scope="col" class="py-1 pr-3 font-semibold">Wo</th>
              <th scope="col" class="py-1 pr-3 font-semibold">Jetzt</th>
              <th scope="col" class="py-1 font-semibold">Danach</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-neutral-200">
            {#each zeilen as zeile (`${zeile.stelle}:${zeile.id}:${zeile.von}`)}
              <tr data-testid="einheiten-zeile">
                <td class="py-1 pr-3 [overflow-wrap:anywhere]">{zeile.wo}</td>
                <td class="py-1 pr-3 whitespace-nowrap tabular-nums">{zeile.vorher}</td>
                <td class="py-1 whitespace-nowrap tabular-nums">
                  {#if zeile.nachher}→ {zeile.nachher}{:else}<span class="text-warning"
                      >Umrechnung fehlt</span
                    >{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if fehler}<p class="text-danger" role="alert">{fehler}</p>{/if}
      <div class="flex flex-wrap justify-end gap-2 pt-1">
        <ActionButton type="button" onclick={() => void schliessen()}>Abbrechen</ActionButton>
        <ActionButton
          type="submit"
          variant="primary"
          disabled={!ziel || fehlt || !neu.length || kontext.busy}
          >{neu.length === 1
            ? 'Eine Menge umrechnen'
            : `${neu.length} Mengen umrechnen`}</ActionButton
        >
      </div>
    </fieldset>
  </form>
</ModalDialog>
