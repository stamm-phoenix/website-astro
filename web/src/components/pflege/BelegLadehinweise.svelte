<script lang="ts">
  import MessageText from '../ui/MessageText.svelte';
  import ActionButton from '../ui/ActionButton.svelte';

  interface Props {
    campflowLoading: boolean;
    campflowError: string | null;
    campflowStale?: boolean;
    websiteError: string | null;
    onreloadCampflow: () => void;
    onreloadWebsite: () => void;
  }
  let {
    campflowLoading,
    campflowError,
    campflowStale = false,
    websiteError,
    onreloadCampflow,
    onreloadWebsite,
  }: Props = $props();
</script>

{#if campflowLoading}
  <p role="status" class="text-sm text-neutral-700">Belege aus CampFlow werden geladen …</p>
{/if}
{#each [{ error: campflowError, stale: campflowStale, reload: onreloadCampflow, label: 'Belege aus CampFlow erneut laden' }, { error: websiteError, stale: false, reload: onreloadWebsite, label: 'Hier eingereichte Belege erneut laden' }] as source (source.label)}
  {#if source.error}
    <div role="alert" class="space-y-2 border border-danger p-3 text-sm">
      <p class="font-semibold text-danger">
        {source.stale
          ? 'Die Belege konnten nicht aktualisiert werden.'
          : 'Die Belegliste ist unvollständig.'}
      </p>
      <p class="text-neutral-700"><MessageText text={source.error} /></p>
      {#if source.stale}<p class="text-neutral-700">
          Angezeigt wird der zuletzt geladene Stand.
        </p>{/if}
      <ActionButton onclick={source.reload}>{source.label}</ActionButton>
    </div>
  {/if}
{/each}
