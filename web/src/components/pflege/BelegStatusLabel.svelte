<script lang="ts">
  import StatusLabel from '../ui/StatusLabel.svelte';
  import type { BelegStatus } from '../../lib/types';
  interface Props {
    status: BelegStatus;
  }
  let { status }: Props = $props();
</script>

<StatusLabel
  label={status}
  tone={status === 'Angenommen' ? 'success' : status === 'Abgelehnt' ? 'danger' : 'neutral'}
/>
