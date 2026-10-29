<script lang="ts">
  import { tick } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import VorschlagFeld from '../ui/VorschlagFeld.svelte';
  import { getippteZutat, zutatVorschlaege, zutatWahl } from '../../lib/essensplanungGerichte';
  import type { EssenKatalog } from '../../lib/types';
  import type { Vorschlag } from '../../lib/vorschlaege';
  import type { PlanKontext } from './planKontext';

  /**
   * One field under the shopping list for what else has to be bought, e.g. „Kochhandschuhe“: a
   * name of the list or one of its own, without an amount. Enter puts it on the list; an amount
   * goes in later under „Zusatzbedarf“.
   */

  interface Props {
    kontext: PlanKontext;
    /** The central list for the suggestions; without it only the names of the Planung. */
    katalog: EssenKatalog | null;
    /** What is typed; kept and guarded by the list, so it outlives a read-only phase. */
    text: string;
  }
  let { kontext, katalog, text = $bindable() }: Props = $props();

  let fehler = $state<string | null>(null);
  let speichert = $state(false);
  let feld = $state<HTMLInputElement | null>(null);

  const vorschlaege = $derived(
    zutatVorschlaege(
      katalog ?? { zutaten: [], kategorien: [], unvertraeglichkeiten: [] },
      kontext.ansicht.zutaten,
      { nurLebensmittel: false }
    )
  );

  /** Puts the typed thing on the list: the ingredient of that name, else a thing of its own. */
  async function hinzufuegen(gewaehlt?: Vorschlag): Promise<void> {
    const name = (gewaehlt?.value ?? text).trim();
    if (speichert || !name) return;
    fehler = null;
    const treffer = gewaehlt ?? getippteZutat(vorschlaege, name);
    const wahl = treffer ? zutatWahl(treffer) : null;
    const zutat = !wahl
      ? { name }
      : wahl.art === 'planung'
        ? { planungZutatId: wahl.id }
        : { zutatId: wahl.id };
    speichert = true;
    const ok = await kontext.aendern(
      () =>
        kontext.api.senden('POST', '/zusatzbedarf', {
          ...zutat,
          menge: null,
          einheit: null,
          hinweis: '',
        }),
      `${name} steht auf der Einkaufsliste.`
    );
    speichert = false;
    if (!ok) {
      fehler = kontext.fehler;
      return;
    }
    text = '';
    // The field is enabled again only after the update
    await tick();
    feld?.focus();
  }

  /** Enter adds; when it takes a suggestion first, the field says so by `preventDefault`. */
  function taste(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    queueMicrotask(() => {
      if (!event.defaultPrevented) void hinzufuegen();
    });
  }
</script>

<div class="space-y-1 print:hidden">
  <label class="form-label" for="einkauf-neu">Noch etwas besorgen</label>
  <div class="flex flex-wrap gap-2">
    <VorschlagFeld
      id="einkauf-neu"
      wrapperClass="min-w-0 flex-1 basis-56"
      options={vorschlaege}
      bind:value={text}
      bind:input={feld}
      listLabel="Zutaten"
      placeholder="z. B. Kochhandschuhe"
      disabled={speichert}
      onpick={(option) => void hinzufuegen(option)}
      onkeydown={taste}
    />
    <ActionButton
      type="button"
      variant="primary"
      disabled={speichert || kontext.busy || !text.trim()}
      onclick={() => void hinzufuegen()}>Auf die Liste</ActionButton
    >
  </div>
  {#if fehler}<p class="text-sm text-danger" role="alert">{fehler}</p>{/if}
</div>
