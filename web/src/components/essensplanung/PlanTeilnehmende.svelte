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
  import TeilnehmendeDialog from './TeilnehmendeDialog.svelte';
  import type { PlanKontext } from './planKontext';

  /** Groups and participants of a Planung and who eats at which meal. */

  interface Props {
    kontext: PlanKontext;
  }
  let { kontext }: Props = $props();
  const ansicht = $derived(kontext.ansicht);
  const bearbeiten = $derived(ansicht.zugang !== 'lesen' && !ansicht.wartung);

  /** The central lists, for the names of the intolerances. */
  let katalog = $state<EssenKatalog | null>(null);
  let katalogFehler = $state<string | null>(null);
  async function katalogLaden(): Promise<void> {
    katalogFehler = null;
    try {
      katalog = await kontext.api.katalog();
    } catch (error: unknown) {
      katalogFehler = errorMessage(error, 'Die Liste der Unverträglichkeiten fehlt.');
    }
  }
  $effect(() => {
    void ansicht.katalogStand;
    untrack(() => void katalogLaden());
  });
  const unvertraeglichkeit = $derived(
    new Map((katalog?.unvertraeglichkeiten ?? []).map((u) => [u.id, u.name]))
  );

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
    const ohne = zeile.unvertraeglichkeiten
      .map((id) => unvertraeglichkeit.get(id) ?? '')
      .filter(Boolean);
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
    <h3 id="esser-heading" class="font-serif text-lg font-bold text-brand-900">
      Esser je Mahlzeit
    </h3>
    <div class="overflow-x-auto">
      <table class="w-full text-left text-sm" aria-labelledby="esser-heading">
        <thead>
          <tr class="border-b border-neutral-300">
            <th scope="col" class="py-2 pr-3">Mahlzeit</th>
            <th scope="col" class="py-2 pr-3 text-right">Personen</th>
            <th scope="col" class="py-2 pr-3 text-right">Portionen</th>
            <th scope="col" class="py-2 pr-3 text-right">mit allem</th>
            <th scope="col" class="py-2 pr-3 text-right">vegetarisch</th>
            <th scope="col" class="py-2 text-right">vegan</th>
          </tr>
        </thead>
        {#each ansicht.tage as tag (tag.id)}
          <tbody>
            <tr>
              <th scope="rowgroup" colspan="6" class="pt-3 pb-1 font-semibold text-brand-900">
                Tag {tag.nummer} · {datumKurz(tag.datum)}
              </th>
            </tr>
            {#each tag.mahlzeiten as mahlzeit (mahlzeit.id)}
              {@const zahl = esser.get(mahlzeit.id)}
              <tr class="border-b border-neutral-200">
                <th scope="row" class="py-1.5 pr-3 font-normal">
                  <span class="font-mono font-semibold text-brand-900">{mahlzeit.kennung}</span>
                  {mahlzeit.name}
                  {#if mahlzeit.ohneGruppen.length}
                    <span class="block text-neutral-700"
                      >ohne {mahlzeit.ohneGruppen.map((id) => gruppenName.get(id)).join(', ')}</span
                    >
                  {/if}
                </th>
                <td class="py-1.5 pr-3 text-right tabular-nums">{zahl?.personen ?? 0}</td>
                <td class="py-1.5 pr-3 text-right tabular-nums">{zahlText(zahl?.gewichtet ?? 0)}</td
                >
                <td class="py-1.5 pr-3 text-right tabular-nums">{zahl?.je.alles.personen ?? 0}</td>
                <td class="py-1.5 pr-3 text-right tabular-nums"
                  >{zahl?.je.vegetarisch.personen ?? 0}</td
                >
                <td class="py-1.5 text-right tabular-nums">{zahl?.je.vegan.personen ?? 0}</td>
              </tr>
            {/each}
          </tbody>
        {/each}
      </table>
    </div>
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
  zeileId={zeileDialog}
  onclose={() => (zeileDialog = undefined)}
/>
