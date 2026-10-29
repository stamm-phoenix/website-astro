<script lang="ts">
  import { untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { errorMessage } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import { datumKurz } from '../../lib/essensplanung';
  import { ERNAEHRUNG_TEXT, zahlText, zeitraumText } from '../../lib/essensplanungTeilnehmende';
  import { esserJeMahlzeit } from '../../../../api/lib/essen-teilnehmende-model';
  import type { EssenKatalog, PlanungGruppe, Teilnehmende } from '../../lib/types';
  import GruppeDialog from './GruppeDialog.svelte';
  import PdfKnopf from './PdfKnopf.svelte';
  import QuerScroll from '../ui/QuerScroll.svelte';
  import TeilnehmendeDialog from './TeilnehmendeDialog.svelte';
  import type { PlanKontext } from './planKontext';

  /** Groups and participants of a Planung and who eats at which meal. */

  interface Props {
    kontext: PlanKontext;
    /** Whether the area is shown; the central lists load only then. */
    sichtbar: boolean;
  }
  let { kontext, sichtbar }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const bearbeiten = $derived(ansicht.zugang !== 'lesen' && !ansicht.wartung);

  /** The central lists, for the names of the intolerances. */
  let katalog = $state<EssenKatalog | null>(null);
  let katalogFehler = $state<string | null>(null);
  /** The `katalogStand` the lists were loaded for. */
  let geladen: string | null = null;
  async function katalogLaden(): Promise<void> {
    katalogFehler = null;
    geladen = ansicht.katalogStand;
    try {
      katalog = await kontext.api.katalog();
    } catch (error: unknown) {
      // Not loaded: the next view or the button tries again
      geladen = null;
      katalogFehler = errorMessage(error, 'Die Liste der Unverträglichkeiten fehlt.');
    }
  }
  $effect(() => {
    if (sichtbar && ansicht.katalogStand !== geladen) untrack(() => void katalogLaden());
  });
  const unvertraeglichkeit = $derived(
    new Map((katalog?.unvertraeglichkeiten ?? []).map((u) => [u.id, u.name]))
  );

  /** The eaters and the participants as PDF; the names of the intolerances first. */
  async function esserPdf(): Promise<void> {
    const liste = katalog ?? (await kontext.api.katalog());
    const namen = new Map(liste.unvertraeglichkeiten.map((u) => [u.id, u.name]));
    const { downloadEsserPdf } = await import('../../lib/essensplanungPdf');
    await downloadEsserPdf(ansicht, namen);
  }

  const esser = $derived(esserJeMahlzeit(ansicht));
  const gruppenName = $derived(new Map(ansicht.gruppen.map((g) => [g.id, g.name])));
  const personenJeGruppe = $derived(
    new Map(
      ansicht.gruppen.map((g) => [
        g.id,
        ansicht.teilnehmende
          .filter((z) => z.gruppeId === g.id)
          .reduce((summe, z) => summe + z.anzahl, 0),
      ])
    )
  );
  const insgesamt = $derived(ansicht.teilnehmende.reduce((summe, z) => summe + z.anzahl, 0));

  let gruppeDialog = $state<number | null | undefined>(undefined);
  let zeileDialog = $state<number | null | undefined>(undefined);

  function zeileText(zeile: Teilnehmende): string {
    const namen = zeile.unvertraeglichkeiten
      .map((id) => unvertraeglichkeit.get(id) ?? '')
      .filter(Boolean);
    // While the list loads or failed, the row still says that it has intolerances
    const offen = zeile.unvertraeglichkeiten.length - namen.length;
    const ohne = offen
      ? [...namen, `${offen}${namen.length ? ' weitere' : ''} (Liste nicht geladen)`]
      : namen;
    return [
      ERNAEHRUNG_TEXT[zeile.ernaehrung],
      ohne.length ? `Unverträglichkeiten: ${ohne.join(', ')}` : '',
      zeitraumText(ansicht, zeile),
      zeile.hinweis,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  async function gruppeLoeschen(gruppe: PlanungGruppe): Promise<void> {
    const { id, etag, name } = gruppe;
    if (
      !(await confirmAction({
        title: `Gruppe ${name} löschen?`,
        message: 'Die Gruppe verschwindet aus dieser Planung.',
        confirmLabel: 'Löschen',
      }))
    )
      return;
    await kontext.aendern(
      () => kontext.api.senden('DELETE', `/gruppen/${id}`, undefined, etag),
      `${name} gelöscht.`
    );
  }

  async function zeileLoeschen(zeile: Teilnehmende): Promise<void> {
    const { id, etag, anzahl } = zeile;
    const gruppe = gruppenName.get(zeile.gruppeId) ?? '';
    if (
      !(await confirmAction({
        title: `${anzahl} ${gruppe} entfernen?`,
        message: 'Die Zeile verschwindet aus den Teilnehmenden.',
        confirmLabel: 'Entfernen',
      }))
    )
      return;
    await kontext.aendern(
      () => kontext.api.senden('DELETE', `/teilnehmende/${id}`, undefined, etag),
      `${anzahl} ${gruppe} entfernt.`
    );
  }
</script>

<div class="space-y-8">
  <section aria-labelledby="teilnehmende-heading" class="space-y-3">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h3 id="teilnehmende-heading" class="font-serif text-lg font-bold text-brand-900">
        Teilnehmende
      </h3>
      <p class="text-sm text-neutral-700">Insgesamt {insgesamt} Personen</p>
    </div>
    {#if katalogFehler}
      <p class="text-sm text-danger print:hidden" role="alert">
        {katalogFehler}
        <button
          type="button"
          class="min-h-11 font-semibold underline"
          onclick={() => void katalogLaden()}>Noch einmal versuchen</button
        >
      </p>
    {/if}
    {#each ansicht.gruppen as gruppe (gruppe.id)}
      {@const zeilen = ansicht.teilnehmende.filter((z) => z.gruppeId === gruppe.id)}
      {#if zeilen.length}
        <div>
          <h4 class="font-semibold text-brand-900">{gruppe.name}</h4>
          <ul
            class="divide-y divide-neutral-200 border-y border-neutral-200"
            aria-label="Teilnehmende {gruppe.name}"
          >
            {#each zeilen as zeile (zeile.id)}
              <li class="flex flex-wrap items-center justify-between gap-2 py-2">
                <p class="min-w-0 [overflow-wrap:anywhere]">
                  <span class="font-semibold tabular-nums">{zeile.anzahl}</span>
                  <span class="text-neutral-700">{zeileText(zeile)}</span>
                </p>
                {#if bearbeiten}
                  <span class="flex gap-1 print:hidden">
                    <ActionButton
                      type="button"
                      aria-label="{zeile.anzahl} {gruppe.name} {ERNAEHRUNG_TEXT[
                        zeile.ernaehrung
                      ]} ändern"
                      onclick={() => (zeileDialog = zeile.id)}>Ändern</ActionButton
                    >
                    <ActionButton
                      type="button"
                      variant="danger"
                      disabled={kontext.busy}
                      aria-label="{zeile.anzahl} {gruppe.name} {ERNAEHRUNG_TEXT[
                        zeile.ernaehrung
                      ]} entfernen"
                      onclick={() => void zeileLoeschen(zeile)}>Entfernen</ActionButton
                    >
                  </span>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {/each}
    {#if !ansicht.teilnehmende.length}
      <p class="text-neutral-700">Noch keine Teilnehmenden.</p>
    {/if}
    {#if bearbeiten && ansicht.gruppen.length}
      <ActionButton type="button" class="print:hidden" onclick={() => (zeileDialog = null)}
        >Teilnehmende hinzufügen</ActionButton
      >
    {/if}
  </section>

  <section aria-labelledby="esser-heading" class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 id="esser-heading" class="font-serif text-lg font-bold text-brand-900">
        Esser je Mahlzeit
      </h3>
      <PdfKnopf {kontext} label="Esser je Mahlzeit als PDF" erstellen={esserPdf} />
    </div>
    <QuerScroll
      label="Esser je Mahlzeit"
      hinweis="Weitere Tage siehst du, wenn du seitlich wischst oder scrollst."
    >
      <ol class="flex gap-3" aria-labelledby="esser-heading">
        {#each ansicht.tage as tag (tag.id)}
          <li class="w-44 shrink-0 space-y-2 sm:w-auto sm:min-w-40 sm:flex-1">
            <h4 class="text-sm font-semibold text-brand-900">
              Tag {tag.nummer}
              <span class="block font-normal text-neutral-700">{datumKurz(tag.datum)}</span>
            </h4>
            <ul class="space-y-2">
              {#each tag.mahlzeiten as mahlzeit (mahlzeit.id)}
                {@const zahl = esser.get(mahlzeit.id)}
                <li
                  class="rounded-lg border border-neutral-200 bg-surface p-2 text-sm"
                  data-esser={mahlzeit.kennung}
                >
                  <p class="[overflow-wrap:anywhere]">
                    <span class="font-mono font-semibold text-brand-900">{mahlzeit.kennung}</span>
                    {mahlzeit.name}
                  </p>
                  {#if mahlzeit.ohneGruppen.length}
                    <p class="text-neutral-700">
                      ohne {mahlzeit.ohneGruppen.map((id) => gruppenName.get(id)).join(', ')}
                    </p>
                  {/if}
                  <p class="text-lg font-bold text-neutral-900 tabular-nums">
                    <span data-zahl>{zahl?.personen ?? 0}</span>
                    <span class="text-sm font-normal">Personen</span>
                  </p>
                  <p class="text-neutral-700 tabular-nums">
                    mit allem <span data-zahl>{zahl?.je.alles.personen ?? 0}</span> · vegetarisch
                    <span data-zahl>{zahl?.je.vegetarisch.personen ?? 0}</span> · vegan
                    <span data-zahl>{zahl?.je.vegan.personen ?? 0}</span>
                  </p>
                </li>
              {/each}
            </ul>
          </li>
        {/each}
      </ol>
    </QuerScroll>
  </section>

  <section aria-labelledby="gruppen-heading" class="space-y-3">
    <h3 id="gruppen-heading" class="font-serif text-lg font-bold text-brand-900">Gruppen</h3>
    <ul class="divide-y divide-neutral-200 border-y border-neutral-200" aria-label="Gruppen">
      {#each ansicht.gruppen as gruppe (gruppe.id)}
        <li class="flex flex-wrap items-center justify-between gap-2 py-2">
          <p class="min-w-0 [overflow-wrap:anywhere]">
            <span class="font-semibold">{gruppe.name}</span>
            <span class="text-sm text-neutral-700"
              >Faktor {zahlText(gruppe.faktor)} · {personenJeGruppe.get(gruppe.id) ?? 0} Personen</span
            >
          </p>
          {#if bearbeiten}
            <span class="flex gap-1 print:hidden">
              <ActionButton
                type="button"
                aria-label="Gruppe {gruppe.name} ändern"
                onclick={() => (gruppeDialog = gruppe.id)}>Ändern</ActionButton
              >
              {#if !personenJeGruppe.get(gruppe.id)}
                <ActionButton
                  type="button"
                  variant="danger"
                  disabled={kontext.busy}
                  aria-label="Gruppe {gruppe.name} löschen"
                  onclick={() => void gruppeLoeschen(gruppe)}>Löschen</ActionButton
                >
              {/if}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
    {#if bearbeiten}
      <ActionButton type="button" class="print:hidden" onclick={() => (gruppeDialog = null)}
        >Gruppe hinzufügen</ActionButton
      >
    {/if}
  </section>
</div>

<GruppeDialog {kontext} gruppeId={gruppeDialog} onclose={() => (gruppeDialog = undefined)} />
<TeilnehmendeDialog
  {kontext}
  {katalog}
  {katalogFehler}
  onkatalog={() => void katalogLaden()}
  zeileId={zeileDialog}
  onclose={() => (zeileDialog = undefined)}
/>
