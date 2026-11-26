<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { confirmAction } from '../../lib/confirm';
  import {
    aenderungBody,
    aenderungText,
    geprueftText,
    neueZeileBody,
    neueZeileText,
    werkzeugErfolg,
    werkzeugeNach,
    werkzeugText,
    type KiHinweis,
    type KiPruefung,
  } from '../../lib/essensplanungKiPruefung';
  import type {
    Gericht,
    GerichtZutat,
    PlanungZutat,
  } from '../../../../api/lib/essen-gerichte-model';
  import type { PlanungAnsicht } from '../../../../api/lib/essen-planung-model';
  import type { PlanKontext } from './planKontext';

  /**
   * The result of „Gericht prüfen (KI)“: the assessment, for whom it was checked, and the hints.
   * A hint with a proposal takes it over with one click: a change of a line (with the version
   * that was checked), a line to add or remove, or a change of the tools (with the version of the
   * dish). Marked as AI and unchecked.
   */

  interface Props {
    kontext: PlanKontext;
    gericht: Gericht;
    zutaten: ReadonlyMap<number, PlanungZutat>;
    pruefung: KiPruefung;
    bearbeiten: boolean;
    /** Something is checked or saved; buttons wait. */
    gesperrt: boolean;
    /** A proposal is being saved; checking again waits for it. */
    onuebernimmt: (laeuft: boolean) => void;
    onneu: () => void;
    onausblenden: () => void;
  }
  let {
    kontext,
    gericht,
    zutaten,
    pruefung,
    bearbeiten,
    gesperrt,
    onuebernimmt,
    onneu,
    onausblenden,
  }: Props = $props();

  /** Indexes of the hints whose proposal was taken over. */
  let uebernommen = $state<number[]>([]);
  /** Indexes of hints whose proposal was dropped, because others changed it meanwhile. */
  let veraltet = $state<number[]>([]);
  /** The hints as checked; a take-over updates the versions of those it builds on. */
  // svelte-ignore state_referenced_locally
  let hinweise = $state<KiHinweis[]>(structuredClone($state.snapshot(pruefung.hinweise)));
  /** The people of the dish changed since the check: its amounts no longer fit. */
  const personenGeaendert = $derived(pruefung.personen !== gericht.personen);

  function zeileVon(hinweis: KiHinweis): GerichtZutat | undefined {
    return hinweis.zeile
      ? gericht.zutaten.find((zeile) => zeile.id === hinweis.zeile!.id)
      : undefined;
  }

  function nameVon(hinweis: KiHinweis): string | undefined {
    const zeile = zeileVon(hinweis);
    return zeile ? zutaten.get(zeile.planungZutatId)?.name : undefined;
  }

  /** Whether the proposal of a hint can be taken over now. */
  function angeboten(hinweis: KiHinweis): boolean {
    if (hinweis.aenderung || hinweis.entfernen) {
      if (!nameVon(hinweis)) return false;
      return !(personenGeaendert && hinweis.aenderung?.menge !== undefined);
    }
    if (hinweis.neueZeile) return !(personenGeaendert && hinweis.neueZeile.menge !== null);
    return hinweis.werkzeug !== undefined;
  }

  /** Runs a take-over; returns the view the server answered with, null when it failed. */
  async function speichern(
    arbeit: () => Promise<PlanungAnsicht>,
    erfolg: string
  ): Promise<PlanungAnsicht | null> {
    let ansicht: PlanungAnsicht | null = null;
    onuebernimmt(true);
    try {
      const ok = await kontext.aendern(async () => (ansicht = await arbeit()), erfolg);
      return ok ? ansicht : null;
    } finally {
      onuebernimmt(false);
    }
  }

  function veralten(index: number): void {
    hinweise[index] = {
      ...hinweise[index],
      aenderung: undefined,
      entfernen: undefined,
      werkzeug: undefined,
    };
    veraltet = [...veraltet, index];
  }

  /** Saves the proposed change with the version that was checked: a change since is a conflict. */
  async function zeileAendern(index: number, hinweis: KiHinweis): Promise<void> {
    const zeile = zeileVon(hinweis);
    if (!zeile || !hinweis.zeile || !hinweis.aenderung) return;
    const gesendet = aenderungBody(zeile, hinweis.aenderung, hinweis.zeile.etag);
    // An amount is for the people that were checked: a change of them meanwhile is a conflict
    const body =
      hinweis.aenderung.menge !== undefined
        ? { ...gesendet, personen: pruefung.personen }
        : gesendet;
    const ansicht = await speichern(
      () => kontext.api.senden<PlanungAnsicht>('PATCH', `/gericht-zutaten/${zeile.id}`, body),
      `Vorschlag für ${nameVon(hinweis) ?? 'die Zutat'} übernommen.`
    );
    if (!ansicht) return;
    uebernommen = [...uebernommen, index];
    const geschrieben = ansicht.gerichte.flatMap((g) => g.zutaten).find((z) => z.id === zeile.id);
    // Further hints on the same line build on this write only. If the answer already shows a
    // change of others, they would overwrite it: their proposals are dropped instead.
    const eigene = geschrieben && gleicheZeile(geschrieben, gesendet);
    for (const [weiterer, andere] of hinweise.entries()) {
      if (weiterer === index || andere.zeile?.id !== zeile.id) continue;
      if (eigene) andere.zeile.etag = geschrieben!.etag;
      else if ((andere.aenderung || andere.entfernen) && !uebernommen.includes(weiterer))
        veralten(weiterer);
    }
  }

  /** Whether `zeile` holds exactly the fields that were sent (a new ingredient by name aside). */
  function gleicheZeile(zeile: GerichtZutat, body: ReturnType<typeof aenderungBody>): boolean {
    const felder = [
      'menge',
      'einheit',
      'fest',
      'fuerAlles',
      'fuerVegetarisch',
      'fuerVegan',
      'ohne',
      'nur',
      'hinweis',
    ] as const;
    if ('planungZutatId' in body && body.planungZutatId !== zeile.planungZutatId) return false;
    return felder.every((feld) => JSON.stringify(zeile[feld]) === JSON.stringify(body[feld]));
  }

  async function zeileEntfernen(index: number, hinweis: KiHinweis): Promise<void> {
    const zeile = zeileVon(hinweis);
    const name = nameVon(hinweis);
    if (!zeile || !hinweis.zeile || !name) return;
    const ok = await confirmAction({
      title: `${name} entfernen?`,
      message: `Die Zeile wird aus „${gericht.name}“ entfernt.`,
      confirmLabel: 'Entfernen',
    });
    if (!ok) return;
    const etag = hinweis.zeile.etag;
    const ansicht = await speichern(
      () =>
        kontext.api.senden<PlanungAnsicht>(
          'DELETE',
          `/gericht-zutaten/${zeile.id}`,
          undefined,
          etag
        ),
      `${name} entfernt.`
    );
    if (ansicht) uebernommen = [...uebernommen, index];
  }

  async function zeileHinzufuegen(index: number, hinweis: KiHinweis): Promise<void> {
    const neu = hinweis.neueZeile;
    if (!neu) return;
    const ansicht = await speichern(
      () =>
        kontext.api.senden<PlanungAnsicht>('POST', `/gerichte/${gericht.id}/zutaten/sammel`, {
          zeilen: [neueZeileBody(neu)],
          // An amount is for the people that were checked
          ...(neu.menge !== null ? { personen: pruefung.personen } : {}),
        }),
      `${neu.zutat.name} hinzugefügt.`
    );
    if (ansicht) uebernommen = [...uebernommen, index];
  }

  async function werkzeugAendern(index: number, hinweis: KiHinweis): Promise<void> {
    const aenderung = hinweis.werkzeug;
    if (!aenderung) return;
    // Checked against the tools as the page shows them now, and sent with their version: an own
    // edit of the dish since the check does not get in the way, a change of others is a conflict
    const werkzeuge = werkzeugeNach(gericht.werkzeuge, aenderung);
    if (!werkzeuge) {
      veralten(index);
      return;
    }
    const ansicht = await speichern(
      () =>
        kontext.api.senden<PlanungAnsicht>('PATCH', `/gerichte/${gericht.id}`, {
          etag: gericht.etag,
          werkzeuge,
        }),
      werkzeugErfolg(aenderung)
    );
    if (ansicht) uebernommen = [...uebernommen, index];
  }

  function uebernehmen(index: number, hinweis: KiHinweis): Promise<void> {
    if (hinweis.aenderung) return zeileAendern(index, hinweis);
    if (hinweis.entfernen) return zeileEntfernen(index, hinweis);
    if (hinweis.neueZeile) return zeileHinzufuegen(index, hinweis);
    return werkzeugAendern(index, hinweis);
  }

  /** The visible label of the button of a hint. */
  function knopfText(hinweis: KiHinweis): string {
    const name = nameVon(hinweis);
    if (hinweis.aenderung) {
      const zeile = zeileVon(hinweis);
      return `Übernehmen: ${aenderungText(hinweis.aenderung, {
        name,
        abtropfgewicht: zutaten.get(zeile?.planungZutatId ?? 0)?.abtropfgewicht,
      })}`;
    }
    if (hinweis.entfernen) return `${name} entfernen`;
    if (hinweis.neueZeile) return `Hinzufügen: ${neueZeileText(hinweis.neueZeile)}`;
    return hinweis.werkzeug ? werkzeugText(hinweis.werkzeug) : '';
  }

  /** The name of the button for screen readers, naming the ingredient it is about. */
  function knopfName(hinweis: KiHinweis): string {
    const name = nameVon(hinweis);
    if (hinweis.aenderung)
      return `Vorschlag für ${name} übernehmen: ${aenderungText(hinweis.aenderung, { name })}`;
    if (hinweis.entfernen) return `${name} aus ${gericht.name} entfernen`;
    if (hinweis.neueZeile)
      return `${hinweis.neueZeile.zutat.name} zu ${gericht.name} hinzufügen: ${neueZeileText(hinweis.neueZeile)}`;
    return knopfText(hinweis);
  }

  /** What a hint is about, in bold before its text. */
  function bezugVon(hinweis: KiHinweis): string | undefined {
    const name = nameVon(hinweis);
    if (name) return name;
    if (hinweis.art === 'zubereitung') return 'Zubereitung';
    if (hinweis.art === 'werkzeug') return 'Werkzeug';
    return undefined;
  }
</script>

<div class="space-y-3 rounded-md border border-neutral-200 p-3" role="status">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <p class="font-semibold text-brand-900">KI-Hinweise zu {gericht.name}</p>
    <ActionButton type="button" onclick={onausblenden}>Ausblenden</ActionButton>
  </div>
  <p class="text-sm text-neutral-700">
    Von der KI erzeugt und ungeprüft. Entscheide selbst, was davon stimmt.
  </p>
  <p class="text-sm text-neutral-700">{geprueftText(pruefung)}</p>
  {#if personenGeaendert}
    <div class="flex flex-wrap items-center gap-2">
      <p class="text-sm text-warning">
        Die Personenzahl des Gerichts hat sich seit der Prüfung geändert; vorgeschlagene Mengen
        gelten nicht mehr.
      </p>
      <ActionButton type="button" disabled={!bearbeiten || gesperrt} onclick={onneu}>
        Gericht neu prüfen
      </ActionButton>
    </div>
  {/if}
  {#if pruefung.einschaetzung}
    <section aria-labelledby="gericht-{gericht.id}-ki-einschaetzung" class="space-y-1">
      <h5 id="gericht-{gericht.id}-ki-einschaetzung" class="font-semibold text-brand-900">
        Einschätzung
      </h5>
      <p class="whitespace-pre-line [overflow-wrap:anywhere]">{pruefung.einschaetzung}</p>
    </section>
  {/if}
  {#if hinweise.length}
    <ul class="divide-y divide-neutral-200 border-t border-neutral-200">
      {#each hinweise as hinweis, index (index)}
        {@const bezug = bezugVon(hinweis)}
        <li class="space-y-1 py-2">
          <p class="[overflow-wrap:anywhere]">
            {#if bezug}<span class="font-semibold">{bezug}:</span>{/if}
            {hinweis.text}
          </p>
          {#if hinweis.vorschlag}
            <p class="text-sm text-neutral-700 [overflow-wrap:anywhere]">
              Vorschlag: {hinweis.vorschlag}
            </p>
          {/if}
          {#if veraltet.includes(index)}
            <p class="text-sm text-warning">
              {hinweis.zeile ? 'Die Zutat' : 'Das Gericht'} wurde inzwischen auch anderweitig geändert.
              Lass das Gericht noch einmal prüfen.
            </p>
          {/if}
          {#if uebernommen.includes(index)}
            <p class="text-sm text-success">Übernommen.</p>
          {:else if angeboten(hinweis)}
            <ActionButton
              type="button"
              class="h-auto min-h-11 text-left whitespace-normal"
              variant={hinweis.entfernen ? 'danger' : 'secondary'}
              disabled={!bearbeiten || gesperrt}
              aria-label={knopfName(hinweis)}
              onclick={() => void uebernehmen(index, hinweis)}
            >
              {knopfText(hinweis)}
            </ActionButton>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p>Die KI hat nichts Auffälliges gefunden.</p>
  {/if}
</div>
