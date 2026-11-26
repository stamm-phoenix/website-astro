<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import KiZutatenErgebnis from './KiZutatenErgebnis.svelte';
  import { errorMessage, sendApi } from '../../lib/api';
  import { essensplanungSteuerung } from '../../lib/pflegeStore.svelte';
  import { kiZutatenPruefen, zentraleZutatKiBody } from '../../lib/essensplanungKiZutaten';
  import type {
    KiZutatErgebnis,
    KiZutatPruefung,
  } from '../../../../api/lib/essen-ki-zutaten-model';
  import type { StaffEssenSteuerung } from '../../lib/types/essen';

  /**
   * „Zutaten prüfen (KI)“ of the central list: the AI checks all ingredients, or one
   * (`pruefen`), in portions; proposals are saved one by one or all at once.
   */

  interface Props {
    data: StaffEssenSteuerung;
    /** Opens an ingredient to change it by hand. */
    onaendern: (id: number) => void;
  }
  let { data, onaendern }: Props = $props();

  /** Entries per request of „Alle übernehmen“ (`MAX_ZUTATEN_SAMMEL` of the API). */
  const SAMMEL = 50;

  let ergebnisse = $state<KiZutatErgebnis[] | null>(null);
  let fortschritt = $state<{ fertig: number; gesamt: number } | null>(null);
  let fehler = $state<string | null>(null);
  let rest = $state<number[]>([]);
  let anhalten = false;
  let nummer = $state(0);

  /** Checks the central ingredients with these ids; a new check replaces the shown result. */
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
      (portion) =>
        sendApi<KiZutatPruefung>('POST', '/intern/essensplanung/ki/zutaten', { ids: portion }),
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

  async function speichere(liste: KiZutatErgebnis[]): Promise<Record<number, string | null>> {
    const antwort: Record<number, string | null> = {};
    const bodies = liste.flatMap((ergebnis) => {
      const aktuell = data.zutaten.find((z) => z.id === ergebnis.id);
      const body = aktuell ? zentraleZutatKiBody(aktuell, ergebnis) : null;
      if (!body) antwort[ergebnis.id] = 'Die Zutat gibt es nicht mehr.';
      return body ? [body] : [];
    });
    for (let start = 0; start < bodies.length; start += SAMMEL) {
      const portion = bodies.slice(start, start + SAMMEL);
      try {
        const result = await sendApi<{
          ergebnisse: { id: number; fehler: string | null }[];
          view: StaffEssenSteuerung;
        }>('POST', '/intern/pflege/essensplanung-zutaten/sammel', { zutaten: portion });
        for (const eintrag of result.ergebnisse) antwort[eintrag.id] = eintrag.fehler;
        essensplanungSteuerung.set(result.view);
      } catch (error: unknown) {
        const text = errorMessage(
          error,
          'Die Vorschläge wurden nicht gespeichert. Prüfe deine Internetverbindung und tippe noch einmal auf „Übernehmen“.'
        );
        for (const body of portion) antwort[body.id] = text;
      }
    }
    return antwort;
  }

  async function uebernehmen(ergebnis: KiZutatErgebnis): Promise<string | null> {
    return (await speichere([ergebnis]))[ergebnis.id] ?? null;
  }
</script>

{#if data.zutaten.length}
  <ActionButton
    type="button"
    disabled={fortschritt !== null}
    onclick={() => void pruefen(data.zutaten.map((z) => z.id))}
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
      onweiter={rest.length ? () => void pruefen(rest, true) : undefined}
      onabbrechen={() => (anhalten = true)}
      {uebernehmen}
      alleUebernehmen={speichere}
      onaendern={(ergebnis) => onaendern(ergebnis.id)}
      onschliessen={() => {
        ergebnisse = null;
        fehler = null;
      }}
    />
  {/key}
{/if}
