<script lang="ts">
  import { untrack } from 'svelte';
  import FormField from '../pflege/FormField.svelte';
  import VorschlagFeld from '../ui/VorschlagFeld.svelte';
  import type { PlanungZutat } from '../../../../api/lib/essen-gerichte-model';
  import {
    geschaeftAnlegen,
    geschaeftSetzen,
    geschaeftVon,
    geschaeftVorschlaege,
  } from './zeileGeschaeft';
  import type { PlanKontext } from './planKontext';

  /**
   * The shop of the ingredient in the dialog of a line of a dish (`GerichtZeileDialog`): it shows
   * the shop of the chosen ingredient until something is typed, which the dialog then saves with
   * the line. A new name adds the shop. Mounted afresh each time the dialog opens.
   */

  interface Props {
    kontext: PlanKontext;
    /** The chosen ingredient once it is in the Planung. */
    zutat: PlanungZutat | undefined;
    /** Something was typed or picked. */
    onedit: () => void;
  }
  let { kontext, zutat, onedit }: Props = $props();
  const ansicht = $derived(kontext.ansicht);

  let text = $state('');
  let getippt = $state(false);
  let fehler = $state<string | undefined>(undefined);
  /** The version of the ingredient whose shop the field showed last. */
  let stand: { planungZutatId: number; etag: string } | null = null;

  // Shows the shop of the chosen ingredient, unless one was typed
  $effect(() => {
    const gewaehlt = zutat;
    const name = geschaeftVon(ansicht.geschaefte, gewaehlt);
    untrack(() => {
      if (getippt) return;
      text = name;
      stand = gewaehlt ? { planungZutatId: gewaehlt.id, etag: gewaehlt.etag } : null;
    });
  });

  function bearbeitet(): void {
    getippt = true;
    onedit();
  }

  /** Whether a typed shop is to be set after the line, as its ingredient is new to the Planung. */
  export function nachDerZeile(): boolean {
    return getippt && text.trim().length > 0;
  }

  /**
   * Adds a typed new shop and sets it for the ingredient when it is in the Planung already
   * (`planungZutatId`), before the line is saved. Whether it worked; else the field or the page
   * says why (`feld`: the field does).
   */
  export async function vorDerZeile(
    planungZutatId: number | undefined
  ): Promise<{ ok: boolean; feld?: boolean }> {
    fehler = undefined;
    if (!getippt) return { ok: true };
    const angelegt = await geschaeftAnlegen(kontext, text);
    if (!angelegt.ok) {
      fehler = angelegt.feld;
      return { ok: false, feld: Boolean(fehler) };
    }
    return { ok: planungZutatId === undefined || (await setzen(planungZutatId)) };
  }

  /**
   * Sets the typed shop of an ingredient of the Planung; whether it worked. After a conflict
   * saving again sets it over the shop chosen meanwhile.
   */
  export async function setzen(planungZutatId: number, erfolg?: string): Promise<boolean> {
    const etag =
      stand?.planungZutatId === planungZutatId
        ? stand.etag
        : (ansicht.zutaten.find((z) => z.id === planungZutatId)?.etag ?? '');
    const { ok, konflikt, geschrieben } = await geschaeftSetzen(
      kontext,
      planungZutatId,
      etag,
      text,
      erfolg
    );
    // Its own saved shop is the base of the next try (the line may have failed after it); a
    // shop chosen by someone else becomes the base only after the conflict was shown
    const jetzt = kontext.ansicht.zutaten.find((z) => z.id === planungZutatId);
    if ((konflikt || geschrieben) && jetzt) stand = { planungZutatId, etag: jetzt.etag };
    return ok;
  }
</script>

<FormField
  id="zeile-geschaeft"
  label="Geschäft"
  optional
  error={fehler}
  info="Gilt für die Zutat in allen Gerichten dieser Planung. Ein neuer Name legt das Geschäft an."
>
  {#snippet children(attrs)}
    <VorschlagFeld
      {...attrs}
      options={geschaeftVorschlaege(ansicht.geschaefte)}
      bind:value={text}
      listLabel="Geschäfte"
      placeholder="z. B. Metro"
      maxlength={80}
      onedit={bearbeitet}
      onpick={bearbeitet}
      autocomplete="off"
    />
  {/snippet}
</FormField>
