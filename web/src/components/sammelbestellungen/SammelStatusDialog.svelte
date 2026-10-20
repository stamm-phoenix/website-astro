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
    loadOrder: (id: string) => Promise<SammelBestellung | null>;
  }
  let {
    editing = $bindable(),
    busy = $bindable(),
    prices,
    onreload,
    onmessage,
    loadOrder,
  }: Props = $props();
  let dialogError = $state<string | null>(null);
  let conflict = $state(false);
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
    if (!editing || conflict) return;
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
      conflict = caught instanceof ApiError && caught.status === 409;
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
  async function reloadCurrent(): Promise<boolean> {
    if (!editing || busy) return false;
    busy = true;
    try {
      const fresh = await loadOrder(editing.id);
      if (!fresh) {
        dialogError =
          'Die Bestellung wurde inzwischen gelöscht. Deine Angaben sind noch da; kopiere sie bei Bedarf vor dem Schließen.';
        return false;
      }
      editing = structuredClone(fresh);
      const cents = fresh.totalCents ?? sammelReceipt(fresh.items, prices).totalCents;
      total = cents === null ? undefined : cents / 100;
      conflict = false;
      dialogError = null;
      return true;
    } catch (caught) {
      dialogError = errorMessage(
        caught,
        'Die aktuelle Bestellung konnte nicht geladen werden. Deine Angaben sind noch da. Prüfe deine Verbindung und tippe erneut auf „Aktuelle Fassung laden“.'
      );
      return false;
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
  submitDisabled={conflict}
  onreload={conflict ? reloadCurrent : undefined}
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
    {#if editing.status === 'Eingereicht'}<p class="text-sm text-neutral-700">
        Mitglieder können ihre Bestellung im Bestellzeitraum noch ändern.
      </p>{:else if editing.status !== 'Storniert'}<p class="text-sm text-neutral-700">
        Mitglieder können ihre Bestellung jetzt nicht mehr ändern.
      </p>{/if}
    <FormField
      id="order-total"
      label="Endgültiger Gesamtbetrag in Euro (inkl. Versand)"
      optional
      hint="Leer lassen, solange der Betrag offen ist."
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
    <label class="flex items-center gap-2"
      ><input
        type="checkbox"
        bind:checked={editing.paid}
        disabled={editing?.payment?.locked && editing.payment.state !== 'created'}
      />Bezahlt</label
    >
    {#if editing.payment?.locked}<p class="text-sm text-neutral-700">
        Der Beitrag ist in CampFlow angelegt; Betrag und Artikel sind gesperrt. Änderungen zuerst
        dort klären.
      </p>{/if}
    <label class="flex items-center gap-2"
      ><input type="checkbox" bind:checked={editing.delivered} />Ausgeliefert</label
    >
  {/if}
</EditDialog>
