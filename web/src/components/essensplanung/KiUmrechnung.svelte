<script lang="ts">
  import { untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import { leseMenge, mengeFeld } from '../../lib/essensplanungGerichte';
  import { kiFehlerText, type KiMass, type KiUmrechnung } from '../../lib/essensplanungKi';
  import type { EssenKatalog, KatalogZutat, PlanungZutat } from '../../lib/types';
  import type { PlanKontext } from './planKontext';

  /**
   * „Schätzen lassen“: for TL, EL or pieces without a value in the list, the AI estimates the
   * grams of an ingredient measured by weight. Clearly an AI estimate; taking it over enters the
   * result as the amount in g.
   */

  interface Props {
    kontext: PlanKontext;
    katalog: EssenKatalog;
    /** The chosen ingredient: of the Planung (with `zutatId`) or of the central list. */
    zutat: PlanungZutat | KatalogZutat;
    /** The amount the line has in TL, EL or pieces, to start with. */
    vorgabe?: { anzahl: string; mass: KiMass };
    onuebernehmen: (gramm: number) => void;
  }
  let { kontext, katalog, zutat, vorgabe, onuebernehmen }: Props = $props();

  const MASSE: {
    mass: KiMass;
    label: string;
    feld: 'grammProTl' | 'grammProEl' | 'grammProStueck';
  }[] = [
    { mass: 'tl', label: 'TL', feld: 'grammProTl' },
    { mass: 'el', label: 'EL', feld: 'grammProEl' },
    { mass: 'stueck', label: 'Stück', feld: 'grammProStueck' },
  ];

  /** The measures the list has no value for; an own ingredient of the Planung has none. */
  const fehlend = $derived.by(() => {
    const zentralId = 'zutatId' in zutat ? zutat.zutatId : zutat.id;
    const zentral =
      zentralId === null ? undefined : katalog.zutaten.find((z) => z.id === zentralId);
    return MASSE.filter((eintrag) => !zentral || zentral[eintrag.feld] === null);
  });

  let anzahl = $state(untrack(() => vorgabe?.anzahl ?? '1'));
  let mass = $state<KiMass>(untrack(() => vorgabe?.mass ?? 'el'));
  // The line typed in TL, EL or pieces: the estimate follows it
  $effect(() => {
    const von = vorgabe;
    if (!von) return;
    untrack(() => {
      anzahl = von.anzahl;
      mass = von.mass;
    });
  });
  let schaetzung = $state<KiUmrechnung | null>(null);
  let schaetzt = $state(false);
  let fehler = $state<string | null>(null);

  /** The chosen ingredient: ids of the Planung and of the list may be the same number. */
  const auswahl = $derived(`${'zutatId' in zutat ? 'p' : 'z'}:${zutat.id}`);
  /** Counts the questions; an answer belongs to the newest one only. */
  let anfrage = 0;

  // Another ingredient starts afresh, and an answer still on its way is for the old one
  $effect(() => {
    void auswahl;
    anfrage++;
    schaetzung = null;
    fehler = null;
    schaetzt = false;
  });
  $effect(() => {
    // A count of a measure not offered here would count the first one: it starts again at 1
    if (fehlend.length && !fehlend.some((eintrag) => eintrag.mass === mass)) {
      mass = fehlend[0].mass;
      anzahl = '1';
    }
  });

  const label = (wert: KiMass) => MASSE.find((eintrag) => eintrag.mass === wert)?.label ?? '';

  const gramm = $derived.by(() => {
    const zahl = leseMenge(anzahl);
    if (!schaetzung?.gramm || schaetzung.mass !== mass || zahl === null || Number.isNaN(zahl))
      return null;
    const roh = zahl * schaetzung.gramm;
    return roh < 10 ? Math.round(roh * 10) / 10 : Math.round(roh);
  });

  async function schaetzen(): Promise<void> {
    const nummer = ++anfrage;
    const fuer = auswahl;
    /** Whether the answer still belongs to what is shown: same ingredient, newest question. */
    const aktuell = () => nummer === anfrage && fuer === auswahl;
    schaetzt = true;
    fehler = null;
    schaetzung = null;
    try {
      const antwort = await kontext.api.senden<KiUmrechnung>('POST', '/ki/umrechnung', {
        ...('zutatId' in zutat ? { planungZutatId: zutat.id } : { zutatId: zutat.id }),
        mass,
      });
      if (aktuell()) schaetzung = antwort;
    } catch (error: unknown) {
      if (aktuell()) fehler = kiFehlerText(error);
    } finally {
      if (aktuell()) schaetzt = false;
    }
  }
</script>

{#if fehlend.length}
  <fieldset class="space-y-2 rounded-md border border-dashed border-neutral-300 p-3">
    <legend class="flex items-center gap-1 px-1 text-sm font-semibold text-neutral-900">
      In Gramm schätzen lassen (KI)
      <InfoHint
        label="In Gramm schätzen lassen"
        text="Für Maße ohne Wert in der Zutatenliste schätzt die KI, wie viel Gramm ein gestrichener TL, EL oder ein Stück wiegt. Das ist eine KI-Schätzung, kein geprüfter Wert."
      />
    </legend>
    <div class="flex flex-wrap items-center gap-2">
      <label class="sr-only" for="ki-umrechnen-anzahl">Anzahl zum Schätzen</label>
      <input
        id="ki-umrechnen-anzahl"
        class="form-input w-20"
        inputmode="decimal"
        autocomplete="off"
        bind:value={anzahl}
      />
      <label class="sr-only" for="ki-umrechnen-mass">Maß zum Schätzen</label>
      <select id="ki-umrechnen-mass" class="form-input w-auto" bind:value={mass}>
        {#each fehlend as eintrag (eintrag.mass)}
          <option value={eintrag.mass}>{eintrag.label}</option>
        {/each}
      </select>
      <ActionButton type="button" disabled={schaetzt} onclick={() => void schaetzen()}
        >{schaetzt ? 'KI schätzt …' : 'Schätzen lassen'}</ActionButton
      >
    </div>
    {#if fehler}<p class="text-sm text-danger" role="alert">{fehler}</p>{/if}
    {#if schaetzung}
      <div class="space-y-1 text-sm" role="status">
        {#if schaetzung.gramm === null}
          <p>Die KI kann das für diese Zutat nicht schätzen.</p>
        {:else}
          <p>
            <span class="font-semibold">KI-Schätzung, ungeprüft:</span>
            1 {label(schaetzung.mass)} ≈ {mengeFeld(schaetzung.gramm)} g
            {#if gramm !== null && leseMenge(anzahl) !== 1}
              · {anzahl.trim()} {label(schaetzung.mass)} ≈ {mengeFeld(gramm)} g
            {/if}
          </p>
        {/if}
        {#if schaetzung.begruendung}
          <p class="text-neutral-700 [overflow-wrap:anywhere]">{schaetzung.begruendung}</p>
        {/if}
        {#if gramm !== null && gramm > 0}
          <ActionButton type="button" onclick={() => onuebernehmen(gramm!)}
            >{mengeFeld(gramm)} g übernehmen</ActionButton
          >
        {/if}
      </div>
    {/if}
  </fieldset>
{/if}
