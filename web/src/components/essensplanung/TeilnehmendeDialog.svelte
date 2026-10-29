<script lang="ts">
  import { untrack } from 'svelte';
  import ModalDialog from '../ui/ModalDialog.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { ApiError } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { datumKurz } from '../../lib/essensplanung';
  import { ERNAEHRUNG_TEXT } from '../../lib/essensplanungTeilnehmende';
  import { ERNAEHRUNGEN } from '../../../../api/lib/essen-teilnehmende-model';
  import type { Ernaehrung, EssenKatalog } from '../../lib/types';
  import type { PlanKontext } from './planKontext';

  /**
   * Adds or changes a row of participants: group, diet, intolerances, how many, and from which
   * to which meal they are there.
   */

  interface Props {
    kontext: PlanKontext;
    katalog: EssenKatalog | null;
    /** The row to change; null adds one; undefined: closed. */
    zeileId: number | null | undefined;
    onclose: () => void;
  }
  let { kontext, katalog, zeileId, onclose }: Props = $props();
  const ansicht = $derived(kontext.ansicht);

  let gruppeId = $state<number | null>(null);
  let ernaehrung = $state<Ernaehrung>('alles');
  let anzahl = $state('1');
  let unvertraeglichkeiten = $state<number[]>([]);
  let von = $state<number | null>(null);
  let bis = $state<number | null>(null);
  let hinweis = $state('');
  let felder = $state<Record<string, string>>({});
  /** Why the last save failed, shown in the dialog, which covers the page's notice. */
  let fehler = $state<string | null>(null);
  let geaendert = $state(false);
  $effect(() => guardUnsavedChanges(() => zeileId !== undefined && geaendert));
  /** The version of the row when the dialog opened. */
  let etag = '';

  $effect(() => {
    const id = zeileId;
    if (id !== undefined) untrack(() => fuelle(id));
  });

  function fuelle(id: number | null): void {
    felder = {};
    fehler = null;
    geaendert = false;
    const zeile = id === null ? undefined : ansicht.teilnehmende.find((z) => z.id === id);
    etag = zeile?.etag ?? '';
    gruppeId = zeile?.gruppeId ?? ansicht.gruppen[0]?.id ?? null;
    ernaehrung = zeile?.ernaehrung ?? 'alles';
    anzahl = String(zeile?.anzahl ?? 1);
    unvertraeglichkeiten = [...(zeile?.unvertraeglichkeiten ?? [])];
    von = zeile?.vonMahlzeitId ?? null;
    bis = zeile?.bisMahlzeitId ?? null;
    hinweis = zeile?.hinweis ?? '';
  }

  const mahlzeitIds = $derived(
    new Set(ansicht.tage.flatMap((tag) => tag.mahlzeiten.map((m) => m.id)))
  );

  let speichert = $state(false);

  async function speichern(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (speichert || zeileId === undefined) return;
    speichert = true;
    try {
      await speichereFormular(zeileId);
    } finally {
      speichert = false;
    }
  }

  async function speichereFormular(id: number | null): Promise<void> {
    felder = {};
    fehler = null;
    const zahl = Number(anzahl.trim());
    if (!Number.isInteger(zahl) || zahl < 1 || zahl > 2000)
      felder.anzahl = 'Bitte eine Anzahl von 1 bis 2000 eintragen.';
    if (gruppeId === null) felder.gruppeId = 'Bitte eine Gruppe wählen.';
    if (Object.keys(felder).length) return;
    let abgelehnt: unknown = null;
    const body = {
      gruppeId,
      ernaehrung,
      anzahl: zahl,
      unvertraeglichkeiten,
      vonMahlzeitId: von,
      bisMahlzeitId: bis,
      hinweis,
    };
    const gruppe = ansicht.gruppen.find((g) => g.id === gruppeId)?.name ?? '';
    const ok = await kontext.aendern(async () => {
      try {
        return id === null
          ? await kontext.api.senden('POST', '/teilnehmende', body)
          : await kontext.api.senden('PATCH', `/teilnehmende/${id}`, { ...body, etag });
      } catch (error: unknown) {
        abgelehnt = error;
        if (error instanceof ApiError && error.fields) felder = error.fields;
        throw error;
      }
    }, `${zahl} ${gruppe} gespeichert.`);
    if (ok) {
      geaendert = false;
      onclose();
      return;
    }
    if (!Object.keys(felder).length) fehler = kontext.fehler;
    // Only after a conflict does saving again take the input over what is saved now
    const jetzt = ansicht.teilnehmende.find((z) => z.id === id);
    if (jetzt && abgelehnt instanceof ApiError && abgelehnt.status === 409) etag = jetzt.etag;
  }

  async function schliessen(): Promise<void> {
    if (kontext.busy) return;
    if (
      geaendert &&
      !(await confirmAction({
        title: 'Änderungen verwerfen?',
        message: 'Deine Eingaben sind noch nicht gespeichert.',
        confirmLabel: 'Verwerfen',
      }))
    )
      return;
    geaendert = false;
    onclose();
  }
</script>

{#snippet mahlzeitOptionen(gewaehlt: number | null)}
  {#if gewaehlt !== null && !mahlzeitIds.has(gewaehlt)}
    <option value={gewaehlt} disabled>Gelöscht: nicht mehr im Plan</option>
  {/if}
  {#each ansicht.tage as tag (tag.id)}
    <optgroup label="Tag {tag.nummer} · {datumKurz(tag.datum)}">
      {#each tag.mahlzeiten as mahlzeit (mahlzeit.id)}
        <option value={mahlzeit.id}>{mahlzeit.kennung} {mahlzeit.name}</option>
      {/each}
    </optgroup>
  {/each}
{/snippet}

<ModalDialog
  open={zeileId !== undefined}
  title={zeileId === null ? 'Teilnehmende hinzufügen' : 'Teilnehmende ändern'}
  closeDisabled={kontext.busy}
  onclose={() => void schliessen()}
>
  <form
    class="min-h-0 space-y-4 overflow-y-auto px-5 py-4"
    onsubmit={speichern}
    oninput={() => (geaendert = true)}
    onchange={() => (geaendert = true)}
  >
    <fieldset class="min-w-0 space-y-4" disabled={speichert}>
      {#if fehler}<p class="text-sm text-danger" role="alert">{fehler}</p>{/if}
      <div class="grid grid-cols-2 gap-3">
        <FormField id="teilnehmende-gruppe" label="Gruppe" error={felder.gruppeId}>
          {#snippet children(attrs)}
            <select {...attrs} class="form-input" bind:value={gruppeId}>
              {#if gruppeId !== null && !ansicht.gruppen.some((g) => g.id === gruppeId)}
                <option value={gruppeId} disabled>Gelöscht</option>
              {/if}
              {#each ansicht.gruppen as gruppe (gruppe.id)}
                <option value={gruppe.id}>{gruppe.name}</option>
              {/each}
            </select>
          {/snippet}
        </FormField>
        <FormField id="teilnehmende-anzahl" label="Anzahl" error={felder.anzahl}>
          {#snippet children(attrs)}
            <input
              {...attrs}
              class="form-input"
              inputmode="numeric"
              autocomplete="off"
              bind:value={anzahl}
            />
          {/snippet}
        </FormField>
      </div>
      <FormField id="teilnehmende-ernaehrung" label="Ernährung" error={felder.ernaehrung}>
        {#snippet children(attrs)}
          <select {...attrs} class="form-input" bind:value={ernaehrung}>
            {#each ERNAEHRUNGEN as wert (wert)}
              <option value={wert}>{ERNAEHRUNG_TEXT[wert]}</option>
            {/each}
          </select>
        {/snippet}
      </FormField>
      <fieldset>
        <legend class="form-label">Unverträglichkeiten</legend>
        {#if felder.unvertraeglichkeiten}<p class="text-sm text-danger">
            {felder.unvertraeglichkeiten}
          </p>{/if}
        {#if katalog}
          <div class="grid gap-x-4 sm:grid-cols-2">
            {#each katalog.unvertraeglichkeiten as u (u.id)}
              <label class="flex min-h-11 items-center gap-2">
                <input type="checkbox" value={u.id} bind:group={unvertraeglichkeiten} />
                {u.name}
              </label>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-neutral-700">Die Liste wird geladen …</p>
        {/if}
      </fieldset>
      <div class="grid gap-3 sm:grid-cols-2">
        <FormField id="teilnehmende-von" label="Ab" error={felder.vonMahlzeitId}>
          {#snippet children(attrs)}
            <select {...attrs} class="form-input" bind:value={von}>
              <option value={null}>der ersten Mahlzeit</option>
              {@render mahlzeitOptionen(von)}
            </select>
          {/snippet}
        </FormField>
        <FormField id="teilnehmende-bis" label="Bis" error={felder.bisMahlzeitId}>
          {#snippet children(attrs)}
            <select {...attrs} class="form-input" bind:value={bis}>
              <option value={null}>zur letzten Mahlzeit</option>
              {@render mahlzeitOptionen(bis)}
            </select>
          {/snippet}
        </FormField>
      </div>
      <FormField
        id="teilnehmende-hinweis"
        label="Hinweis"
        optional
        error={felder.hinweis}
        info="Keine Namen oder Gesundheitsangaben einzelner Personen: Den Hinweis sehen alle mit einem Link zur Planung."
      >
        {#snippet children(attrs)}
          <input {...attrs} class="form-input" maxlength="200" bind:value={hinweis} />
        {/snippet}
      </FormField>
      <div class="flex flex-wrap justify-end gap-2 pt-2">
        <ActionButton type="button" onclick={() => void schliessen()}>Abbrechen</ActionButton>
        <ActionButton type="submit" variant="primary" disabled={kontext.busy}>
          {zeileId === null ? 'Hinzufügen' : 'Speichern'}
        </ActionButton>
      </div>
    </fieldset>
  </form>
</ModalDialog>
