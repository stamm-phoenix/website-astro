<script lang="ts">
  import { untrack } from 'svelte';
  import ModalDialog from '../ui/ModalDialog.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { ApiError } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { datumKurz } from '../../lib/essensplanung';
  import { faktorFeld, platzVon } from '../../lib/essensplanungEinplanung';
  import type { Auftrag } from '../../lib/essensplanungEinplanung';
  import { leseFaktor, MAX_FAKTOR } from '../../../../api/lib/essen-planung-model';
  import type { PlanKontext } from './planKontext';

  /**
   * Plans a dish at a meal, or changes, moves or copies a planned one: the meal, the factor
   * and who is responsible (a member or a free name).
   */

  interface Props {
    kontext: PlanKontext;
    auftrag: Auftrag | null;
    onclose: () => void;
  }
  let { kontext, auftrag, onclose }: Props = $props();
  const ansicht = $derived(kontext.ansicht);

  let gerichtId = $state<number | null>(null);
  let mahlzeitId = $state<number | null>(null);
  let faktor = $state('1');
  /** '' for nobody, 'frei' for a free name, else the id of a member. */
  let zustaendig = $state('');
  let zustaendigText = $state('');
  let felder = $state<Record<string, string>>({});
  let geaendert = $state(false);
  $effect(() => guardUnsavedChanges(() => auftrag !== null && geaendert));

  /** The planned dish as the dialog opened, with its version. */
  let start = $state<{ id: number; etag: string; gerichtName: string; zustaendig: string } | null>(
    null
  );

  /** Fills the form whenever the dialog opens; later changes of others leave it alone. */
  $effect(() => {
    const neu = auftrag;
    if (neu) untrack(() => fuelle(neu));
  });

  function fuelle(neu: Auftrag): void {
    felder = {};
    geaendert = false;
    mahlzeitId = neu.mahlzeitId;
    const platz = neu.einplanungId === null ? undefined : platzVon(ansicht, neu.einplanungId);
    if (!platz) {
      start = null;
      gerichtId = ansicht.gerichte.length === 1 ? ansicht.gerichte[0].id : null;
      faktor = '1';
      zustaendig = '';
      zustaendigText = '';
      return;
    }
    const { einplanung } = platz;
    start = {
      id: einplanung.id,
      etag: einplanung.etag,
      gerichtName: ansicht.gerichte.find((g) => g.id === einplanung.gerichtId)?.name ?? 'Gericht',
      zustaendig: einplanung.zustaendig,
    };
    gerichtId = einplanung.gerichtId;
    faktor = faktorFeld(einplanung.faktor);
    zustaendig =
      einplanung.zustaendigId !== null
        ? String(einplanung.zustaendigId)
        : einplanung.zustaendig
          ? 'frei'
          : '';
    zustaendigText = einplanung.zustaendigId === null ? einplanung.zustaendig : '';
  }

  const titel = $derived.by(() => {
    if (!auftrag) return '';
    if (auftrag.modus === 'aendern') return `${start?.gerichtName ?? 'Gericht'} ändern`;
    if (auftrag.modus === 'kopieren') return `${start?.gerichtName ?? 'Gericht'} kopieren`;
    const mahlzeit = ansicht.tage
      .flatMap((tag) => tag.mahlzeiten)
      .find((m) => m.id === auftrag.mahlzeitId);
    return mahlzeit ? `Gericht für ${mahlzeit.kennung} ${mahlzeit.name}` : 'Gericht einplanen';
  });

  /** Members who may be responsible; one without access stays while it is chosen. */
  const mitglieder = $derived(ansicht.mitglieder.filter((m) => !m.entzogen));
  const ohneZugang = $derived(
    zustaendig !== '' &&
      zustaendig !== 'frei' &&
      !mitglieder.some((m) => String(m.id) === zustaendig)
  );

  /** True while saving; the form is disabled meanwhile. */
  let speichert = $state(false);

  async function speichern(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (speichert || !auftrag) return;
    speichert = true;
    try {
      await speichereFormular(auftrag);
    } finally {
      speichert = false;
    }
  }

  async function speichereFormular(jetzt: Auftrag): Promise<void> {
    felder = {};
    const zahl = leseFaktor(faktor);
    if (!(zahl > 0 && zahl <= MAX_FAKTOR))
      felder.faktor = `Bitte eine Zahl größer als 0 und bis ${MAX_FAKTOR} eintragen, z. B. 0,5.`;
    if (gerichtId === null) felder.gerichtId = 'Bitte ein Gericht wählen.';
    if (mahlzeitId === null) felder.mahlzeitId = 'Bitte eine Mahlzeit wählen.';
    if (Object.keys(felder).length) return;
    const body = {
      mahlzeitId,
      gerichtId,
      faktor: zahl,
      zustaendigId: zustaendig === '' || zustaendig === 'frei' ? null : Number(zustaendig),
      zustaendigText: zustaendig === 'frei' ? zustaendigText : '',
    };
    const name = ansicht.gerichte.find((g) => g.id === gerichtId)?.name ?? 'Gericht';
    // A planned dish is changed with the version the form started from: a change of others
    // meanwhile is a conflict, a deletion stays one (never a new one)
    const ok = await kontext.aendern(
      async () => {
        try {
          return jetzt.modus === 'aendern' && start
            ? await kontext.api.senden('PATCH', `/einplanungen/${start.id}`, {
                ...body,
                etag: start.etag,
              })
            : await kontext.api.senden('POST', '/einplanungen', body);
        } catch (error: unknown) {
          if (error instanceof ApiError && error.fields) felder = error.fields;
          throw error;
        }
      },
      jetzt.modus === 'aendern'
        ? `${name} gespeichert.`
        : jetzt.modus === 'kopieren'
          ? `${name} kopiert.`
          : `${name} eingeplant.`
    );
    if (ok) {
      geaendert = false;
      onclose();
      return;
    }
    // The page told about the conflict; saving again takes the input over what is saved now
    const aktuell = start ? platzVon(ansicht, start.id) : undefined;
    if (aktuell && start) start = { ...start, etag: aktuell.einplanung.etag };
  }

  /** Closing with unsaved input asks first; not while saving. */
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

<ModalDialog
  open={auftrag !== null}
  title={titel}
  closeDisabled={kontext.busy}
  onclose={() => void schliessen()}
>
  <form
    class="min-h-0 space-y-4 overflow-y-auto px-5 py-4"
    onsubmit={speichern}
    oninput={() => (geaendert = true)}
    onchange={() => (geaendert = true)}
  >
    <!-- Disabled while saving, so nothing typed meanwhile gets lost -->
    <fieldset class="min-w-0 space-y-4" disabled={speichert}>
      {#if auftrag?.modus === 'neu'}
        <FormField id="einplanung-gericht" label="Gericht" error={felder.gerichtId}>
          {#snippet children(attrs)}
            <select {...attrs} class="form-input" bind:value={gerichtId}>
              <option value={null}>Bitte wählen</option>
              {#each ansicht.gerichte as gericht (gericht.id)}
                <option value={gericht.id}>{gericht.name}</option>
              {/each}
            </select>
          {/snippet}
        </FormField>
      {:else if felder.gerichtId}
        <p class="text-sm text-danger" role="alert">{felder.gerichtId}</p>
      {/if}
      <FormField id="einplanung-mahlzeit" label="Mahlzeit" error={felder.mahlzeitId}>
        {#snippet children(attrs)}
          <select {...attrs} class="form-input" bind:value={mahlzeitId}>
            {#if mahlzeitId !== null && !ansicht.tage.some( (tag) => tag.mahlzeiten.some((m) => m.id === mahlzeitId) )}
              <option value={mahlzeitId} disabled>Gelöscht: nicht mehr im Plan</option>
            {/if}
            {#each ansicht.tage as tag (tag.id)}
              <optgroup label="Tag {tag.nummer} · {datumKurz(tag.datum)}">
                {#each tag.mahlzeiten as mahlzeit (mahlzeit.id)}
                  <option value={mahlzeit.id}>{mahlzeit.kennung} {mahlzeit.name}</option>
                {/each}
              </optgroup>
            {/each}
          </select>
        {/snippet}
      </FormField>
      <FormField
        id="einplanung-faktor"
        label="Faktor"
        error={felder.faktor}
        info="Die Mengen des Gerichts mal diese Zahl, z. B. 0,5, wenn nur die Hälfte mitisst. Feste Mengen bleiben."
      >
        {#snippet children(attrs)}
          <input
            {...attrs}
            class="form-input w-28"
            inputmode="decimal"
            autocomplete="off"
            bind:value={faktor}
          />
        {/snippet}
      </FormField>
      <FormField id="einplanung-zustaendig" label="Zuständig" optional error={felder.zustaendigId}>
        {#snippet children(attrs)}
          <select {...attrs} class="form-input" bind:value={zustaendig}>
            <option value="">niemand</option>
            {#each mitglieder as mitglied (mitglied.id)}
              <option value={String(mitglied.id)}>{mitglied.name}</option>
            {/each}
            {#if ohneZugang}
              <option value={zustaendig}
                >{start?.zustaendig ?? 'Mitglied'} (kein Zugang mehr)</option
              >
            {/if}
            <option value="frei">Jemand anderes …</option>
          </select>
        {/snippet}
      </FormField>
      {#if zustaendig === 'frei'}
        <FormField id="einplanung-zustaendig-text" label="Name" error={felder.zustaendigText}>
          {#snippet children(attrs)}
            <input
              {...attrs}
              class="form-input"
              maxlength="100"
              placeholder="z. B. Küchenteam"
              bind:value={zustaendigText}
            />
          {/snippet}
        </FormField>
      {/if}
      <div class="flex flex-wrap justify-end gap-2 pt-2">
        <ActionButton type="button" onclick={() => void schliessen()}>Abbrechen</ActionButton>
        <ActionButton type="submit" variant="primary" disabled={kontext.busy}>
          {auftrag?.modus === 'aendern'
            ? 'Speichern'
            : auftrag?.modus === 'kopieren'
              ? 'Kopieren'
              : 'Einplanen'}
        </ActionButton>
      </div>
    </fieldset>
  </form>
</ModalDialog>
