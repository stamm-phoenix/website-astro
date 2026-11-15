<script lang="ts">
  import EditDialog from '../pflege/EditDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { sendApi } from '../../lib/api';
  import { createDialogForm } from '../../lib/dialogForm.svelte';
  import type { VerleihVorgang } from '../../../../api/lib/verleih-model';
  interface Props {
    vorgang: VerleihVorgang;
    aktion: 'genehmigen' | 'ablehnen' | 'ausgeben' | 'zurueckziehen' | 'rueckgabe' | 'stornieren';
    onclose: () => void;
    ondone: (text: string) => Promise<void>;
  }
  let { vorgang, aktion, onclose, ondone }: Props = $props();
  const titel = {
    genehmigen: 'Ausleihe genehmigen',
    ablehnen: 'Ausleihe ablehnen',
    ausgeben: 'Material ausgeben',
    zurueckziehen: 'Antrag zurückziehen',
    rueckgabe: 'Rückgabe speichern',
    stornieren: 'Ausleihe absagen',
  };
  let nachricht = $state('');
  // svelte-ignore state_referenced_locally
  let zeilen = $state(
    vorgang.positionen
      .filter((p) => p.menge > p.zurueck)
      .map((p) => ({ ...p, rueckgabe: 0, schaden: '' }))
  );
  const dialog = createDialogForm();
  const dirty = $derived(!!nachricht || zeilen.some((z) => z.rueckgabe > 0 || !!z.schaden));
  async function save(): Promise<void> {
    await dialog.run(async () => {
      const result = await sendApi<{ mailGesendet: boolean }>(
        'POST',
        `/intern/pflege/verleih/${vorgang.id}`,
        {
          etag: vorgang.etag,
          aktion,
          nachricht,
          rueckgaben: zeilen
            .filter((z) => z.rueckgabe > 0)
            .map((z) => ({ positionId: z.id, menge: z.rueckgabe, schaden: z.schaden })),
        }
      );
      await ondone(
        `${{ genehmigen: 'Ausleihe genehmigt.', ablehnen: 'Ausleihe abgelehnt.', ausgeben: 'Material ausgegeben.', zurueckziehen: 'Antrag zurückgezogen.', rueckgabe: 'Rückgabe gespeichert.', stornieren: 'Ausleihe abgesagt.' }[aktion]}${result.mailGesendet ? '' : ' Eine E-Mail konnte nicht versandt werden. Du kannst den Versand in der Ausleihe wiederholen.'}`
      );
    }, 'Die Änderung konnte nicht bestätigt werden. Deine Eingaben sind noch da. Prüfe die aktuelle Ausleihe, bevor du es noch einmal versuchst.');
  }
</script>

<EditDialog
  open
  title={`${titel[aktion]}: ${vorgang.entleiher}`}
  submitLabel={titel[aktion]}
  busy={dialog.state.busy}
  error={dialog.state.fields.form || dialog.state.fields.positionen || dialog.state.error}
  {dirty}
  rescueKey={`verleih-${aktion}:${vorgang.id}`}
  rescueVersion={vorgang.etag}
  onreload={dialog.state.error
    ? async () => {
        await ondone('Aktuelle Ausleihe geladen.');
        return false;
      }
    : undefined}
  onsubmit={save}
  {onclose}
>
  <fieldset disabled={dialog.state.busy} class="min-w-0 space-y-4">
    <p>{vorgang.von} bis {vorgang.bis}</p>
    {#if aktion === 'rueckgabe'}
      {#each zeilen as z (z.id)}
        <div class="space-y-3 border-b border-neutral-200 pb-4">
          <h3 class="font-semibold text-brand-900">{z.bezeichnung}</h3>
          <FormField
            id={`rueckgabe-${z.id}`}
            label={`Zurückgegeben (noch ${z.menge - z.zurueck} offen)`}
            error={dialog.state.fields.rueckgaben}
          >
            {#snippet children(attrs)}<input
                {...attrs}
                type="number"
                min="0"
                max={z.menge - z.zurueck}
                step="1"
                class="form-input"
                bind:value={z.rueckgabe}
              />{/snippet}
          </FormField>
          <FormField
            id={`schaden-${z.id}`}
            label="Schäden oder fehlende Teile bei der Rückgabe"
            optional
            info="Material mit gemeldetem Schaden bleibt für weitere Ausleihen gesperrt, bis der Zustand in der Inventur berichtigt wurde."
          >
            {#snippet children(attrs)}<input
                {...attrs}
                class="form-input"
                placeholder="z. B. Riss in der Zeltbahn"
                bind:value={z.schaden}
              />{/snippet}
          </FormField>
        </div>
      {/each}
    {:else}
      <ul class="space-y-2">
        {#each vorgang.positionen as p (p.id)}<li>{p.menge} × {p.bezeichnung}</li>{/each}
      </ul>
    {/if}
    <FormField
      id="verleih-nachricht"
      label={aktion === 'genehmigen' || aktion === 'ablehnen'
        ? 'Nachricht zur Entscheidung'
        : 'Notiz'}
      optional
      error={dialog.state.fields.nachricht}
    >
      {#snippet children(attrs)}<textarea
          {...attrs}
          class="form-input"
          rows="3"
          bind:value={nachricht}></textarea>{/snippet}
    </FormField>
  </fieldset>
</EditDialog>
