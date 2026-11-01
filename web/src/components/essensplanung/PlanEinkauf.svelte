<script lang="ts">
  import { untrack } from 'svelte';
  import { errorMessage } from '../../lib/api';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { einkaufListen, einkaufsReihenfolge } from '../../lib/essensplanungEinkaeufe';
  import type { EssenKatalog } from '../../lib/types';
  import EinkaufAnsicht from './EinkaufAnsicht.svelte';
  import GeschaeftDialog from './GeschaeftDialog.svelte';
  import OffeneEinkaufsliste from './OffeneEinkaufsliste.svelte';
  import PlanEinkaeufe from './PlanEinkaeufe.svelte';
  import PlanGeschaefte from './PlanGeschaefte.svelte';
  import PlanLager from './PlanLager.svelte';
  import PostenDialog from './PostenDialog.svelte';
  import PostenListe from './PostenListe.svelte';
  import type { PostenArt } from '../../../../api/lib/essen-einkauf-model';
  import type { PlanKontext } from './planKontext';

  /**
   * The area „Einkauf“: the open shopping list, the trips, extra needs, stock and shops side by
   * side on wide screens. A trip opens in a view of its own in place of all that; the browser's
   * back button leads back.
   */

  interface Props {
    kontext: PlanKontext;
    /** Whether the area is shown; the central lists load only then. */
    sichtbar: boolean;
  }
  let { kontext, sichtbar }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const bearbeiten = $derived(ansicht.zugang !== 'lesen' && !ansicht.wartung);

  /** The central lists, for the names of the categories and the choice of ingredients. */
  let katalog = $state<EssenKatalog | null>(null);
  let katalogFehler = $state<string | null>(null);
  /** The `katalogStand` the lists were loaded for. */
  let geladen: string | null = null;
  async function katalogLaden(): Promise<void> {
    katalogFehler = null;
    geladen = ansicht.katalogStand;
    try {
      katalog = await kontext.api.katalog();
    } catch (error: unknown) {
      // Not loaded: the next view or the button tries again
      geladen = null;
      katalogFehler = errorMessage(error, 'Die Liste der Zutaten konnte nicht geladen werden.');
    }
  }
  $effect(() => {
    if (sichtbar && ansicht.katalogStand !== geladen) untrack(() => void katalogLaden());
  });

  const kategorien = $derived(new Map((katalog?.kategorien ?? []).map((k) => [k.id, k.name])));
  const listen = $derived(einkaufListen(ansicht, kategorien));
  const reihe = $derived(
    einkaufsReihenfolge(ansicht.einkaeufe).flatMap((e) => {
      const liste = listen.get(e.id);
      return liste ? [liste] : [];
    })
  );

  /** What is typed under „Noch etwas besorgen“, kept while the page is read-only for a while. */
  let neuerZusatz = $state('');
  $effect(() => guardUnsavedChanges(() => neuerZusatz.trim() !== ''));

  let geschaeftDialog = $state<number | null | undefined>(undefined);
  let postenDialog = $state<{ art: PostenArt; id: number | null } | null>(null);

  // ---------------------------------------------------------------------------------------------
  // The trip shown on its own
  // ---------------------------------------------------------------------------------------------

  /** Key in `history.state`: the same address (with the link's fragment) gets an entry per trip. */
  const VERLAUF = 'essensplanungEinkauf';
  /** The trip shown now; null for the overview. */
  let offen = $state<number | null>(null);
  /** Shopping or the list, per trip, as last shown. */
  let modi = $state<Record<number, 'live' | 'liste'>>({});

  function verlaufEinkauf(): number | null {
    const state: unknown = history.state;
    if (state && typeof state === 'object' && VERLAUF in state) {
      const id = (state as Record<string, unknown>)[VERLAUF];
      if (typeof id === 'number') return id;
    }
    return null;
  }

  function oeffnen(einkaufId: number, modus: 'live' | 'liste' | null): void {
    if (modus) modi[einkaufId] = modus;
    if (offen === einkaufId) return;
    offen = einkaufId;
    try {
      // Same address and fragment, so the link's token stays; the router of the site keeps its
      // own index and scroll position in the state and restores the list's position on the way back
      const state: unknown = history.state;
      const bisher = state && typeof state === 'object' ? (state as Record<string, unknown>) : {};
      const index = typeof bisher.index === 'number' ? bisher.index + 1 : 0;
      history.pushState({ ...bisher, index, scrollX: 0, scrollY: 0, [VERLAUF]: einkaufId }, '');
    } catch {
      // Without the history the button „Zurück“ still leads back
    }
  }

  function zurueck(): void {
    if (offen !== null && verlaufEinkauf() === offen) history.back();
    else offen = null;
  }

  $effect(() => {
    const onPop = (): void => {
      const id = verlaufEinkauf();
      offen = id !== null && kontext.ansicht.einkaeufe.some((e) => e.id === id) ? id : null;
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });

  // Someone else deleted the trip shown: back to the overview
  $effect(() => {
    if (offen !== null && !ansicht.einkaeufe.some((e) => e.id === offen)) offen = null;
  });

  const standardModus = (einkaufId: number): 'live' | 'liste' => {
    const einkauf = ansicht.einkaeufe.find((e) => e.id === einkaufId);
    return bearbeiten && einkauf && !einkauf.abgeschlossen ? 'live' : 'liste';
  };
</script>

<div hidden={offen !== null}>
  <div
    class="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start"
  >
    <div class="order-2 xl:order-none">
      <OffeneEinkaufsliste
        {kontext}
        {katalog}
        {katalogFehler}
        onkatalog={() => void katalogLaden()}
        {kategorien}
        bind:neuerZusatz
      />
    </div>
    <div class="contents xl:block xl:space-y-6">
      <div class="order-1 xl:order-none">
        <PlanEinkaeufe {kontext} listen={reihe} katalogGeladen={!!katalog} onoeffnen={oeffnen} />
      </div>
      <div class="order-3 grid gap-6 sm:grid-cols-2 xl:order-none xl:grid-cols-1 2xl:grid-cols-2">
        <PostenListe
          {kontext}
          art="zusatzbedarf"
          titel="Zusatzbedarf"
          eintraege={ansicht.zusatzbedarf}
          leer="Noch kein Zusatzbedarf."
          onbearbeiten={(id) => (postenDialog = { art: 'zusatzbedarf', id })}
        />
        <PostenListe
          {kontext}
          art="bestand"
          titel="Bestand"
          eintraege={ansicht.bestand}
          leer="Noch kein Bestand."
          onbearbeiten={(id) => (postenDialog = { art: 'bestand', id })}
        />
      </div>
      <div class="order-4 xl:order-none">
        <PlanLager {kontext} />
      </div>
      <div class="order-5 xl:order-none">
        <PlanGeschaefte {kontext} onbearbeiten={(id) => (geschaeftDialog = id)} />
      </div>
    </div>
  </div>
</div>

{#each reihe as liste (liste.einkauf.id)}
  <EinkaufAnsicht
    {kontext}
    {liste}
    {bearbeiten}
    katalogGeladen={!!katalog}
    sichtbar={sichtbar && offen === liste.einkauf.id}
    modus={modi[liste.einkauf.id] ?? standardModus(liste.einkauf.id)}
    onmodus={(modus) => (modi[liste.einkauf.id] = modus)}
    onzurueck={zurueck}
  />
{/each}

<GeschaeftDialog
  {kontext}
  geschaeftId={geschaeftDialog}
  onclose={() => (geschaeftDialog = undefined)}
/>
<PostenDialog
  {kontext}
  {katalog}
  {katalogFehler}
  onkatalog={() => void katalogLaden()}
  art={postenDialog?.art ?? 'bestand'}
  postenId={postenDialog?.id}
  onclose={() => (postenDialog = null)}
/>
