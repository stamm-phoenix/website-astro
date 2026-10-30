<script lang="ts">
  import { tick } from 'svelte';
  import EditDialog from '../pflege/EditDialog.svelte';
  import { ApiError, sendApi } from '../../lib/api';
  import { createDialogForm, dialogMessage } from '../../lib/dialogForm.svelte';
  import type { InventarArtikel } from '../../lib/inventur';

  interface Props {
    artikel: InventarArtikel;
    /** Loads the articles again and returns the current version of this one. */
    onreload: (id: number) => Promise<InventarArtikel | null>;
    ondone: (message: string) => void | Promise<void>;
    onclose: () => void;
  }
  let { artikel, onreload, ondone, onclose }: Props = $props();

  function toZeilen(a: InventarArtikel) {
    return a.varianten.map((v) => ({
      id: v.id,
      bezeichnung: v.bezeichnung,
      bestand: v.bestand as number | null,
    }));
  }
  // The dialog is mounted anew for every article, so the start values are all it needs
  // svelte-ignore state_referenced_locally
  let current = $state(artikel);
  // svelte-ignore state_referenced_locally
  let zeilen = $state(toZeilen(artikel));
  const dialog = createDialogForm(
    (error, fallback) =>
      (error instanceof ApiError && error.fields?.etag) || dialogMessage(error, fallback)
  );
  /** The current version is being loaded; the input stays locked until it is replaced. */
  let reloading = $state(false);
  const busy = $derived(dialog.state.busy || reloading);
  const fehler = $derived(dialog.state.fields.varianten);

  async function save(): Promise<void> {
    if (busy) return;
    const ungueltig = zeilen.some(
      (z) => z.bestand === null || !Number.isInteger(z.bestand) || z.bestand < 0
    );
    if (
      dialog.invalid(
        ungueltig ? { varianten: 'Bitte für jeden Bestand eine ganze Zahl ab 0 eintragen.' } : {}
      )
    ) {
      await tick();
      document.getElementById('zaehlen-0')?.focus();
      return;
    }
    const body = {
      varianten: zeilen.map((z) => ({ id: z.id, bestand: z.bestand })),
      etag: current.etag,
    };
    await dialog.run(async () => {
      await sendApi('POST', `/intern/pflege/inventur/${current.id}/zaehlung`, body);
      await ondone(`Zählung von ${current.bezeichnung} gespeichert.`);
    }, 'Die Zählung wurde nicht gespeichert. Deine Zahlen sind noch da. Tippe noch einmal auf „Zählung speichern“.');
  }

  /** After a conflict: shows the current stock of the article. */
  async function reloadCurrent(): Promise<boolean> {
    reloading = true;
    let fresh: InventarArtikel | null;
    try {
      fresh = await onreload(current.id);
    } finally {
      reloading = false;
    }
    if (!fresh) {
      await ondone('Der Artikel wurde inzwischen gelöscht.');
      return false;
    }
    current = fresh;
    zeilen = toZeilen(fresh);
    dialog.reset();
    return true;
  }
</script>

<EditDialog
  open
  title={`Zählen: ${current.bezeichnung}`}
  rescueKey={`inventur-zaehlen:${current.id}`}
  rescueVersion={current.etag}
  {busy}
  error={dialog.state.error}
  submitLabel="Zählung speichern"
  onreload={dialog.state.conflict ? reloadCurrent : undefined}
  onsubmit={save}
  {onclose}
>
  <fieldset disabled={busy} class="min-w-0 space-y-3">
    <legend class="form-label">Gezählter Bestand ({current.einheit})</legend>
    {#each zeilen as zeile, index (zeile.id)}
      <div class="grid grid-cols-[1fr_7rem] items-center gap-3">
        <label
          for={`zaehlen-${index}`}
          class="font-semibold text-brand-900 [overflow-wrap:anywhere]"
          >{zeile.bezeichnung || current.bezeichnung}</label
        >
        <input
          id={`zaehlen-${index}`}
          class="form-input"
          type="number"
          inputmode="numeric"
          min="0"
          step="1"
          aria-invalid={fehler ? 'true' : undefined}
          aria-describedby={fehler ? 'zaehlen-fehler' : undefined}
          bind:value={zeile.bestand}
        />
      </div>
    {/each}
    {#if fehler}
      <p id="zaehlen-fehler" class="text-sm text-danger" role="alert">{fehler}</p>
    {/if}
  </fieldset>
</EditDialog>
