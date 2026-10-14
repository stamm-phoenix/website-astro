<script lang="ts">
  import { untrack } from 'svelte';
  import StaffModuleSection from './StaffModuleSection.svelte';
  import { fetchNikolausStatus, nikolausStatusStore } from '../lib/nikolausStatusStore.svelte';
  import { NIKOLAUS_CONTROL_MODULE, NIKOLAUS_MODULES } from '../lib/staffModules';

  // The Steuerung is always there; the other modules only while they are switched on
  const modules = $derived([
    ...(nikolausStatusStore.data?.staffActive ? NIKOLAUS_MODULES : []),
    NIKOLAUS_CONTROL_MODULE,
  ]);

  $effect(() => {
    untrack(() => fetchNikolausStatus());
  });
</script>

<StaffModuleSection title="Nikolausdienst" {modules} />
