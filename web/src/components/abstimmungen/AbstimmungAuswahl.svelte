<script lang="ts">
  import type { AbstimmungOption } from '../../lib/abstimmungen';
  import { stimmenText } from '../../lib/abstimmungen';

  interface Props {
    /** Unique on the page; names the group of inputs. */
    id: string;
    optionen: AbstimmungOption[];
    /** At most this many with „Ja“; `null`: any number. */
    maxAuswahl: number | null;
    /** Each option can also be answered with „Vielleicht“. */
    vielleichtErlaubt: boolean;
    /** IDs of the options chosen with „Ja“. */
    gewaehlt: number[];
    /** IDs of the options chosen with „Vielleicht“. */
    vielleicht: number[];
    /** The votes per option are held back until enough people answered. */
    zahlenVerborgen?: boolean;
    disabled?: boolean;
  }
  let {
    id,
    optionen,
    maxAuswahl,
    vielleichtErlaubt,
    gewaehlt = $bindable(),
    vielleicht = $bindable(),
    zahlenVerborgen = false,
    disabled = false,
  }: Props = $props();

  /** One option only: radio buttons, as in a single choice. */
  const einzeln = $derived(maxAuswahl === 1 && !vielleichtErlaubt);
  /** No further „Ja“ until one is taken back. */
  const voll = $derived(maxAuswahl !== null && gewaehlt.length >= maxAuswahl);
  const legend = $derived.by(() => {
    if (einzeln) return 'Wähle eine Option';
    if (vielleichtErlaubt) return 'Sag bei jeder Option „Ja“, „Vielleicht“ oder „Nein“';
    return maxAuswahl === null
      ? 'Wähle alle Optionen, die für dich passen'
      : `Wähle bis zu ${maxAuswahl} Optionen`;
  });

  function setze(optionId: number, wert: 'ja' | 'vielleicht' | 'nein'): void {
    const ja = einzeln ? [] : gewaehlt.filter((o) => o !== optionId);
    const auch = vielleicht.filter((o) => o !== optionId);
    if (wert === 'ja') ja.push(optionId);
    if (wert === 'vielleicht') auch.push(optionId);
    // In the order of the options
    gewaehlt = optionen.map((o) => o.id).filter((o) => ja.includes(o));
    vielleicht = optionen.map((o) => o.id).filter((o) => auch.includes(o));
  }

  function zahlen(option: AbstimmungOption): string {
    if (zahlenVerborgen) return '';
    const text = stimmenText(option.stimmen);
    return option.vielleicht > 0 ? `${text}, ${option.vielleicht} vielleicht` : text;
  }
</script>

<fieldset {disabled} class="min-w-0">
  <legend class="font-semibold text-brand-900">{legend}</legend>
  {#if maxAuswahl !== null && !einzeln}
    <p class="mt-1 text-sm text-neutral-700" role="status">
      {gewaehlt.length} von {maxAuswahl}
      {vielleichtErlaubt ? 'mit „Ja“ gewählt' : 'gewählt'}
    </p>
  {/if}
  <ul class="mt-2 divide-y divide-neutral-200 border-y border-neutral-200">
    {#each optionen as option (option.id)}
      {@const ja = gewaehlt.includes(option.id)}
      {#if vielleichtErlaubt}
        {@const wert = ja ? 'ja' : vielleicht.includes(option.id) ? 'vielleicht' : 'nein'}
        <li class="py-2">
          <fieldset class="min-w-0">
            <legend class="flex w-full flex-wrap items-baseline justify-between gap-x-3">
              <span class="min-w-0 [overflow-wrap:anywhere]">{option.text}</span>
              <span class="text-sm text-neutral-700">{zahlen(option)}</span>
            </legend>
            <div class="mt-1 flex flex-wrap gap-x-5">
              {#each [['ja', 'Ja'], ['vielleicht', 'Vielleicht'], ['nein', 'Nein']] as const as [value, label] (value)}
                <label
                  class="form-check-row flex min-h-11 cursor-pointer items-center gap-2"
                  class:opacity-60={value === 'ja' && voll && !ja}
                >
                  <input
                    class="form-check shrink-0"
                    type="radio"
                    name="{id}-option-{option.id}"
                    {value}
                    checked={wert === value}
                    disabled={value === 'ja' && voll && !ja}
                    onchange={() => setze(option.id, value)}
                  />
                  <span>{label}</span>
                </label>
              {/each}
            </div>
          </fieldset>
        </li>
      {:else}
        <li>
          <label
            class="form-check-row flex min-h-11 cursor-pointer items-center gap-3 py-2"
            class:opacity-60={!einzeln && voll && !ja}
          >
            <input
              class="form-check shrink-0"
              type={einzeln ? 'radio' : 'checkbox'}
              name="{id}-auswahl"
              value={option.id}
              checked={ja}
              disabled={!einzeln && voll && !ja}
              onchange={(event) => setze(option.id, event.currentTarget.checked ? 'ja' : 'nein')}
            />
            <span class="min-w-0 flex-1 [overflow-wrap:anywhere]">{option.text}</span>
            <span class="shrink-0 text-sm text-neutral-700">{zahlen(option)}</span>
          </label>
        </li>
      {/if}
    {/each}
  </ul>
  {#if einzeln && gewaehlt.length > 0}
    <button
      type="button"
      class="mt-1 min-h-11 text-sm font-semibold text-link underline"
      onclick={() => (gewaehlt = [])}>Auswahl aufheben</button
    >
  {/if}
</fieldset>
