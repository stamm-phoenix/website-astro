<script lang="ts">
  import { online } from 'svelte/reactivity/window';
</script>

<!-- Without a service worker nothing is stored for offline use, so pages and data need the
     connection; this says so instead of leaving a failed load unexplained. -->
<div role="status" aria-live="polite">
  {#if online.current === false}
    <p class="mb-4 border-l-4 border-warning py-1 pl-3 text-warning">
      <strong>Keine Verbindung zum Internet.</strong> Was schon offen ist, bleibt sichtbar. Andere Seiten
      und neue Daten lädt der Leitendenbereich erst, wenn du wieder online bist.
    </p>
  {/if}
</div>
