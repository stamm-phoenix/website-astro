<script lang="ts" module>
  /** A person to offer; `gruppe` is the heading the person is listed under, if any. */
  export interface SuchPerson {
    login: string;
    name: string;
    gruppe?: string;
  }
</script>

<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import VorschlagFeld from './VorschlagFeld.svelte';
  import type { Vorschlag } from '../../lib/vorschlaege';

  /**
   * Search field with a list of matching people, shared by the Aufgaben and the
   * Protokoll-Editor: `VorschlagFeld` that searches name and login, takes the first match with
   * Enter and empties itself after a pick. The caller shows the chosen people and decides what
   * happens with typed text that matches no one (`oncommit`).
   */
  interface Props extends Omit<
    HTMLInputAttributes,
    'value' | 'onkeydown' | 'oninput' | 'onfocus' | 'onblur' | 'role' | 'list'
  > {
    id: string;
    /** People that may be picked; those already chosen are left out by the caller. */
    options: SuchPerson[];
    query?: string;
    input?: HTMLInputElement | null;
    /** Most matches shown at once. */
    maxResults?: number;
    listLabel?: string;
    onpick: (person: SuchPerson) => void;
    /**
     * Typed text confirmed by leaving the field, or with Enter while the list is closed (no
     * match, or closed with Escape).
     */
    oncommit?: (text: string) => void;
    /** Backspace in the empty field, to remove the last chosen person. */
    onremovelast?: () => void;
    /** Any typing, before the list updates. */
    onedit?: () => void;
    /** See `VorschlagFeld`. */
    commitAfterTap?: boolean;
  }
  let {
    options,
    query = $bindable(''),
    input = $bindable(null),
    listLabel = 'Person auswählen',
    onpick,
    onedit,
    ...rest
  }: Props = $props();

  let field = $state<VorschlagFeld | null>(null);

  const key = (person: SuchPerson): string => `${person.login}|${person.name}`;
  const vorschlaege = $derived(
    options.map((person): Vorschlag => ({
      value: person.name,
      search: person.login,
      gruppe: person.gruppe,
      key: key(person),
    }))
  );

  /** Close suggestions after a surrounding form has reported an error. */
  export function close(): void {
    field?.close();
  }
</script>

<VorschlagFeld
  bind:this={field}
  {...rest}
  bind:value={query}
  bind:input
  options={vorschlaege}
  {listLabel}
  clearOnPick
  pickFirstOnEnter
  onedit={() => onedit?.()}
  onpick={(option) => {
    const person = options.find((p) => key(p) === option.key);
    if (person) onpick(person);
  }}
/>
