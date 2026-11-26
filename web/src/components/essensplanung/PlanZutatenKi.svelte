<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import KiZutatenErgebnis from './KiZutatenErgebnis.svelte';
  import type {
    KiZutatErgebnis,
    KiZutatPruefung,
  } from '../../../../api/lib/essen-ki-zutaten-model';
  import type { PlanungZutat } from '../../../../api/lib/essen-gerichte-model';
  import {
    eigeneZutatIds,
    kiZutatenPruefen,
    planungZutatKiBody,
  } from '../../lib/essensplanungKiZutaten';
  import type { PlanKontext } from './planKontext';

  /**
   * „Zutaten prüfen (KI)“ in „Zutaten dieser Planung“: the AI checks the Planung's own
   * ingredients (the central ones are checked in the central list), all or one (`pruefen`).
   */

  interface Props {
    kontext: PlanKontext;
    bearbeiten: boolean;
    /** Opens an ingredient to change it by hand. */
    onaendern: (zutat: PlanungZutat) => void;
  }
  let { kontext, bearbeiten, onaendern }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const eigene = $derived(eigeneZutatIds(ansicht.zutaten));

  let ergebnisse = $state<KiZutatErgebnis[] | null>(null);
  let fortschritt = $state<{ fertig: number; gesamt: number } | null>(null);
  let fehler = $state<string | null>(null);
  let rest = $state<number[]>([]);
  let anhalten = false;
  /** Counts the checks; a new one starts the result list afresh. */
  let nummer = $state(0);

  /** Checks the own ingredients with these ids; a new check replaces the shown result. */
  export async function pruefen(ids: readonly number[], weiter = false): Promise<void> {
    if (fortschritt || !ids.length) return;
    if (!weiter) {
      ergebnisse = [];
      nummer++;
    }
    fehler = null;
    anhalten = false;
    const lauf = await kiZutatenPruefen(
      ids,
      (portion) => kontext.api.senden<KiZutatPruefung>('POST', '/ki/zutaten', { ids: portion }),
      {
        fortschritt: (fertig, gesamt) => (fortschritt = { fertig, gesamt }),
        abgebrochen: () => anhalten,
      }
    );
    ergebnisse = [...(ergebnisse ?? []), ...lauf.ergebnisse];
    fehler = lauf.fehler;
    rest = lauf.offen;
    fortschritt = null;
  }

  async function uebernehmen(ergebnis: KiZutatErgebnis): Promise<string | null> {
    const body = planungZutatKiBody(ergebnis);
    if (!body) return null;
    const name = ergebnis.vorschlag?.name ?? ergebnis.name;
    const ok = await kontext.aendern(
      () => kontext.api.senden('PATCH', `/zutaten/${ergebnis.id}`, body),
      `Vorschlag für ${name} übernommen.`
    );
    return ok ? null : (kontext.fehler ?? `Der Vorschlag für ${name} wurde nicht gespeichert.`);
  }

  async function alleUebernehmen(liste: KiZutatErgebnis[]): Promise<Record<number, string | null>> {
    const antwort: Record<number, string | null> = {};
    for (const ergebnis of liste) antwort[ergebnis.id] = await uebernehmen(ergebnis);
    return antwort;
  }

  function aendern(ergebnis: KiZutatErgebnis): void {
    const zutat = ansicht.zutaten.find((z) => z.id === ergebnis.id);
    if (zutat) onaendern(zutat);
    else fehler = `${ergebnis.name} gibt es in dieser Planung nicht mehr.`;
  }
</script>

{#if bearbeiten && eigene.length}
  <ActionButton
    type="button"
    disabled={fortschritt !== null || kontext.busy}
    onclick={() => void pruefen(eigene)}
  >
    Zutaten prüfen (KI)
  </ActionButton>
{/if}
{#if ergebnisse}
  {#key nummer}
    <KiZutatenErgebnis
      {ergebnisse}
      {fortschritt}
      {fehler}
      {bearbeiten}
      onweiter={rest.length ? () => void pruefen(rest, true) : undefined}
      ungeprueft={rest.length}
      onabbrechen={() => (anhalten = true)}
      {uebernehmen}
      {alleUebernehmen}
      onaendern={aendern}
      onschliessen={() => {
        ergebnisse = null;
        fehler = null;
      }}
    />
  {/key}
{/if}
