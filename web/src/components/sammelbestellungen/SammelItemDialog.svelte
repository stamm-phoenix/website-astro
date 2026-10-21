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
    loadOrder: (id: string) => Promise<SammelBestellung | null>;
  }
  let {
    itemEditing = $bindable(),
    busy = $bindable(),
    onreload,
    onmessage,
    loadOrder,
  }: Props = $props();
  let conflict = $state(false);
  let itemError = $state<string | null>(null);
  let itemReason = $state(
    untrack(() => itemEditing?.order.items[itemEditing.index].excluded?.reason ?? '')
  );
  async function reloadCurrent(): Promise<boolean> {
    if (!itemEditing || busy) return false;
    busy = true;
    try {
      const current = itemEditing.order.items[itemEditing.index];
      const fresh = await loadOrder(itemEditing.order.id);
      const matches =
        fresh?.items
          .map((item, index) => ({ item, index }))
          .filter(
            ({ item }) =>
              item.reference === current.reference &&
              item.variant === current.variant &&
              item.name === current.name &&
              item.shop === current.shop
          ) ?? [];
      if (!fresh || matches.length !== 1) {
        itemError =
          'Der Artikel wurde inzwischen geändert oder entfernt. Dein Kommentar ist noch da. Kopiere ihn bei Bedarf, schließe den Dialog und wähle den Artikel erneut aus der aktuellen Bestellung.';
        return false;
      }
      itemEditing = { order: fresh, index: matches[0].index };
      itemReason = matches[0].item.excluded?.reason ?? '';
      conflict = false;
      itemError = null;
      return true;
    } catch (caught) {
      itemError = errorMessage(
        caught,
        'Die aktuelle Bestellung konnte nicht geladen werden. Dein Kommentar ist noch da. Prüfe deine Verbindung und tippe erneut auf „Aktuelle Fassung laden“.'
      );
      return false;
    } finally {
      busy = false;
    }
  }
</script>

<EditDialog
  open={itemEditing !== null}
  error={itemError}
  submitDisabled={conflict}
  onreload={conflict ? reloadCurrent : undefined}
  title={itemEditing?.order.items[itemEditing.index].excluded
    ? 'Artikel wieder mitbestellen'
    : 'Artikel ausschließen'}
  {busy}
  onclose={() => {
    itemEditing = null;
    itemError = null;
  }}
  onsubmit={async () => {
    if (!itemEditing || conflict) return;
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
      conflict = caught instanceof ApiError && caught.status === 409;
      itemError = errorMessage(
        caught,
        'Der Artikelstatus wurde nicht gespeichert. Dein Kommentar ist noch da. Prüfe deine Verbindung und tippe noch einmal auf „Speichern“.'
      );
    } finally {
      busy = false;
    }
  }}
>
  <p class="font-semibold text-brand-900">
    {itemEditing?.order.items[itemEditing.index].name} · {itemEditing?.order.name}
  </p>
  <p class="mb-4 text-sm text-neutral-700">
    Die Familie bekommt eine E-Mail.
    {#if itemEditing && (itemEditing.order.totalCents !== null || itemEditing.order.paid)}Gesamtbetrag
      und „Bezahlt“ werden zurückgesetzt.{/if}
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
