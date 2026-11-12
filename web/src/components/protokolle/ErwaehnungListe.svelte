<script lang="ts">
  import { PERSON_GRUPPE_LABELS } from '../../lib/protokollEditor';
  import type { ErwaehnungAuswahl } from '../../lib/erwaehnungAuswahl.svelte';

  interface Props {
    auswahl: ErwaehnungAuswahl;
    /** Window coordinates below the `@`; without them the list follows the text field. */
    position?: { left: number; top: number } | null;
  }
  let { auswahl, position = null }: Props = $props();
</script>

{#if auswahl.offen}
  <ul
    id={auswahl.id}
    class="erwaehnung-liste"
    class:is-schwebend={position !== null}
    style:left={position ? `${position.left}px` : undefined}
    style:top={position ? `${position.top}px` : undefined}
    role="listbox"
    aria-label="Person erwähnen"
  >
    {#each auswahl.treffer as person, index (person.login)}
      <!-- The text field keeps the focus and the keys; the mouse only picks -->
      <li
        id="{auswahl.id}-{index}"
        role="option"
        aria-selected={index === auswahl.aktiv}
        class:is-aktiv={index === auswahl.aktiv}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => auswahl.waehle(index)}
        onkeydown={() => undefined}
        onmouseenter={() => (auswahl.aktiv = index)}
      >
        <span class="name">{person.name}</span>
        <span class="gruppe">{PERSON_GRUPPE_LABELS[person.gruppe]}</span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .erwaehnung-liste {
    z-index: 30;
    margin-top: 0.25rem;
    max-width: min(22rem, calc(100vw - 2rem));
    overflow: hidden;
    border: 1px solid var(--color-neutral-300);
    border-radius: 0.375rem;
    background: var(--color-surface);
    box-shadow: 0 6px 16px rgb(0 0 0 / 0.15);
  }
  .erwaehnung-liste.is-schwebend {
    position: fixed;
    margin-top: 0;
    min-width: 14rem;
  }
  li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.4rem 0.75rem;
    cursor: pointer;
  }
  li.is-aktiv {
    background: var(--color-brand-100);
  }
  .name {
    color: var(--color-brand-900);
  }
  .gruppe {
    font-size: 0.75rem;
    color: var(--color-neutral-700);
  }
</style>
