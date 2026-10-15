<script lang="ts">
  import EditDialog from '../pflege/EditDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { sendApi, ApiError, errorMessage } from '../../lib/api';
  import type { SammelBestellung, SammelSaveResult } from '../../lib/types';
  const BASE = '/intern/pflege/sammelbestellungen';
  import { untrack } from 'svelte';
  interface Props {
    itemEditing: { order: SammelBestellung; index: number } | null;
    busy: boolean;
    onreload: () => Promise<void>;
    onmessage: (text: string) => void;
    onerror: (text: string) => void;
  }
  let {
    itemEditing = $bindable(),
    busy = $bindable(),
    onreload,
    onmessage,
    onerror,
  }: Props = $props();
  let itemError = $state<string | null>(null);
  let itemReason = $state(
    untrack(() => itemEditing?.order.items[itemEditing.index].excluded?.reason ?? '')
  );
</script>

<EditDialog
  open={itemEditing !== null}
  error={itemError}
  title={itemEditing?.order.items[itemEditing.index].excluded
    ? 'Artikel wieder mitbestellen'
    : 'Artikel ausschließen'}
  {busy}
  onclose={() => {
    itemEditing = null;
    itemError = null;
  }}
  onsubmit={async () => {
    if (!itemEditing) return;
    busy = true;
    itemError = null;
    try {
      const result = await sendApi<SammelSaveResult>(
        'PATCH',
        BASE + '/orders/' + itemEditing.order.id + '/item',
        {
          etag: itemEditing.order.etag,
          index: itemEditing.index,
          excluded: !itemEditing.order.items[itemEditing.index].excluded,
          reason: itemReason,
        }
      );
      itemEditing = null;
      itemError = null;
      await onreload();
      onmessage(
        result.confirmationMailSent
          ? 'Artikelstatus gespeichert und Familie benachrichtigt.'
          : 'Artikelstatus gespeichert. Die Benachrichtigung konnte nicht gesendet werden. Bitte nutze „Nachricht schreiben“.'
      );
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        itemEditing = null;
        await onreload();
      }
      if (itemEditing)
        itemError = errorMessage(
          caught,
          'Der Artikelstatus wurde nicht gespeichert. Deine Angaben sind noch da. Prüfe deine Internetverbindung und tippe noch einmal auf „Speichern“.'
        );
      else {
        const conflict =
          'Die Bestellung wurde inzwischen geändert. Die aktuelle Fassung ist geladen. Öffne die Bestellung noch einmal und trage deine Änderung neu ein.';
        onerror(conflict);
      }
    } finally {
      busy = false;
    }
  }}
>
  <p class="mb-4 text-sm text-neutral-700">
    Der Artikel bleibt nachvollziehbar in der Bestellung. Die Familie erhält eine E-Mail. Der
    endgültige Betrag und die Zahlungsmarkierung werden zurückgesetzt.
  </p>
  <FormField id="item-reason" label="Kommentar" optional
    >{#snippet children(attrs)}<textarea
        {...attrs}
        class="form-input"
        rows="3"
        maxlength="1000"
        bind:value={itemReason}></textarea>{/snippet}</FormField
  >
</EditDialog>
