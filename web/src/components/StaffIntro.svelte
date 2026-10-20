<script lang="ts">
  /**
   * The intro of a page of the Leitendenbereich. Normally it waits behind the „(i)“ next to the
   * heading, so the content and the main action start high up on a phone; `open` shows it as a
   * paragraph, for intros the page cannot be used without.
   */
  import InfoHint from './ui/InfoHint.svelte';

  interface Props {
    heading: string;
    intro: string;
    open?: boolean;
    class?: string;
  }
  let { heading, intro, open = false, class: className = '' }: Props = $props();
</script>

{#if open}
  <p class="staff-intro max-w-prose text-neutral-800 {className}">{intro}</p>
{:else}
  <InfoHint label={heading} text={intro} class="staff-intro mt-[0.4375rem] md:mt-[0.5625rem] {className}" />
{/if}
