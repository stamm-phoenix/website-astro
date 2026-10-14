<script lang="ts">
  import { parseProtokollText } from '../../lib/protokollEditor';
  import type { TextSpan } from '../../lib/types';

  interface Props {
    text: string;
  }
  let { text }: Props = $props();

  // Rendered as Svelte text nodes, never as HTML
  const blocks = $derived(parseProtokollText(text));
</script>

{#snippet spans(parts: TextSpan[])}
  {#each parts as part, index (index)}
    {#if part.bold}<strong>{part.text}</strong>{:else}{part.text}{/if}
  {/each}
{/snippet}

{#each blocks as block, index (index)}
  {#if block.kind === 'liste'}
    <ul class="list-disc space-y-1 pl-6">
      {#each block.items as item, itemIndex (itemIndex)}
        <li>{@render spans(item)}</li>
      {/each}
    </ul>
  {:else}
    <p>
      {#each block.lines as line, lineIndex (lineIndex)}
        {#if lineIndex > 0}<br />{/if}{@render spans(line)}
      {/each}
    </p>
  {/if}
{/each}
