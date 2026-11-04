<script lang="ts">
  import { onMount } from 'svelte';
  import StaffModuleSection from './StaffModuleSection.svelte';
  import type { StaffModule } from '../lib/staffModules';
  import { fetchApi } from '../lib/api';
  import { commonTaskModules } from '../lib/staffCommonTasks';
  interface Props {
    modules: StaffModule[];
  }
  let { modules }: Props = $props();
  let counts = $state<Record<string, number>>({});
  const commonModules = $derived(commonTaskModules(modules, counts));
  onMount(() => {
    void fetchApi<{ counts: Record<string, number> }>('/intern/haeufig')
      .then((result) => {
        counts = result.counts;
      })
      .catch(() => {
        /* Keep the established fallback if unavailable. */
      });
  });
</script>

{#if commonModules.length > 0}
  <StaffModuleSection title="Häufige Aufgaben" modules={commonModules} level={2} />
{/if}
