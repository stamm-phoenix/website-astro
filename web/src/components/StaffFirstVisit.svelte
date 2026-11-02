<script lang="ts">
  import StaffModuleSection from './StaffModuleSection.svelte';
  import { favoritesStore } from '../lib/staffFavoritesStore.svelte';
  import { recentStore } from '../lib/staffRecentStore.svelte';
  import type { StaffModule } from '../lib/staffModules';
  interface Props {
    modules: StaffModule[];
  }
  let { modules }: Props = $props();
  const firstVisit = $derived(
    favoritesStore.loaded &&
      recentStore.loaded &&
      favoritesStore.modules.length === 0 &&
      recentStore.modules.length === 0
  );
  const firstVisitModules = $derived(
    modules.filter((module) =>
      [
        '/leitendenbereich/aufgaben',
        '/leitendenbereich/aktionen',
        '/leitendenbereich/belege',
        '/leitendenbereich/anwesenheit',
        '/leitendenbereich/mitglieder',
        '/leitendenbereich/protokolle',
      ].includes(module.href)
    )
  );
</script>

{#if firstVisit}
  <StaffModuleSection title="Häufige Aufgaben" modules={firstVisitModules} level={2} />
{/if}
