<script lang="ts">
  import {
    RELOGIN_URL,
    SESSION_EXPIRED_MESSAGE,
    reloginHereUrl,
    reloginOnlyHere,
  } from '../../lib/api';
  import { getRescueContext } from '../../lib/geretteteEingaben';
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

  // Inside an edit dialog the input is kept across the new login in the iPhone app
  const rescue = getRescueContext();
  const rescueWarning = $derived(rescue?.warning() ?? null);
  let rescueFailed = $state(false);

  function keepInput(event: MouseEvent): void {
    if (!rescue?.enabled() || rescueFailed || rescue.rescue()) return;
    event.preventDefault();
    rescueFailed = true;
  }
</script>

{#each parts as part, index (index)}{#if ADDRESSES.includes(part)}<a
      href="mailto:{part}"
      class="text-link underline">{part}</a
    >{:else}{part}{/if}{/each}{#if text.includes(SESSION_EXPIRED_MESSAGE) && reloginOnlyHere()}
  <span class="mt-2 block">
    {#if rescueFailed}
      Deine Eingaben ließen sich auf diesem Gerät nicht sichern. Kopiere sie selbst, bevor du dich
      neu anmeldest.
    {:else if rescue?.enabled()}
      In der App auf dem Home-Bildschirm lädt das Anmelden diese Seite neu. Öffne danach dieses
      Formular wieder, dann setzt es die gesicherten Eingaben selbst ein.
    {:else}
      In der App auf dem Home-Bildschirm lädt das Anmelden diese Seite neu. Kopiere vorher, was du
      behalten willst.
    {/if}
  </span>
  {#if rescueWarning}<span class="mt-2 block">{rescueWarning}</span>{/if}
  <a
    href={reloginHereUrl()}
    data-astro-reload
    onclick={keepInput}
    class="btn-secondary mt-2 flex w-fit no-underline"
    >{rescueFailed ? 'Trotzdem neu anmelden' : 'Neu anmelden'}</a
  >
{:else if text.includes(SESSION_EXPIRED_MESSAGE)}
  <a
    href={RELOGIN_URL}
    target="_blank"
    rel="noopener"
    class="btn-secondary mt-2 flex w-fit no-underline">Neu anmelden (öffnet neuen Tab)</a
  >
{/if}
