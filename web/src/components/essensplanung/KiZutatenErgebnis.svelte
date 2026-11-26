<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import Aktionsraster from '../ui/Aktionsraster.svelte';
  import AufklappPfeil from '../ui/AufklappPfeil.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import { KI_ZUTAT_STATUS_TEXT } from '../../../../api/lib/essen-ki-zutaten-model';
  import type { KiZutatErgebnis } from '../../../../api/lib/essen-ki-zutaten-model';
  import { kiZutatenSortiert } from '../../lib/essensplanungKiZutaten';

  /**
   * The result of „Zutaten prüfen (KI)“, in a Planung and in the central list: per ingredient
   * the proposed changes to take over one by one or all at once. Ingredients the AI did not
   * understand or left out are listed too, never dropped.
   */

  interface Props {
    ergebnisse: KiZutatErgebnis[];
    /** While the AI still checks: how many of how many are done. */
    fortschritt: { fertig: number; gesamt: number } | null;
    /** Why the check stopped; with `onweiter` it goes on with the rest. */
    fehler: string | null;
    onweiter?: () => void;
    /** How many ingredients asked for are not checked yet (after an error or a pause). */
    ungeprueft?: number;
    onabbrechen?: () => void;
    /** Saves one proposal; returns why it failed, or null. */
    uebernehmen: (ergebnis: KiZutatErgebnis) => Promise<string | null>;
    /** Saves several; returns per id why it failed, or null. */
    alleUebernehmen: (ergebnisse: KiZutatErgebnis[]) => Promise<Record<number, string | null>>;
    /** Opens the ingredient to change it by hand, e.g. a name the AI did not understand. */
    onaendern?: (ergebnis: KiZutatErgebnis) => void;
    onschliessen: () => void;
    /** False while nothing may be changed (e.g. maintenance). */
    bearbeiten?: boolean;
  }
  let {
    ergebnisse,
    fortschritt,
    fehler,
    onweiter,
    ungeprueft = 0,
    onabbrechen,
    uebernehmen,
    alleUebernehmen,
    onaendern,
    onschliessen,
    bearbeiten = true,
  }: Props = $props();

  /** Ids whose proposal is saved. */
  let uebernommen = $state<number[]>([]);
  /** Per id why taking over failed. */
  let fehlerJe = $state<Record<number, string>>({});
  let speichert = $state(false);

  const sortiert = $derived(kiZutatenSortiert(ergebnisse));
  const offen = $derived(
    sortiert.filter((e) => e.status !== 'passt' && !uebernommen.includes(e.id))
  );
  const passen = $derived(sortiert.filter((e) => e.status === 'passt'));
  const vorschlaege = $derived(offen.filter((e) => e.status === 'vorschlag'));
  const erledigt = $derived(sortiert.filter((e) => uebernommen.includes(e.id)));

  function merke(id: number, ergebnis: string | null): void {
    if (ergebnis === null) {
      uebernommen = [...uebernommen, id];
      fehlerJe = Object.fromEntries(
        Object.entries(fehlerJe).filter(([andere]) => Number(andere) !== id)
      );
    } else fehlerJe = { ...fehlerJe, [id]: ergebnis };
  }

  async function eins(ergebnis: KiZutatErgebnis): Promise<void> {
    if (speichert) return;
    speichert = true;
    try {
      merke(ergebnis.id, await uebernehmen(ergebnis));
    } finally {
      speichert = false;
    }
  }

  async function alle(): Promise<void> {
    if (speichert || !vorschlaege.length) return;
    speichert = true;
    try {
      const antwort = await alleUebernehmen(vorschlaege);
      for (const [id, ergebnis] of Object.entries(antwort)) merke(Number(id), ergebnis);
    } finally {
      speichert = false;
    }
  }

  const TON = {
    vorschlag: 'warning',
    unklar: 'danger',
    ohne_antwort: 'danger',
    passt: 'success',
  } as const;
</script>

<section class="surface space-y-3 p-4" aria-labelledby="ki-zutaten-titel">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h3 id="ki-zutaten-titel" class="font-semibold text-brand-900">KI-Prüfung der Zutaten</h3>
    {#if fortschritt}
      <p class="text-sm text-neutral-700" role="status" aria-live="polite">
        Die KI prüft … {fortschritt.fertig} von {fortschritt.gesamt}
      </p>
    {:else}
      <p class="text-sm text-neutral-700" role="status" aria-live="polite">
        {vorschlaege.length === 1 ? '1 Vorschlag' : `${vorschlaege.length} Vorschläge`}
        · {passen.length} passen
        {#if offen.length - vorschlaege.length}
          · {offen.length - vorschlaege.length} ohne Vorschlag
        {/if}
      </p>
    {/if}
  </div>
  <p class="text-sm text-neutral-700">
    Von der KI erzeugt und ungeprüft. Entscheide selbst, was davon stimmt.
  </p>

  <Aktionsraster role="group" aria-label="KI-Prüfung der Zutaten">
    {#if fortschritt && onabbrechen}
      <ActionButton type="button" class="col-span-2" onclick={onabbrechen}>
        Prüfung anhalten
      </ActionButton>
    {:else if vorschlaege.length}
      <ActionButton
        type="button"
        variant="primary"
        disabled={!bearbeiten || speichert}
        onclick={() => void alle()}
      >
        Alle übernehmen ({vorschlaege.length})
      </ActionButton>
    {/if}
    {#if !fortschritt}
      <ActionButton type="button" disabled={speichert} onclick={onschliessen}>
        Schließen
      </ActionButton>
    {/if}
  </Aktionsraster>
  {#if fehler || (ungeprueft && !fortschritt)}
    <div class="flex flex-wrap items-center gap-2">
      {#if fehler}<p class="text-sm text-danger" role="alert">{fehler}</p>{/if}
      {#if ungeprueft && !fortschritt}
        <p class="text-sm text-warning" role="status">
          {ungeprueft === 1 ? '1 Zutat ist' : `${ungeprueft} Zutaten sind`} noch nicht geprüft.
        </p>
        {#if onweiter}
          <ActionButton type="button" onclick={onweiter}>Weiter prüfen</ActionButton>
        {/if}
      {/if}
    </div>
  {/if}

  {#if offen.length}
    <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
      {#each offen as ergebnis (ergebnis.id)}
        <li class="space-y-1 py-3">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p class="font-semibold text-neutral-900 [overflow-wrap:anywhere]">{ergebnis.name}</p>
            <StatusLabel
              label={KI_ZUTAT_STATUS_TEXT[ergebnis.status]}
              tone={TON[ergebnis.status]}
            />
          </div>
          {#if ergebnis.aenderungen.length}
            <ul class="text-sm text-neutral-900">
              {#each ergebnis.aenderungen as aenderung (aenderung.feld)}
                <li>
                  {aenderung.label}:
                  <span class="text-neutral-700 line-through">{aenderung.alt}</span>
                  → <span class="font-semibold">{aenderung.neu}</span>
                </li>
              {/each}
            </ul>
          {/if}
          {#if ergebnis.text}<p class="text-sm text-neutral-700">{ergebnis.text}</p>{/if}
          <div class="flex flex-wrap gap-2 pt-1">
            {#if ergebnis.status === 'vorschlag'}
              <ActionButton
                type="button"
                aria-label="Vorschlag für {ergebnis.name} übernehmen"
                disabled={!bearbeiten || speichert}
                onclick={() => void eins(ergebnis)}
              >
                Übernehmen
              </ActionButton>
            {/if}
            {#if onaendern && ergebnis.status !== 'vorschlag'}
              <ActionButton
                type="button"
                aria-label="{ergebnis.name} ändern"
                disabled={!bearbeiten || speichert}
                onclick={() => onaendern(ergebnis)}
              >
                Ändern
              </ActionButton>
            {/if}
          </div>
          {#if fehlerJe[ergebnis.id]}
            <p class="text-sm text-danger" role="alert">{fehlerJe[ergebnis.id]}</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if erledigt.length}
    <p class="text-sm text-success" role="status">
      Übernommen: {erledigt.map((e) => e.vorschlag?.name ?? e.name).join(', ')}
    </p>
  {/if}

  {#if passen.length}
    <details>
      <summary
        class="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm text-neutral-900 [&::-webkit-details-marker]:hidden"
      >
        {passen.length === 1 ? '1 Zutat passt' : `${passen.length} Zutaten passen`}
        <AufklappPfeil />
      </summary>
      <p class="text-sm text-neutral-700">{passen.map((e) => e.name).join(', ')}</p>
    </details>
  {/if}
</section>
