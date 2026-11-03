<script lang="ts">
  import StaffModuleSection from './StaffModuleSection.svelte';
  import type { StaffModule } from '../lib/staffModules';
  interface Props {
    modules: StaffModule[];
  }
  let { modules }: Props = $props();
  const commonModules = $derived(
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

{#if commonModules.length > 0}
  <StaffModuleSection title="Häufige Aufgaben" modules={commonModules} level={2} />
{/if}
