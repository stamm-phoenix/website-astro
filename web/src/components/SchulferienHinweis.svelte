<script lang="ts">
  import { onMount } from 'svelte';
  import { berlinDate, currentSchulferien } from '../lib/schulferien';

  let today = $state(berlinDate());
  const ferien = $derived(currentSchulferien(today));

  onMount(() => {
    let timer: ReturnType<typeof setTimeout>;
    function refresh(): void {
      const now = new Date();
      today = berlinDate(now);
      clearTimeout(timer);
      // Align with each minute, including Berlin midnight, rather than page load.
      timer = setTimeout(refresh, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
    }
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  });
</script>

<div role="status" aria-live="polite" aria-atomic="true">
  {#if ferien}
    <section
      class="surface mt-6 border-l-4 border-l-accent-500 p-5"
      aria-labelledby="schulferien-heading"
    >
      <h2 id="schulferien-heading" class="font-serif text-xl text-brand-900">
        {ferien.name}: Keine Gruppenstunden
      </h2>
      <p class="mt-2 text-neutral-700">
        In den bayerischen Schulferien finden keine Gruppenstunden statt.
      </p>
    </section>
  {:else if ferien === undefined}
    <p class="surface mt-6 p-5 text-neutral-700">
      Ob deine Gruppenstunde stattfindet, erfährst du bei deinen Gruppenleitenden.
    </p>
  {/if}
</div>
