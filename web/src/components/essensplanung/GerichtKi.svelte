<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { kiFehlerText } from '../../lib/essensplanungKi';
  import type { KiPruefung } from '../../lib/essensplanungKiPruefung';
  import type {
    EssenKatalog,
    Gericht,
    PlanungZutat,
  } from '../../../../api/lib/essen-gerichte-model';
  import GerichtKiPruefung from './GerichtKiPruefung.svelte';
  import RezeptImportDialog from './RezeptImportDialog.svelte';
  import { gespeichert } from './planKontext';
  import type { PlanKontext } from './planKontext';

  /**
   * The AI at a dish, for those who edit: „Gericht prüfen“ assesses the dish for its people and
   * lists hints whose proposals can be taken over with one click (`GerichtKiPruefung.svelte`),
   * „Rezept einfügen“ reads the lines of a pasted recipe for confirmation. Answers are marked as
   * AI and unchecked.
   */

  interface Props {
    kontext: PlanKontext;
    katalog: EssenKatalog | null;
    gericht: Gericht;
    zutaten: ReadonlyMap<number, PlanungZutat>;
    /**
     * False while the Planung cannot be changed (maintenance): the component stays with what
     * was typed, only its actions wait.
     */
    bearbeiten: boolean;
  }
  let { kontext, katalog, gericht, zutaten, bearbeiten }: Props = $props();

  let pruefung = $state<KiPruefung | null>(null);
  let prueft = $state(false);
  let fehler = $state<string | null>(null);
  let rezeptOffen = $state(false);
  /** A proposal of this card is being saved; checking again waits for it. */
  let uebernimmt = $state(false);

  async function pruefen(): Promise<void> {
    if (uebernimmt || kontext.busy) return;
    prueft = true;
    fehler = null;
    pruefung = null;
    // A line or field left with the click saves after it; the check reads what is saved
    if (!(await gespeichert())) {
      fehler =
        'Eine Änderung am Gericht ist noch nicht gespeichert. Prüfe das Gericht, wenn sie gespeichert ist.';
      prueft = false;
      return;
    }
    try {
      pruefung = await kontext.api.senden<KiPruefung>('POST', `/gerichte/${gericht.id}/ki/pruefen`);
    } catch (error: unknown) {
      fehler = kiFehlerText(error);
    } finally {
      prueft = false;
    }
  }
</script>

<section class="space-y-2 print:hidden" aria-labelledby="gericht-{gericht.id}-ki">
  <h4 id="gericht-{gericht.id}-ki" class="sr-only">KI-Hilfe</h4>
  <div class="flex flex-wrap gap-2">
    <ActionButton
      type="button"
      disabled={!bearbeiten || prueft || uebernimmt || kontext.busy || !gericht.zutaten.length}
      onclick={() => void pruefen()}
    >
      {prueft ? 'KI prüft …' : 'Gericht prüfen (KI)'}
    </ActionButton>
    <ActionButton
      type="button"
      disabled={!bearbeiten || !katalog}
      onclick={() => (rezeptOffen = true)}
    >
      Rezept einfügen (KI)
    </ActionButton>
  </div>
  {#if fehler}<p class="text-sm text-danger" role="alert">{fehler}</p>{/if}
  {#if pruefung}
    <!-- A new check starts with fresh hints, taken over ones and versions -->
    {#key pruefung}
      <GerichtKiPruefung
        {kontext}
        {gericht}
        {zutaten}
        {pruefung}
        {bearbeiten}
        gesperrt={prueft || kontext.busy}
        onuebernimmt={(laeuft) => (uebernimmt = laeuft)}
        onneu={() => void pruefen()}
        onausblenden={() => (pruefung = null)}
      />
    {/key}
  {/if}
</section>

{#if katalog && rezeptOffen}
  <RezeptImportDialog
    {kontext}
    {katalog}
    {gericht}
    {bearbeiten}
    open={rezeptOffen}
    onclose={() => (rezeptOffen = false)}
  />
{/if}
