<script lang="ts">
  import { parseProtokollMarkdown } from '../../lib/protokollMarkdown';
  import type { MdAlign, MdBlock, MdInline } from '../../lib/protokollMarkdown';

  interface Props {
    text: string;
    /** Level of a `# ` heading in the text; below the heading of its agenda item. */
    headingLevel?: number;
  }
  let { text, headingLevel = 4 }: Props = $props();

  // Rendered as Svelte elements and text nodes, never as HTML
  const blocks = $derived(parseProtokollMarkdown(text));

  function heading(depth: number): string {
    return `h${Math.min(6, headingLevel + depth - 1)}`;
  }

  function align(value: MdAlign): string | undefined {
    return value ?? undefined;
  }
</script>

{#snippet inline(nodes: MdInline[])}
  {#each nodes as node, index (index)}
    {#if node.type === 'text'}{node.text}{:else if node.type === 'br'}<br
      />{:else if node.type === 'code'}<code class="md-code">{node.text}</code
      >{:else if node.type === 'strong'}<strong>{@render inline(node.children)}</strong
      >{:else if node.type === 'em'}<em>{@render inline(node.children)}</em
      >{:else if node.type === 'del'}<del>{@render inline(node.children)}</del
      >{:else if node.type === 'link'}<a
        class="text-link"
        href={node.href}
        target="_blank"
        rel="noopener noreferrer">{@render inline(node.children)}</a
      >{/if}
  {/each}
{/snippet}

{#snippet blockList(list: MdBlock[])}
  {#each list as block, index (index)}
    {#if block.type === 'paragraph'}
      <p>{@render inline(block.children)}</p>
    {:else if block.type === 'heading'}
      <svelte:element this={heading(block.depth)} class="md-heading">
        {@render inline(block.children)}
      </svelte:element>
    {:else if block.type === 'list'}
      {@const tasks = block.items.some((item) => item.checked !== null)}
      <svelte:element
        this={block.ordered ? 'ol' : 'ul'}
        class="md-list"
        class:list-decimal={block.ordered}
        class:list-disc={!block.ordered && !tasks}
        class:is-tasks={tasks}
        start={block.ordered && block.start !== 1 ? block.start : undefined}
      >
        {#each block.items as item, itemIndex (itemIndex)}
          <li class:is-task={item.checked !== null}>
            {#if item.checked !== null}
              <span class="md-check" class:is-checked={item.checked} aria-hidden="true">
                {#if item.checked}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"
                    ><path d="M5 12l5 5L19 7" /></svg
                  >
                {/if}
              </span>
              <span class="sr-only">{item.checked ? 'Erledigt:' : 'Offen:'}</span>
            {/if}
            <div class="md-item">{@render blockList(item.blocks)}</div>
          </li>
        {/each}
      </svelte:element>
    {:else if block.type === 'code'}
      <pre class="md-pre"><code>{block.text}</code></pre>
    {:else if block.type === 'quote'}
      <blockquote class="md-quote">{@render blockList(block.blocks)}</blockquote>
    {:else if block.type === 'hr'}
      <hr class="md-hr" />
    {:else if block.type === 'table'}
      <div class="md-table-wrap">
        <table class="md-table">
          <thead>
            <tr>
              {#each block.header as cell, cellIndex (cellIndex)}
                <th scope="col" style:text-align={align(block.align[cellIndex])}
                  >{@render inline(cell)}</th
                >
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each block.rows as row, rowIndex (rowIndex)}
              <tr>
                {#each row as cell, cellIndex (cellIndex)}
                  <td style:text-align={align(block.align[cellIndex])}>{@render inline(cell)}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/each}
{/snippet}

<div class="protokoll-text">
  {@render blockList(blocks)}
</div>

<style>
  .protokoll-text {
    display: flex;
    flex-direction: column;
    gap: 0.6em;
    overflow-wrap: anywhere;
  }
  .protokoll-text :global(.md-item) {
    display: flex;
    flex-direction: column;
    gap: 0.35em;
  }
  .md-list {
    display: flex;
    flex-direction: column;
    gap: 0.25em;
    padding-left: 1.5em;
  }
  .md-list.is-tasks {
    list-style: none;
    padding-left: 0.25em;
  }
  .md-list .md-list {
    margin-top: 0.25em;
  }
  li.is-task {
    display: flex;
    align-items: flex-start;
    gap: 0.5em;
  }
  .md-check {
    display: inline-grid;
    flex: none;
    place-items: center;
    width: 1.05em;
    height: 1.05em;
    margin-top: 0.25em;
    border: 1.5px solid var(--color-neutral-500, currentColor);
    border-radius: 0.2em;
  }
  .md-check.is-checked {
    border-color: var(--color-success);
    background: var(--color-success);
    color: var(--color-surface);
  }
  .md-check svg {
    width: 0.8em;
    height: 0.8em;
  }
  .md-heading {
    margin-top: 0.4em;
    font-weight: 600;
    color: var(--color-brand-900);
  }
  .md-code,
  .md-pre {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.875em;
    background: var(--color-neutral-100);
    border-radius: var(--radius-sm, 0.25rem);
  }
  .md-code {
    padding: 0.1em 0.3em;
  }
  .md-pre {
    padding: 0.75em 1em;
    overflow-x: auto;
    white-space: pre;
  }
  .md-quote {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
    border-left: 3px solid var(--color-neutral-300);
    padding-left: 0.9em;
    color: var(--color-neutral-700);
  }
  .md-hr {
    border: 0;
    border-top: 1px solid var(--color-neutral-200);
    margin: 0.4em 0;
  }
  .md-table-wrap {
    max-width: 100%;
    overflow-x: auto;
  }
  .md-table {
    border-collapse: collapse;
    font-size: 0.95em;
  }
  .md-table th,
  .md-table td {
    border: 1px solid var(--color-neutral-200);
    padding: 0.35em 0.65em;
    text-align: left;
    vertical-align: top;
  }
  .md-table th {
    background: var(--color-neutral-100);
    font-weight: 600;
  }
</style>
