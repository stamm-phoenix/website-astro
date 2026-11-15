<script lang="ts">
  import EditDialog from '../pflege/EditDialog.svelte';
  import FormField from '../pflege/FormField.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { sendApi } from '../../lib/api';
  import { leseVerleihEntwurf, type VerleihAntragForm } from '../../lib/verleihForm';
  import { createDialogForm } from '../../lib/dialogForm.svelte';
  import type { InventarArtikel } from '../../lib/inventur';
  import { reservierterBestand } from '../../../../api/lib/verleih-model';
  import type { VerleihVorgang } from '../../../../api/lib/verleih-model';
  interface Props {
    artikel: InventarArtikel[];
    vorgaenge: VerleihVorgang[];
    login: string;
    vorgang: VerleihVorgang | null;
    onclose: () => void;
    ondone: (text: string) => Promise<void>;
  }
  let { artikel, vorgaenge, login, vorgang, onclose, ondone }: Props = $props();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  // svelte-ignore state_referenced_locally
  let input = $state<VerleihAntragForm>(
    vorgang
      ? {
          entleiher: vorgang.entleiher,
          verantwortlich: vorgang.verantwortlich,
          kontakt: vorgang.kontakt,
          von: vorgang.von,
          bis: vorgang.bis,
          notizen: vorgang.notizen,
          positionen: vorgang.positionen.map((p) => ({ varianteId: p.varianteId, menge: p.menge })),
        }
      : {
          entleiher: '',
          verantwortlich: login,
          kontakt: login,
          von: today,
          bis: today,
          notizen: '',
          positionen: [{ varianteId: 0, menge: 1 }],
        }
  );
  let anfrageId = $state<string>(crypto.randomUUID());
  const dialog = createDialogForm();
  const dirty = $derived(JSON.stringify(input));
  const initial = JSON.stringify(input);
  const varianten = $derived(
    artikel.flatMap((a) =>
      a.varianten.map((v) => ({
        id: v.id,
        label: `${a.bezeichnung}${v.bezeichnung ? ` · ${v.bezeichnung}` : ''}`,
        bestand: a.zustand === 'reparatur' || a.zustand === 'defekt' || a.fehlend ? 0 : v.bestand,
      }))
    )
  );
  function verfuegbar(id: number): number {
    const v = varianten.find((v) => v.id === id);
    const reservations = vorgaenge
      .filter((a) => a.id !== vorgang?.id && ['genehmigt', 'ausgegeben'].includes(a.status))
      .flatMap((a) =>
        a.positionen
          .filter((p) => p.varianteId === id)
          .map((p) => ({
            von: a.von,
            bis: a.bis,
            menge: p.menge - p.zurueck,
            ueberfaellig: a.bis < today,
          }))
      );
    return Math.max(0, (v?.bestand ?? 0) - reservierterBestand(reservations, input.von, input.bis));
  }
  async function save(): Promise<void> {
    await dialog.run(async () => {
      const result = await sendApi<{ mailGesendet: boolean }>(
        vorgang ? 'PATCH' : 'POST',
        `/intern/pflege/verleih${vorgang ? `/${vorgang.id}` : ''}`,
        { ...input, anfrageId, ...(vorgang ? { etag: vorgang.etag } : {}) }
      );
      await ondone(
        result.mailGesendet
          ? 'Ausleihe beantragt. Die Bestätigung wurde versandt.'
          : 'Ausleihe beantragt. Eine E-Mail konnte nicht versandt werden. Du kannst den Versand in der Ausleihe wiederholen.'
      );
    }, 'Der Antrag konnte nicht bestätigt werden. Deine Eingaben sind noch da. Prüfe die Liste oder versuche es erneut.');
  }
</script>

<EditDialog
  open
  title={vorgang ? 'Ausleihantrag bearbeiten' : 'Ausleihe beantragen'}
  rescueKey={`verleih:${vorgang?.id ?? 'neu'}`}
  rescueVersion={vorgang?.etag}
  busy={dialog.state.busy}
  error={dialog.state.fields.form || dialog.state.fields.positionen || dialog.state.error}
  dirty={dirty !== initial}
  submitLabel={vorgang ? 'Antrag ändern' : 'Ausleihe beantragen'}
  onreload={dialog.state.error
    ? async () => {
        await ondone('Aktuelle Ausleihe geladen.');
        return false;
      }
    : undefined}
  rescueFields={[
    {
      key: 'materialauswahl',
      structure: true,
      get: () => JSON.stringify({ anfrageId, positionen: input.positionen }),
      describe: () => 'Materialauswahl des Antrags',
      set: (text) => {
        const entwurf = leseVerleihEntwurf(text);
        if (!entwurf) return false;
        anfrageId = entwurf.anfrageId;
        input.positionen = entwurf.positionen;
        return true;
      },
    },
  ]}
  onsubmit={save}
  {onclose}
>
  <fieldset disabled={dialog.state.busy} class="min-w-0 space-y-4">
    <FormField
      id="verleih-entleiher"
      label="Person oder Gruppe"
      error={dialog.state.fields.entleiher}
    >
      {#snippet children(attrs)}<input
          {...attrs}
          class="form-input"
          placeholder="z. B. Roverrunde oder Anna Muster"
          bind:value={input.entleiher}
        />{/snippet}
    </FormField>
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField id="verleih-von" label="Ausleihe am" error={dialog.state.fields.von}
        >{#snippet children(attrs)}<input
            {...attrs}
            type="date"
            class="form-input"
            bind:value={input.von}
          />{/snippet}</FormField
      >
      <FormField id="verleih-bis" label="Rückgabe bis" error={dialog.state.fields.bis}
        >{#snippet children(attrs)}<input
            {...attrs}
            type="date"
            class="form-input"
            bind:value={input.bis}
          />{/snippet}</FormField
      >
    </div>
    <fieldset class="space-y-3">
      <legend class="form-label">Material und Menge</legend>
      {#each input.positionen as p, i (i)}
        <div class="space-y-2 border-b border-neutral-200 pb-3">
          <label class="form-label" for={`material-${i}`}>Material {i + 1}</label>
          <select
            id={`material-${i}`}
            name={`material-${i}`}
            class="form-input"
            bind:value={p.varianteId}
          >
            <option value={0}>Material auswählen</option>
            {#each varianten as v (v.id)}<option value={v.id}>{v.label}</option>{/each}
          </select>
          <div class="flex flex-wrap items-end gap-3">
            <div class="w-28">
              <label class="form-label" for={`menge-${i}`}>Menge</label><input
                id={`menge-${i}`}
                name={`menge-${i}`}
                type="number"
                min="1"
                step="1"
                class="form-input"
                bind:value={p.menge}
              />
            </div>
            {#if p.varianteId}<p class="py-3 text-sm text-neutral-700">
                {verfuegbar(p.varianteId)} verfügbar
              </p>{/if}
            {#if input.positionen.length > 1}<ActionButton
                type="button"
                variant="secondary"
                aria-label={`Material ${i + 1} entfernen`}
                onclick={() => input.positionen.splice(i, 1)}>Entfernen</ActionButton
              >{/if}
          </div>
        </div>
      {/each}
      {#if dialog.state.fields.positionen}<p role="alert" class="text-danger">
          {dialog.state.fields.positionen}
        </p>{/if}
      <ActionButton
        type="button"
        variant="secondary"
        disabled={input.positionen.length >= 60}
        onclick={() => input.positionen.push({ varianteId: 0, menge: 1 })}
        >Material hinzufügen</ActionButton
      >
    </fieldset>
    <FormField
      id="verleih-kontakt"
      label="E-Mail oder Kontakt"
      optional
      error={dialog.state.fields.kontakt}
      >{#snippet children(attrs)}<input
          {...attrs}
          class="form-input"
          bind:value={input.kontakt}
        />{/snippet}</FormField
    >
    <FormField
      id="verleih-person"
      label="Verantwortliche Person"
      optional
      error={dialog.state.fields.verantwortlich}
      >{#snippet children(attrs)}<input
          {...attrs}
          class="form-input"
          bind:value={input.verantwortlich}
        />{/snippet}</FormField
    >
    <FormField
      id="verleih-notizen"
      label="Zweck und Notizen"
      optional
      error={dialog.state.fields.notizen}
      >{#snippet children(attrs)}<textarea
          {...attrs}
          class="form-input"
          rows="3"
          bind:value={input.notizen}></textarea>{/snippet}</FormField
    >
  </fieldset>
</EditDialog>
