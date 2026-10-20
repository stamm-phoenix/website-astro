<script lang="ts">
  import { unseenCount } from '../../lib/staffChangelogStore.svelte';

  interface Props {
    /** Sits on the corner of the icon above it instead of in the line. */
    floating?: boolean;
    /** ID of the hidden text, for a control that must keep its name and only describe the count. */
    textId?: string;
  }
  let { floating = false, textId }: Props = $props();

  const count = $derived(unseenCount());
</script>

{#if count > 0}
  <span
    class="changelog-badge {floating ? 'changelog-badge-floating' : ''}"
    data-testid="changelog-badge"
    aria-hidden="true">{count > 9 ? '9+' : count}</span
  >
  <!-- Hidden text still describes a control through aria-describedby, without joining its name -->
  <span id={textId} class={textId ? undefined : 'sr-only'} hidden={textId ? true : undefined}>
    {count === 1 ? 'Eine neue Neuigkeit' : `${count} neue Neuigkeiten`}
  </span>
{/if}

<style>
  .changelog-badge {
    display: inline-flex;
    min-width: 1.25rem;
    height: 1.25rem;
    align-items: center;
    justify-content: center;
    padding: 0 0.3rem;
    border-radius: 9999px;
    background: var(--color-dpsg-red);
    color: #fff;
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1;
    box-shadow: 0 0 0 2px var(--color-surface);
  }
  .changelog-badge-floating {
    position: absolute;
    top: 0.25rem;
    left: calc(50% + 0.5rem);
    pointer-events: none;
  }
</style>
