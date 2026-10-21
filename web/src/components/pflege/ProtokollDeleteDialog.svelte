<script lang="ts">
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';
  import { errorMessage, sendApi } from '../../lib/api';
  import { protokollePflege } from '../../lib/pflegeStore.svelte';
  import type { StaffProtokoll } from '../../lib/types';
  interface Props {
    deleting: StaffProtokoll | null;
    notify: (text: string) => void;
    ondeleted: (id: string) => void;
  }
  let { deleting = $bindable(), notify, ondeleted }: Props = $props();
  let deleteError = $state<string | null>(null);
  let deleteBusy = $state(false);

  async function remove(): Promise<void> {
    if (!deleting) return;
    deleteBusy = true;
    deleteError = null;
    try {
      const protokoll = deleting;
      await sendApi(
        'DELETE',
        `/intern/pflege/protokolle/${encodeURIComponent(protokoll.id)}`,
        undefined,
        { etag: protokoll.etag }
      );
      deleting = null;
      ondeleted(protokoll.id);
      notify(`„${protokoll.title}“ gelöscht.`);
      await protokollePflege.load({ force: true });
    } catch (error: unknown) {
      deleteError = errorMessage(
        error,
        'Das Protokoll wurde nicht gelöscht. Prüfe deine Internetverbindung und tippe noch einmal auf „Löschen“.'
      );
    } finally {
      deleteBusy = false;
    }
  }
</script>

<ConfirmDialog
  open={deleting !== null}
  title={`Protokoll „${deleting?.fileName ?? ''}“ löschen?`}
  busy={deleteBusy}
  error={deleteError}
  submitLabel="Löschen"
  busyLabel="Wird gelöscht …"
  onconfirm={remove}
  onclose={() => {
    if (!deleteBusy) deleting = null;
  }}
>
  <p class="text-sm text-neutral-800">
    Aus dem SharePoint-Papierkorb lässt es sich wiederherstellen.
  </p>
</ConfirmDialog>
