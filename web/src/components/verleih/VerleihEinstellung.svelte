<script lang="ts">
  import { onMount } from 'svelte';
  import EditDialog from '../pflege/EditDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { fetchApi, sendApi, errorMessage } from '../../lib/api';
  import { createDialogForm } from '../../lib/dialogForm.svelte';
  interface Einstellung {
    materialwart: string;
    etag: string;
    konten: { name: string; login: string }[];
  }
  interface Props {
    onclose: () => void;
    ondone: (text: string) => Promise<void>;
  }
  let { onclose, ondone }: Props = $props();
  let data = $state<Einstellung | null>(null);
  let login = $state('');
  let loadError = $state('');
  const dialog = createDialogForm();
  async function load(): Promise<void> {
    loadError = '';
    try {
      data = await fetchApi<Einstellung>('/intern/pflege/verleih/einstellung');
      login = data.materialwart;
    } catch (e) {
      loadError = errorMessage(
        e,
        'Die Stammeskonten konnten nicht geladen werden. Schließe den Dialog und öffne ihn erneut.'
      );
    }
  }
  onMount(() => {
    void load();
  });
  async function save(): Promise<void> {
    if (!data) return;
    await dialog.run(async () => {
      await sendApi('PATCH', '/intern/pflege/verleih/einstellung', {
        materialwart: login,
        etag: data?.etag,
      });
      await ondone('Materialwart gespeichert.');
    }, 'Der Materialwart wurde nicht gespeichert. Lade die Auswahl neu und versuche es erneut.');
  }
</script>

<EditDialog
  open
  title="Materialwart festlegen"
  submitLabel="Materialwart speichern"
  busy={dialog.state.busy}
  submitDisabled={!data || !login}
  dirty={!!data && login !== data.materialwart}
  error={dialog.state.error || loadError}
  onreload={dialog.state.conflict
    ? async () => {
        await load();
        return !!data;
      }
    : undefined}
  onsubmit={save}
  {onclose}
>
  {#if data}
    <FormField
      id="materialwart"
      label="Stammeskonto des Materialwarts"
      error={dialog.state.fields.materialwart}
    >
      {#snippet children(attrs)}
        <select {...attrs} class="form-input" bind:value={login}>
          <option value="">Person auswählen</option>
          {#each data?.konten ?? [] as k (k.login)}<option value={k.login}
              >{k.name} ({k.login})</option
            >{/each}
        </select>
      {/snippet}
    </FormField>
  {:else if !loadError}<p role="status">Stammeskonten werden geladen …</p>{/if}
</EditDialog>
