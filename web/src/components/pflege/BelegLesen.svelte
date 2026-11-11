<script lang="ts">
  import { belegDetails } from '../../lib/belegDetails';
  import { parseEuroToCent } from '../../lib/belege';
  import type { BelegForm } from '../../lib/belegForm';

  interface Props {
    /** The receipt as it is stored; looked at, not changed. */
    form: BelegForm;
  }
  let { form }: Props = $props();

  const details = $derived(belegDetails({ ...form, amountCent: parseEuroToCent(form.amount) }));
</script>

<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
  {#each details as [label, value] (label)}
    <dt class="font-semibold text-neutral-700">{label}</dt>
    <dd class="min-w-0 break-words whitespace-pre-line text-neutral-900">{value}</dd>
  {/each}
</dl>
