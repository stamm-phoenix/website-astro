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
{#if nikolausStatusStore.data && !nikolausStatusStore.data.staffActive}<p
    class="mt-2 text-sm text-neutral-700"
  >
    Die Nikolausverwaltung ist ausgeschaltet. Anmeldungen, Dispo, Route und Helfende lassen sich in
    der <a class="text-link underline" href="/leitendenbereich/nikolaus-steuerung">Steuerung</a> einschalten.
  </p>{/if}
