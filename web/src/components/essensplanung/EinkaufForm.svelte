<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import FormField from '../pflege/FormField.svelte';
  import { ApiError } from '../../lib/api';
  import { datumKurz } from '../../lib/essensplanung';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import type { Einkauf } from '../../../../api/lib/essen-einkaeufe-model';
  import { meldeVerloren, type PlanKontext } from './planKontext';

  /** Adds a shopping trip or changes one, in place under the list of trips. */

  interface Props {
    kontext: PlanKontext;
    /** The trip to change; null adds one. */
    einkauf: Einkauf | null;
    onfertig: () => void;
    /** Read-only for a while (maintenance): the fields keep what is typed, saving waits. */
    gesperrt?: boolean;
  }
  let { kontext, einkauf, onfertig, gesperrt = false }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const prefix = $derived(`einkauf-${einkauf?.id ?? 'neu'}`);

  // The form starts from the trip as it was when opened
  // svelte-ignore state_referenced_locally
  let name = $state(einkauf?.name ?? '');
  // svelte-ignore state_referenced_locally
  let datum = $state(einkauf?.datum ?? '');
  // svelte-ignore state_referenced_locally
  let geschaeft = $state(einkauf?.geschaeftId ? String(einkauf.geschaeftId) : '');
  // svelte-ignore state_referenced_locally
  let bis = $state(einkauf?.bisMahlzeitId ? String(einkauf.bisMahlzeitId) : '');
  // svelte-ignore state_referenced_locally
  let etag = einkauf?.etag ?? '';
  let felder = $state<Record<string, string>>({});
  let fehler = $state<string | null>(null);
  let geaendert = $state(false);
  let speichert = $state(false);
  $effect(() => guardUnsavedChanges(() => geaendert));

  /** False once this form is gone: a late answer then changes nothing around it. */
  let aktiv = true;
  // Someone else deleted the trip: the form goes with its card, so the unsaved input is shown to
  // copy; not after it was saved or cancelled
  $effect(() => () => {
    aktiv = false;
    if (!einkauf || !geaendert) return;
    const id = einkauf.id;
    const geschaeftName = ansicht.geschaefte.find((g) => String(g.id) === geschaeft)?.name;
    const mahlzeit = mahlzeiten.find((m) => String(m.id) === bis)?.text;
    const eingabe = [
      name.trim(),
      datum ? datumKurz(datum) : '',
      geschaeftName ?? 'alle Geschäfte',
      mahlzeit ? `bis ${mahlzeit}` : 'alle Mahlzeiten',
    ]
      .filter(Boolean)
      .join(', ');
    const text = `Den Einkauf „${einkauf.name}“ hat jemand gelöscht (deine Eingabe: ${eingabe}).`;
    // Checked after the update: the form also goes when the page closes
    setTimeout(() => {
      if (!kontext.ansicht.einkaeufe.some((e) => e.id === id)) meldeVerloren(kontext, text);
    });
  });

  const mahlzeiten = $derived(
    ansicht.tage.flatMap((tag) =>
      tag.mahlzeiten.map((m) => ({
        id: m.id,
        text: `${m.kennung} ${m.name} (${datumKurz(tag.datum)})`,
      }))
    )
  );

  async function speichern(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (speichert || gesperrt) return;
    felder = {};
    fehler = null;
    if (!name.trim()) {
      felder = { name: 'Bitte einen Namen eintragen.' };
      return;
    }
    const body = {
      name,
      datum: datum || null,
      geschaeftId: geschaeft ? Number(geschaeft) : null,
      bisMahlzeitId: bis ? Number(bis) : null,
      abgeschlossen: einkauf?.abgeschlossen ?? false,
    };
    speichert = true;
    let abgelehnt: unknown = null;
    const ok = await kontext.aendern(
      async () => {
        try {
          return einkauf
            ? await kontext.api.senden('PATCH', `/einkaeufe/${einkauf.id}`, { ...body, etag })
            : await kontext.api.senden('POST', '/einkaeufe', body);
        } catch (error: unknown) {
          abgelehnt = error;
          if (error instanceof ApiError && error.fields) felder = error.fields;
          throw error;
        }
      },
      einkauf ? `${name.trim()} gespeichert.` : `${name.trim()} angelegt.`
    );
    speichert = false;
    if (!aktiv) return;
    if (ok) {
      geaendert = false;
      onfertig();
      return;
    }
    if (!Object.keys(felder).length) fehler = kontext.fehler;
    // After a conflict saving again takes the input over what is saved now
    const jetzt = ansicht.einkaeufe.find((e) => e.id === einkauf?.id);
    if (jetzt && abgelehnt instanceof ApiError && abgelehnt.status === 409) etag = jetzt.etag;
  }
</script>

<form
  class="surface space-y-3 p-3"
  aria-label={einkauf ? `${einkauf.name} ändern` : 'Neuer Einkauf'}
  onsubmit={speichern}
  oninput={() => (geaendert = true)}
>
  <fieldset class="grid gap-3 sm:grid-cols-2" disabled={gesperrt || speichert}>
    <FormField id="{prefix}-name" label="Name des Einkaufs" error={felder.name}>
      {#snippet children(attrs)}
        <input
          {...attrs}
          class="form-input"
          maxlength="80"
          autocomplete="off"
          placeholder="z. B. Metro Montag"
          bind:value={name}
        />
      {/snippet}
    </FormField>
    <FormField id="{prefix}-datum" label="Datum" optional error={felder.datum}>
      {#snippet children(attrs)}
        <input {...attrs} type="date" class="form-input" bind:value={datum} />
      {/snippet}
    </FormField>
    <FormField id="{prefix}-geschaeft" label="Geschäft" error={felder.geschaeftId}>
      {#snippet children(attrs)}
        <select
          {...attrs}
          class="form-input"
          bind:value={geschaeft}
          onchange={() => (geaendert = true)}
        >
          <option value="">Alle Geschäfte</option>
          {#each ansicht.geschaefte as g (g.id)}
            <option value={String(g.id)}>{g.name}</option>
          {/each}
        </select>
      {/snippet}
    </FormField>
    <FormField id="{prefix}-bis" label="Für die Mahlzeiten bis" error={felder.bisMahlzeitId}>
      {#snippet children(attrs)}
        <select {...attrs} class="form-input" bind:value={bis} onchange={() => (geaendert = true)}>
          <option value="">Alle Mahlzeiten</option>
          {#each mahlzeiten as m (m.id)}
            <option value={String(m.id)}>{m.text}</option>
          {/each}
        </select>
      {/snippet}
    </FormField>
  </fieldset>
  {#if fehler}<p class="text-sm text-danger" role="alert">{fehler}</p>{/if}
  <div class="flex flex-wrap gap-2">
    <ActionButton type="submit" variant="primary" disabled={speichert || gesperrt || kontext.busy}
      >{einkauf ? 'Speichern' : 'Einkauf anlegen'}</ActionButton
    >
    <ActionButton
      type="button"
      disabled={speichert}
      onclick={() => {
        geaendert = false;
        onfertig();
      }}>Abbrechen</ActionButton
    >
  </div>
</form>
