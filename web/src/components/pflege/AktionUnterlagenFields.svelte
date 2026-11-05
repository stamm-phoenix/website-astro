<script lang="ts">
  import { untrack } from 'svelte';
  import { createResource } from '../../lib/pflegeStore.svelte';
  import type { DownloadFile } from '../../lib/types';
  import FormField from './FormField.svelte';
  import LoadState from '../ui/LoadState.svelte';

  interface Props {
    meetingPoint: string;
    packingText: string;
    downloadIds: string[];
    errors: Record<string, string>;
  }
  let {
    meetingPoint = $bindable(),
    packingText = $bindable(),
    downloadIds = $bindable(),
    errors,
  }: Props = $props();
  const files = createResource<DownloadFile[]>('/downloads', {
    loadError:
      'Die Unterlagen konnten nicht geladen werden. Prüfe deine Internetverbindung und lade sie erneut.',
  });
  $effect(() => {
    untrack(() => files.load());
  });
</script>

<FormField id="aktion-meeting-point" label="Treffpunkt" optional error={errors.meetingPoint}>
  {#snippet children(attrs)}
    <input
      {...attrs}
      class="form-input"
      maxlength="500"
      placeholder="Pfarrheim, Haupteingang"
      bind:value={meetingPoint}
    />
  {/snippet}
</FormField>
<FormField
  id="aktion-packing-list"
  label="Packliste – ein Gegenstand pro Zeile"
  optional
  error={errors.packingList}
>
  {#snippet children(attrs)}
    <textarea
      {...attrs}
      class="form-input"
      rows="6"
      placeholder="Schlafsack&#10;Isomatte&#10;Trinkflasche"
      bind:value={packingText}></textarea>
  {/snippet}
</FormField>
<fieldset
  data-form-error-group
  aria-describedby={errors.downloadIds ? 'aktion-downloads-error' : undefined}
>
  <legend class="form-label">Unterlagen</legend>
  <LoadState
    data={files.state.data}
    loading={files.state.loading}
    error={files.state.error}
    onretry={() => files.load({ force: true })}
  >
    {#each files.state.data ?? [] as file (file.id)}
      <label class="flex min-h-11 items-center gap-3 text-sm break-all">
        <input
          type="checkbox"
          aria-invalid={errors.downloadIds ? 'true' : undefined}
          aria-describedby={errors.downloadIds ? 'aktion-downloads-error' : undefined}
          value={file.id}
          bind:group={downloadIds}
        />{file.fileName}
      </label>
    {/each}
    {#if files.state.data?.length === 0}<p class="text-sm text-neutral-700">
        Noch keine Unterlagen vorhanden.
      </p>{/if}
    {#each downloadIds.filter((id) => files.state.data && !files.state.data.some((file) => file.id === id)) as id (id)}
      <label class="flex min-h-11 items-center gap-3 text-sm text-neutral-700">
        <input
          type="checkbox"
          aria-invalid={errors.downloadIds ? 'true' : undefined}
          aria-describedby={errors.downloadIds ? 'aktion-downloads-error' : undefined}
          value={id}
          bind:group={downloadIds}
        />Datei nicht mehr verfügbar
      </label>
    {/each}
  </LoadState>
  {#if errors.downloadIds}<p id="aktion-downloads-error" role="alert" class="text-sm text-danger">
      {errors.downloadIds}
    </p>{/if}
</fieldset>
