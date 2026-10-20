<script lang="ts">
  import {
    RELOGIN_URL,
    SESSION_EXPIRED_MESSAGE,
    reloginHereUrl,
    reloginOnlyHere,
  } from '../../lib/api';
  import { HELP_CONTACTS } from '../../lib/helpContacts';

  interface Props {
    /** A result or error text; help addresses in it become mail links. */
    text: string;
  }

  let { text }: Props = $props();

  const ADDRESSES: readonly string[] = Object.values(HELP_CONTACTS);
  const SPLIT = new RegExp(
    `(${ADDRESSES.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`
  );

  const parts = $derived(text.split(SPLIT));
</script>

{#each parts as part, index (index)}{#if ADDRESSES.includes(part)}<a
      href="mailto:{part}"
      class="text-link underline">{part}</a
    >{:else}{part}{/if}{/each}{#if text.includes(SESSION_EXPIRED_MESSAGE) && reloginOnlyHere()}
  <span class="mt-2 block">
    In der App auf dem Home-Bildschirm lädt das Anmelden diese Seite neu. Kopiere vorher, was du
    behalten willst.
  </span>
  <a href={reloginHereUrl()} data-astro-reload class="btn-secondary mt-2 flex w-fit no-underline"
    >Neu anmelden</a
  >
{:else if text.includes(SESSION_EXPIRED_MESSAGE)}
  <a
    href={RELOGIN_URL}
    target="_blank"
    rel="noopener"
    class="btn-secondary mt-2 flex w-fit no-underline">Neu anmelden (öffnet neuen Tab)</a
  >
{/if}
