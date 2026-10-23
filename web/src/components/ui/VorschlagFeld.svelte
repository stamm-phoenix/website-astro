<script lang="ts">
  import { getContext, tick } from 'svelte';
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { filterVorschlaege, trefferTeile, type Vorschlag } from '../../lib/vorschlaege';

  /**
   * Text field with suggestions (ARIA combobox with listbox), instead of the browser's datalist,
   * which phones hardly show. Suggestions are an offer: any typed text stays possible. By
   * default a picked suggestion becomes the value; with `clearOnPick` it goes to `onpick` and
   * the field empties for the next one (people, Merkmale).
   */
  interface Props extends Omit<
    HTMLInputAttributes,
    'value' | 'onkeydown' | 'oninput' | 'onfocus' | 'onblur' | 'role' | 'list'
  > {
    id: string;
    options: Vorschlag[];
    value?: string;
    input?: HTMLInputElement | null;
    /** The suggestions are still being loaded. */
    loading?: boolean;
    /** Most matches shown at once. */
    maxResults?: number;
    listLabel?: string;
    /** Empty the field after a pick, which then only goes to `onpick`. */
    clearOnPick?: boolean;
    /** Enter takes the first match even when none is highlighted (search for people). */
    pickFirstOnEnter?: boolean;
    onpick?: (option: Vorschlag) => void;
    /**
     * Typed text confirmed by leaving the field, or with Enter while no suggestion is
     * highlighted. Without it, Enter acts as in a plain field.
     */
    oncommit?: (text: string) => void;
    /** Backspace in the empty field, to remove the last chosen entry. */
    onremovelast?: () => void;
    /** Any typing, with the new text, before the list updates. */
    onedit?: (text: string) => void;
    onfocus?: () => void;
    /** Runs first; a handler that calls `preventDefault` skips the list's own keys. */
    onkeydown?: (event: KeyboardEvent) => void;
    /**
     * Take typed text over only after a tap that left the field, so a button that moves when an
     * entry is added still gets the tap. Only for callers whose own actions take the text over
     * first (a submit), since a button's handler runs before the deferred `oncommit`.
     */
    commitAfterTap?: boolean;
    /** Classes of the element around field and list, e.g. to size it in a flex row. */
    wrapperClass?: string;
  }
  let {
    id,
    options,
    value = $bindable(''),
    input = $bindable(null),
    loading = false,
    maxResults = 8,
    listLabel = 'Vorschläge',
    clearOnPick = false,
    pickFirstOnEnter = false,
    onpick,
    oncommit,
    onremovelast,
    onedit,
    onfocus,
    onkeydown,
    commitAfterTap = false,
    wrapperClass = '',
    class: className = 'form-input',
    disabled,
    ...rest
  }: Props = $props();

  const notifyEdited = getContext<(() => void) | undefined>('form-edited');

  let open = $state(false);
  let focused = $state(false);
  let active = $state(-1);
  let popup = $state<HTMLElement | null>(null);
  /** Height left between the field and the bottom of the visible screen (keyboard). */
  let maxHeight = $state<number | null>(null);

  const result = $derived(filterVorschlaege(options, value, maxResults));
  const matches = $derived(result.matches);
  const more = $derived(result.total - matches.length);
  /** Matches by heading, in the order the options came in. */
  const groups = $derived.by(() => {
    const list: { label: string; items: { option: Vorschlag; index: number }[] }[] = [];
    matches.forEach((option, index) => {
      const label = option.gruppe ?? '';
      const group = list.find((g) => g.label === label);
      if (group) group.items.push({ option, index });
      else list.push({ label, items: [{ option, index }] });
    });
    return list;
  });
  const expanded = $derived(open && matches.length > 0 && !disabled);
  const showLoading = $derived(open && !disabled && loading && matches.length === 0);
  const announcement = $derived.by(() => {
    if (!focused || !open || disabled) return '';
    if (showLoading) return 'Vorschläge werden geladen';
    if (result.total === 1) return '1 Vorschlag';
    if (result.total) return `${result.total} Vorschläge`;
    return value.trim() && options.length ? 'Keine Vorschläge' : '';
  });

  // New text, also when a caller takes it over (comma in TagInput): no stale highlight
  $effect(() => {
    void value;
    active = -1;
  });

  /** Close suggestions after a surrounding form has reported an error. */
  export function close(): void {
    open = false;
    active = -1;
  }

  function show(): void {
    open = true;
    active = -1;
  }

  function pick(option: Vorschlag): void {
    if (clearOnPick) value = '';
    else value = option.value;
    active = -1;
    open = false;
    onpick?.(option);
    if (!clearOnPick) {
      onedit?.(value);
      notifyEdited?.();
    }
  }

  /** Whether a finger or mouse button is down, for `commitAfterTap`. */
  let pressing = false;

  /** Typed text is taken over when the field is left; with `commitAfterTap` after the tap. */
  function leave(): void {
    open = false;
    focused = false;
    if (!oncommit) return;
    if (!commitAfterTap || !pressing) {
      if (value.trim()) oncommit(value);
      return;
    }
    const done = (): void => {
      window.removeEventListener('pointerup', done, true);
      window.removeEventListener('pointercancel', done, true);
      // After the click of the same tap; a submit may have taken the text over already
      setTimeout(() => {
        if (value.trim() && document.activeElement !== input) oncommit(value);
      });
    };
    window.addEventListener('pointerup', done, true);
    window.addEventListener('pointercancel', done, true);
  }

  function keydown(event: KeyboardEvent): void {
    onkeydown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Escape' && (expanded || showLoading)) {
      event.preventDefault();
      event.stopPropagation();
      open = false;
    } else if (matches.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const down = event.key === 'ArrowDown';
      if (!expanded) {
        open = true;
        active = down ? 0 : matches.length - 1;
      } else {
        active =
          active < 0
            ? down
              ? 0
              : matches.length - 1
            : (active + (down ? 1 : -1) + matches.length) % matches.length;
      }
    } else if (event.key === 'Enter') {
      const option = matches[Math.max(0, active)];
      if (expanded && option && (active >= 0 || (pickFirstOnEnter && value.trim()))) {
        event.preventDefault();
        pick(option);
      } else if (oncommit) {
        open = false;
        if (!value.trim()) return;
        event.preventDefault();
        oncommit(value);
      } else {
        open = false;
      }
    } else if (event.key === 'Tab' && expanded && matches[active]) {
      // Focus moves on; the highlighted suggestion is taken along
      pick(matches[active]);
    } else if (event.key === 'Backspace' && !value && onremovelast) {
      event.preventDefault();
      onremovelast();
    }
  }

  /** Keeps the list above the on-screen keyboard: shorter, or the field scrolled up. */
  function fit(scroll: boolean): void {
    if (!input || !open) return;
    const viewport = window.visualViewport;
    let bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    // The fixed bar at the bottom of the Leitendenbereich covers the list on smaller screens
    const bar = document.querySelector('.staff-bottom-bar');
    if (bar && getComputedStyle(bar).display !== 'none')
      bottom = Math.min(bottom, bar.getBoundingClientRect().top);
    // A scrolling dialog body cuts the list off before the screen does
    for (let el = input.parentElement; el && el !== document.body; el = el.parentElement) {
      if (/auto|scroll|hidden|clip/.test(getComputedStyle(el).overflowY))
        bottom = Math.min(bottom, el.getBoundingClientRect().bottom);
    }
    const space = bottom - input.getBoundingClientRect().bottom - 12;
    // Room for three entries at least; otherwise move the field up first
    if (space < 3 * 44 && scroll) {
      // Instant despite the smooth scrolling of the page, so the room below is measured after it
      input.scrollIntoView({ block: 'start', behavior: 'instant' });
      void tick().then(() => fit(false));
      return;
    }
    // Never taller than the room left, but one entry stays reachable
    maxHeight = Math.max(44, Math.min(space, 16 * 16));
  }

  $effect(() => {
    if (!(expanded || showLoading)) return;
    void tick().then(() => fit(true));
    const viewport = window.visualViewport;
    // The keyboard of a phone opens after the focus and shrinks the visible screen
    const refit = (): void => fit(true);
    viewport?.addEventListener('resize', refit);
    window.addEventListener('resize', refit);
    return () => {
      viewport?.removeEventListener('resize', refit);
      window.removeEventListener('resize', refit);
    };
  });

  // The highlighted entry stays in view while moving with the arrow keys
  $effect(() => {
    if (!expanded || active < 0) return;
    popup?.querySelector(`#${CSS.escape(`${id}-option-${active}`)}`)?.scrollIntoView({
      block: 'nearest',
    });
  });
</script>

<svelte:window
  onpointerdowncapture={() => (pressing = true)}
  onpointerupcapture={() => setTimeout(() => (pressing = false))}
  onpointercancelcapture={() => setTimeout(() => (pressing = false))}
/>

<div class="relative {wrapperClass}">
  <input
    bind:this={input}
    {...rest}
    {id}
    class={className}
    bind:value
    autocomplete="off"
    role="combobox"
    aria-autocomplete="list"
    aria-expanded={expanded}
    aria-controls="{id}-options"
    aria-activedescendant={expanded && active >= 0 ? `${id}-option-${active}` : undefined}
    {disabled}
    oninput={(event) => {
      onedit?.(event.currentTarget.value);
      show();
    }}
    onfocus={() => {
      // The list opens on a tap or typing, not when a script moves the focus here
      focused = true;
      onfocus?.();
    }}
    onclick={() => {
      if (!open) show();
    }}
    onblur={leave}
    onkeydown={keydown}
  />
  <!-- svelte-ignore a11y_no_static_element_interactions (a tap on the hint or a heading keeps the focus in the field) -->
  <div
    bind:this={popup}
    hidden={!(expanded || showLoading)}
    class="surface absolute z-30 mt-1 w-full overflow-y-auto overscroll-contain rounded-lg shadow-lg"
    style:max-height={maxHeight ? `${maxHeight}px` : '16rem'}
    onpointerdown={(event) => event.preventDefault()}
  >
    <ul id="{id}-options" role="listbox" aria-label={listLabel}>
      {#each groups as group (group.label)}
        {#snippet items()}
          {#each group.items as { option, index } (option.key ?? option.value)}
            <li role="none">
              <button
                type="button"
                role="option"
                id="{id}-option-{index}"
                aria-selected={active === index}
                tabindex="-1"
                class="flex min-h-11 w-full items-center break-words px-3 py-2 text-left hover:bg-neutral-100"
                class:bg-neutral-100={active === index}
                onclick={() => pick(option)}
                ><span
                  >{#each trefferTeile(option.label ?? option.value, value) as part, partIndex (partIndex)}{#if part.hit}<mark
                        class="treffer">{part.text}</mark
                      >{:else}{part.text}{/if}{/each}</span
                ></button
              >
            </li>
          {/each}
        {/snippet}
        {#if group.label}
          <li role="group" aria-label={group.label}>
            <span
              class="block px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-neutral-700 uppercase"
              aria-hidden="true">{group.label}</span
            >
            <ul role="none">{@render items()}</ul>
          </li>
        {:else}
          {@render items()}
        {/if}
      {/each}
    </ul>
    {#if showLoading}
      <p class="flex min-h-11 items-center px-3 py-2 text-sm text-neutral-700">
        Vorschläge werden geladen …
      </p>
    {:else if expanded && more > 0}
      <p class="border-t border-neutral-200 px-3 py-2 text-sm text-neutral-700">
        {more}
        {more === 1 ? 'weiterer' : 'weitere'} – tippe weiter, um einzugrenzen.
      </p>
    {/if}
  </div>
  <span class="sr-only" role="status" aria-live="polite">{announcement}</span>
</div>

<style>
  .treffer {
    background: transparent;
    color: inherit;
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
