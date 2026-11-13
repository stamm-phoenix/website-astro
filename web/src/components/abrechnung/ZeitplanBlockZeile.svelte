<script lang="ts">
  import { MAX_ZEITBLOCK_TEXT, kurzerWochentag, tagTitel } from '../../lib/kurzbeschreibung';
  import type { ZeitBlock, ZeitplanTag } from '../../lib/kurzbeschreibung';

  interface Props {
    block: ZeitBlock;
    tagIndex: number;
    index: number;
    /** Number of blocks of the day. */
    anzahl: number;
    first: boolean;
    last: boolean;
    vortag: ZeitplanTag | null;
    nachtag: ZeitplanTag | undefined;
    dragging: boolean;
    dropBefore: boolean;
    dropAfter: boolean;
    setField: (tagIndex: number, id: string, field: 'von' | 'bis' | 'text', value: string) => void;
    move: (tagIndex: number, index: number, delta: -1 | 1) => void;
    remove: (tagIndex: number, index: number) => void;
    onDragStart: (event: DragEvent, tagIndex: number, index: number, id: string) => void;
    onDragOver: (event: DragEvent, tagIndex: number, index: number) => void;
    onDrop: (event: DragEvent) => void;
    endDrag: () => void;
    onTextKey: (event: KeyboardEvent, tagIndex: number, index: number) => void;
  }
  let {
    block,
    tagIndex,
    index,
    anzahl,
    first,
    last,
    vortag,
    nachtag,
    dragging,
    dropBefore,
    dropAfter,
    setField,
    move,
    remove,
    onDragStart,
    onDragOver,
    onDrop,
    endDrag,
    onTextKey,
  }: Props = $props();
</script>

{#snippet arrow(direction: 'up' | 'down')}
  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="currentColor">
    {#if direction === 'up'}
      <path d="M10 4 4 10.5l1.4 1.4L9 8.3V16h2V8.3l3.6 3.6 1.4-1.4z" />
    {:else}
      <path d="m10 16 6-6.5-1.4-1.4L11 11.7V4H9v7.7L5.4 8.1 4 9.5z" />
    {/if}
  </svg>
{/snippet}

<li
  class="zeitplan-block flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm py-1
      {dragging ? 'opacity-40' : ''}
      {dropBefore ? 'drop-before' : ''}
    {dropAfter ? 'drop-after' : ''}"
  ondragover={(e) => onDragOver(e, tagIndex, index)}
  ondrop={onDrop}
>
  <span
    class="hidden cursor-grab touch-none select-none self-stretch px-1 text-neutral-700 sm:flex sm:items-center"
    draggable="true"
    aria-hidden="true"
    title="Ziehen zum Verschieben"
    ondragstart={(e) => onDragStart(e, tagIndex, index, block.id)}
    ondragend={endDrag}
  >
    <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor">
      <circle cx="7" cy="5" r="1.5" /><circle cx="13" cy="5" r="1.5" />
      <circle cx="7" cy="10" r="1.5" /><circle cx="13" cy="10" r="1.5" />
      <circle cx="7" cy="15" r="1.5" /><circle cx="13" cy="15" r="1.5" />
    </svg>
  </span>
  <div class="flex items-center gap-1">
    <input
      id={`block-${block.id}-von`}
      type="time"
      step="300"
      class="form-input mt-0! w-[6.75rem] tabular-nums"
      aria-label={`Beginn von „${block.text || 'neuer Block'}“`}
      value={block.von}
      oninput={(e) => setField(tagIndex, block.id, 'von', e.currentTarget.value)}
    />
    <span aria-hidden="true" class="text-neutral-700">–</span>
    <input
      id={`block-${block.id}-bis`}
      type="time"
      step="300"
      class="form-input mt-0! w-[6.75rem] tabular-nums"
      aria-label={`Ende von „${block.text || 'neuer Block'}“`}
      value={block.bis}
      oninput={(e) => setField(tagIndex, block.id, 'bis', e.currentTarget.value)}
    />
  </div>
  <input
    id={`block-${block.id}-text`}
    type="text"
    class="form-input order-last mt-0! w-full sm:order-none sm:w-auto sm:flex-1"
    aria-label="Programmpunkt"
    maxlength={MAX_ZEITBLOCK_TEXT}
    placeholder="z. B. Geländespiel"
    enterkeyhint="next"
    value={block.text}
    oninput={(e) => setField(tagIndex, block.id, 'text', e.currentTarget.value)}
    onkeydown={(e) => onTextKey(e, tagIndex, index)}
  />
  <div class="ml-auto flex">
    <button
      type="button"
      id={`block-${block.id}-hoch`}
      class="zeitplan-icon"
      disabled={first}
      aria-label={index === 0 && vortag
        ? `„${block.text || 'Block'}“ auf ${tagTitel(vortag.datum)} verschieben`
        : `„${block.text || 'Block'}“ nach oben`}
      title={index === 0 && vortag
        ? `Auf ${kurzerWochentag(vortag.datum)} verschieben`
        : 'Nach oben'}
      onclick={() => move(tagIndex, index, -1)}>{@render arrow('up')}</button
    >
    <button
      type="button"
      id={`block-${block.id}-runter`}
      class="zeitplan-icon"
      disabled={last}
      aria-label={index === anzahl - 1 && nachtag
        ? `„${block.text || 'Block'}“ auf ${tagTitel(nachtag.datum)} verschieben`
        : `„${block.text || 'Block'}“ nach unten`}
      title={index === anzahl - 1 && nachtag
        ? `Auf ${kurzerWochentag(nachtag.datum)} verschieben`
        : 'Nach unten'}
      onclick={() => move(tagIndex, index, 1)}>{@render arrow('down')}</button
    >
    <button
      type="button"
      class="zeitplan-icon text-danger"
      aria-label={`„${block.text || 'Block'}“ löschen`}
      title="Löschen"
      onclick={() => remove(tagIndex, index)}
    >
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="currentColor">
        <path d="M8 3h4l1 1h3v2H4V4h3zm-2 4h8l-.7 9.1a1 1 0 0 1-1 .9H7.7a1 1 0 0 1-1-.9z" />
      </svg>
    </button>
  </div>
</li>

<style>
  .zeitplan-icon {
    display: inline-flex;
    min-height: 2.75rem;
    min-width: 2.75rem;
    align-items: center;
    justify-content: center;
    border-radius: 0.25rem;
    color: var(--color-brand-900);
  }
  .zeitplan-icon:hover:not(:disabled) {
    background: var(--color-field);
  }
  .zeitplan-icon:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 1px;
  }
  .zeitplan-icon:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .drop-before {
    box-shadow: inset 0 3px 0 var(--color-brand-900);
  }
  .drop-after {
    box-shadow: inset 0 -3px 0 var(--color-brand-900);
  }
</style>
