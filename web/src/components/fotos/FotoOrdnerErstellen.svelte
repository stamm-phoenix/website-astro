<script lang="ts">
  import { onDestroy } from 'svelte';
  import { errorMessage, sendApi } from '../../lib/api';
  import { cleanName } from '../../lib/fotoPfade';
  import { forgetFotoFolder, loadFotoFolder } from '../../lib/fotoOrdnerStore.svelte';
  import type { FotoTarget } from '../../lib/types';
  import FormField from '../pflege/FormField.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import MessageText from '../ui/MessageText.svelte';

  interface Props {
    path: string;
    name: string;
    uploadError?: string;
  }
  let { path = $bindable(), name = $bindable(), uploadError }: Props = $props();
  let saving = $state(false);
  let error = $state<string | null>(null);
  let success = $state<string | null>(null);

  let mounted = true;
  onDestroy(() => {
    mounted = false;
  });
  const displayedError = $derived([error, uploadError].filter(Boolean).join(' ') || null);

  async function create(): Promise<void> {
    if (saving) return;
    error = null;
    success = null;
    const folderName = cleanName(name);
    if (!folderName) {
      error = 'Gib einen gültigen Ordnernamen ein.';
      return;
    }
    const parent = path;
    const originalName = name;
    saving = true;
    try {
      const folder = await sendApi<FotoTarget>('POST', '/intern/fotos/ziel', {
        pfad: parent,
        unterordner: folderName,
      });
      forgetFotoFolder(folder.path);
      if (mounted && path === parent && name === originalName) {
        path = folder.path;
        name = '';
        success = `Ordner „${folderName}“ erstellt und geöffnet.`;
      }
      await Promise.all([loadFotoFolder(parent), loadFotoFolder(folder.path)]);
    } catch (cause: unknown) {
      if (!mounted || path !== parent || name !== originalName) return;
      error = errorMessage(
        cause,
        'Der Ordner konnte nicht erstellt werden. Prüfe deine Internetverbindung und versuch es noch einmal.'
      );
    } finally {
      saving = false;
    }
  }
</script>

<div class="space-y-2" aria-busy={saving}>
  <FormField id="foto-unterordner" label="Neuer Ordner darin" optional>
    {#snippet children(attrs)}
      <input
        {...attrs}
        aria-invalid={displayedError ? true : undefined}
        aria-describedby={displayedError ? 'foto-ordner-fehler' : undefined}
        class="form-input"
        autocomplete="off"
        placeholder="z. B. Schuljahr 2027-28"
        bind:value={name}
        disabled={saving}
      />
    {/snippet}
  </FormField>
  <ActionButton onclick={() => void create()} disabled={saving}>
    {saving ? 'Ordner wird erstellt …' : 'Ordner erstellen'}
  </ActionButton>
  {#if success}
    <p class="text-sm text-brand-900" role="status">{success}</p>
  {/if}
  {#if displayedError}
    <p id="foto-ordner-fehler" class="text-sm text-danger" role="alert">
      <MessageText text={displayedError} />
    </p>
  {/if}
</div>
