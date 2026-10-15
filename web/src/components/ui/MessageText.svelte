<script lang="ts">
  import { HELP_CONTACTS } from '../../lib/helpContacts';

  interface Props {
    /** A result or error text; help addresses in it become mail links. */
    text: string;
  }

  let { text }: Props = $props();

  const ADDRESSES: readonly string[] = Object.values(HELP_CONTACTS);
  const SPLIT = new RegExp(`(${ADDRESSES.map((a) => a.replace(/[.]/g, '\\.')).join('|')})`);

  const parts = $derived(text.split(SPLIT));
</script>

{#each parts as part, index (index)}{#if ADDRESSES.includes(part)}<a
      href="mailto:{part}"
      class="text-link underline">{part}</a
    >{:else}{part}{/if}{/each}
