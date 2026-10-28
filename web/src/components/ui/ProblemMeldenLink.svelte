<script lang="ts">
  import { problemMeldenHref } from '../../lib/problemMelden';

  interface Props {
    class?: string;
  }
  let { class: className = 'text-link inline-flex min-h-11 items-center text-sm' }: Props =
    $props();
</script>

<a class={className} href={problemMeldenHref()}>Problem melden</a>
