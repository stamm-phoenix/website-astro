<script lang="ts">
  import { onMount } from 'svelte';
  import { navigate } from 'astro:transitions/client';
  import { postfachHref } from '../../lib/postfaecher';

  /**
   * An old address of a single mailbox (`/leitendenbereich/email/<id>`): leads on to the module
   * „Postfächer“ with that mailbox chosen, keeping an open conversation (`#konversation=`).
   */
  interface Props {
    postfach: string;
  }
  let { postfach }: Props = $props();

  onMount(() => {
    void navigate(postfachHref(postfach) + window.location.hash, { history: 'replace' });
  });
</script>

<p role="status" aria-live="polite" class="text-neutral-700">
  Postfach wird geöffnet …
  <a class="text-link" href={postfachHref(postfach)}>Zum Postfach</a>
</p>
