<script lang="ts">
  import { untrack } from 'svelte';
  import VorschlagFeld from '../ui/VorschlagFeld.svelte';
  import { einheitText, normalisiereEinheit } from '../../../../api/lib/essen-gerichte-model';
  import { einheitenVorschlaege } from '../../lib/essensplanungEinheiten';
  import type { EssenEinheitenart, GerichtEinheit } from '../../lib/types';

  /**
   * The unit of an amount: a field with suggestions (the ingredient's units first, then all
   * others and the kitchen units), any typed unit allowed („Dose“, „EL“). `einheit` is the unit as
   * stored (`normalisiereEinheit`), empty while nothing is typed. Enter and Escape reach
   * `onkeydown` unless they pick a suggestion or close the list.
   */

  interface Props {
    id: string;
    einheit: GerichtEinheit;
    /** The kind of unit of the ingredient, whose units come first. */
    art?: EssenEinheitenart | null;
    /** Units of one's own the Planung uses already. */
    eigene?: readonly string[];
    abtropfgewicht?: boolean;
    disabled?: boolean;
    invalid?: boolean;
    class?: string;
    wrapperClass?: string;
    onkeydown?: (event: KeyboardEvent) => void;
  }
  let {
    id,
    einheit = $bindable(),
    art = null,
    eigene = [],
    abtropfgewicht = false,
    disabled = false,
    invalid = false,
    class: className = 'form-input',
    wrapperClass = '',
    onkeydown,
  }: Props = $props();

  let text = $state(untrack(() => (einheit ? einheitText(einheit, abtropfgewicht) : '')));
  /** Typed since the field got the focus: only then the suggestions narrow down. */
  let getippt = $state(false);

  // A unit set from outside (another ingredient, a reset) shows in the field, „g (ATG)“ for an
  // ingredient by drained weight; typed text that means the same unit stays as typed
  $effect(() => {
    const aussen = einheit;
    const anzeige = aussen ? einheitText(aussen, abtropfgewicht) : '';
    untrack(() => {
      const gleich = (normalisiereEinheit(text) ?? '') === aussen;
      if (!gleich || (!getippt && text !== anzeige)) text = anzeige;
    });
  });

  const vorschlaege = $derived(einheitenVorschlaege(art, eigene, abtropfgewicht));

  function taste(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== 'Escape') {
      onkeydown?.(event);
      return;
    }
    // After the list: a highlighted suggestion is taken first, an open list closes first
    queueMicrotask(() => {
      if (!event.defaultPrevented) onkeydown?.(event);
    });
  }
</script>

<VorschlagFeld
  {id}
  class={className}
  {wrapperClass}
  options={vorschlaege}
  bind:value={text}
  filter={getippt ? text : ''}
  maxResults={40}
  listLabel="Einheiten"
  placeholder="Einheit"
  maxlength={30}
  spellcheck="false"
  {disabled}
  aria-invalid={invalid ? 'true' : undefined}
  onfocus={() => (getippt = false)}
  onedit={(neu) => {
    getippt = true;
    einheit = normalisiereEinheit(neu) ?? '';
  }}
  onkeydown={taste}
/>
