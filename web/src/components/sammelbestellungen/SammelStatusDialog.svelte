<script lang="ts">
  import EditDialog from '../pflege/EditDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { sendApi, ApiError, errorMessage } from '../../lib/api';
  import type { SammelBestellung } from '../../lib/types';
  const BASE = '/intern/pflege/sammelbestellungen';
  import { untrack } from 'svelte';
  import { SAMMEL_STATUS } from '../../lib/sammelbestellung';
  import { sammelReceipt } from '../../lib/sammelExport';
  interface Props {
    editing: SammelBestellung | null;
    busy: boolean;
    prices: Record<string, number | null>;
    onreload: () => Promise<void>;
    onmessage: (text: string) => void;
    onerror: (text: string) => void;
  }
  let {
    editing = $bindable(),
    busy = $bindable(),
    prices,
    onreload,
    onmessage,
    onerror,
  }: Props = $props();
  let dialogError = $state<string | null>(null);
  let total = $state<number | undefined>(
    untrack(() => {
      const cents = editing
        ? (editing.totalCents ?? sammelReceipt(editing.items, prices).totalCents)
        : null;
      return cents === null ? undefined : cents / 100;
    })
  );
  /** Saves staff fields and reloads conflicts so a stale ETag cannot trap the editor. */
  async function saveStatus(): Promise<void> {
    if (!editing) return;
    busy = true;
    dialogError = null;
    try {
      await sendApi('PATCH', `${BASE}/orders/${editing.id}`, {
        etag: editing.etag,
        status: editing.status,
        paid: editing.paid,
        delivered: editing.delivered,
        totalCents: total === undefined ? null : Math.round(total * 100),
      });
      editing = null;
      await onreload();
      onmessage('Bestellstatus gespeichert.');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        editing = null;
        await onreload();
        const conflict =
          'Die Bestellung wurde inzwischen geändert. Die aktuelle Fassung ist geladen. Öffne die Bestellung noch einmal und trage deine Änderung neu ein.';
        onerror(conflict);
        return;
      }
      dialogError =
        caught instanceof ApiError && caught.fields
          ? Object.values(caught.fields).join(' ')
          : errorMessage(
              caught,
              'Der Bestellstatus wurde nicht gespeichert. Deine Angaben sind noch da. Prüfe deine Internetverbindung und tippe noch einmal auf „Speichern“.'
            );
    } finally {
      busy = false;
    }
  }
</script>

<EditDialog
  open={editing !== null}
  title="Bestellstatus bearbeiten"
  {busy}
  error={dialogError}
  onsubmit={() => void saveStatus()}
  onclose={() => {
    if (!busy) editing = null;
  }}
>
  {#if editing}
    <p class="font-semibold text-brand-900">{editing.name}</p>
    <FormField id="order-status" label="Bestellstatus"
      >{#snippet children(attrs)}<select {...attrs} class="form-input" bind:value={editing!.status}
          >{#each SAMMEL_STATUS as status (status)}<option
              value={status}
              disabled={editing?.payment?.locked && !['Bestellt', 'Eingetroffen'].includes(status)}
              >{status}</option
            >{/each}</select
        >{/snippet}</FormField
    >
    <p class="text-sm text-neutral-700">
      Ab „Bestellt“ können Mitglieder ihre Bestellung nicht mehr ändern. „Eingereicht“ gibt sie
      innerhalb des Bestellzeitraums wieder frei.
    </p>
    <FormField id="order-total" label="Endgültiger Gesamtbetrag in Euro" optional
      >{#snippet children(attrs)}<input
          {...attrs}
          class="form-input"
          type="number"
          min="0"
          max="100000"
          step="0.01"
          bind:value={total}
          disabled={editing?.payment?.locked}
        />{/snippet}</FormField
    >
    <p class="text-sm text-neutral-700">
      Ohne gespeicherten Betrag ist die Summe der aktiven Artikel vorbelegt, sofern alle Preise
      bekannt sind. Passe den Gesamtbetrag bei Bedarf an, zum Beispiel für Versandkosten. Ein leeres
      Feld lässt den Betrag offen.
    </p>
    <label class="flex items-center gap-2"
      ><input
        type="checkbox"
        bind:checked={editing.paid}
        disabled={editing?.payment?.locked && editing.payment.state !== 'created'}
      />Bezahlt{editing.payment ? ' (manuell geprüft)' : ''}</label
    >
    {#if editing.payment?.locked}<p class="text-sm text-neutral-700">
        Der CampFlow-Beitrag sperrt Betrag, Person und Artikel. Korrekturen oder Stornierungen bitte
        zuerst in CampFlow klären.
      </p>{/if}
    <label class="flex items-center gap-2"
      ><input type="checkbox" bind:checked={editing.delivered} />Ausgeliefert</label
    >
  {/if}
</EditDialog>
