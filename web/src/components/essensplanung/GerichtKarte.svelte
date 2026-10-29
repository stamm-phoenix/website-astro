<script lang="ts">
  import { untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import FormField from '../pflege/FormField.svelte';
  import TagInput from '../pflege/TagInput.svelte';
  import LazyTextEditor from '../ui/LazyTextEditor.svelte';
  import ProtokollText from '../protokolle/ProtokollText.svelte';
  import { ApiError } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import { zeileBody } from '../../lib/essensplanungGerichte';
  import { plaetzeVon } from '../../lib/essensplanungEinplanung';
  import {
    einheitText,
    gerichtStand,
    gerichtWarnungen,
  } from '../../../../api/lib/essen-gerichte-model';
  import type { EssenKatalog, Gericht, GerichtLink, GerichtZutat } from '../../lib/types';
  import GerichtPlaetze from './GerichtPlaetze.svelte';
  import NeueZutatZeile, { angefangen, leereZeile } from './NeueZutatZeile.svelte';
  import ZutatZeileInline from './ZutatZeileInline.svelte';
  import GerichtZeileDialog, { type ZeilenVorgabe } from './GerichtZeileDialog.svelte';
  import PdfKnopf from './PdfKnopf.svelte';
  import { meldeVerloren, type PlanKontext } from './planKontext';

  /**
   * One dish: its lines with warnings, and (for those who edit) its fields as a draft that the
   * changes of others do not overwrite. Printed alone as a recipe card.
   */

  interface Props {
    kontext: PlanKontext;
    katalog: EssenKatalog | null;
    gericht: Gericht;
    bearbeiten: boolean;
    /** True while the card is open in the shown tab. */
    sichtbar: boolean;
    /** Downloads the recipe card of the dish. */
    onpdf: () => Promise<void>;
  }
  let { kontext, katalog, gericht, bearbeiten, sichtbar, onpdf }: Props = $props();

  /** The editor loads once the card is first shown and then stays, keeping its state. */
  let editorGeladen = $state(false);
  $effect(() => {
    if (sichtbar) editorGeladen = true;
  });
  const ansicht = $derived(kontext.ansicht);
  const zutaten = $derived(new Map(ansicht.zutaten.map((zutat) => [zutat.id, zutat])));
  const unvertraeglichkeiten = $derived(
    new Map((katalog?.unvertraeglichkeiten ?? []).map((u) => [u.id, u.name]))
  );
  const warnungen = $derived(gerichtWarnungen(gericht, zutaten));

  interface Kopf {
    name: string;
    personen: string;
    anleitung: string;
    notiz: string;
    werkzeuge: string[];
    links: GerichtLink[];
  }
  const kopfVon = (g: Gericht): Kopf => ({
    name: g.name,
    personen: String(g.personen),
    anleitung: g.anleitung,
    notiz: g.notiz,
    werkzeuge: [...g.werkzeuge],
    links: g.links.map((link) => ({ ...link })),
  });
  const gleich = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  /** The saved fields the form started from and the input. */
  let basis = $state<Kopf>(kopfVon(untrack(() => gericht)));
  /** The version of the saved fields the form started from. */
  let basisEtag = untrack(() => gericht.etag);
  let kopf = $state<Kopf>(kopfVon(untrack(() => gericht)));
  let felder = $state<Record<string, string>>({});
  /** A tool name typed but not yet added. */
  let werkzeugEntwurf = $state('');
  const entwurf = $derived(!gleich(kopf, basis) || werkzeugEntwurf.trim() !== '');
  $effect(() => {
    const neu = kopfVon(gericht);
    untrack(() => {
      if (entwurf) return;
      basis = neu;
      basisEtag = gericht.etag;
      kopf = kopfVon(gericht);
    });
  });
  $effect(() => guardUnsavedChanges(() => entwurf));
  /** The new row of ingredients; kept here, so a read-only phase does not lose it. */
  let neueZeile = $state(leereZeile());
  $effect(() => guardUnsavedChanges(() => angefangen(neueZeile)));

  /** Set when this page deletes the dish itself, which needs no word about lost input. */
  let selbstGeloescht = false;
  // Someone else deleted the dish: the card goes, so the unsaved fields are shown to copy
  $effect(() => () => {
    if (selbstGeloescht || (!entwurf && !angefangen(neueZeile))) return;
    const neu = neueZeile;
    const eingaben = (Object.keys(kopf) as (keyof Kopf)[])
      .filter((feld) => !gleich(kopf[feld], basis[feld]))
      .map((feld) => `${FELD_NAMEN[feld]}: ${textVon(kopf[feld])}`)
      .concat(werkzeugEntwurf.trim() ? [`${FELD_NAMEN.werkzeuge}: ${werkzeugEntwurf.trim()}`] : [])
      .concat(
        angefangen(neu)
          ? [
              `Neue Zutat: ${[neu.name.trim(), neu.menge.trim() && `${neu.menge.trim()} ${einheitText(neu.einheit)}`, neu.hinweis.trim()].filter(Boolean).join(', ')}`,
            ]
          : []
      )
      .join(' · ');
    meldeVerloren(
      kontext,
      `„${gericht.name}“ wurde gerade gelöscht. Deine ungespeicherten Eingaben: ${eingaben}`
    );
  });

  const FELD_NAMEN: Record<keyof Kopf, string> = {
    name: 'Name',
    personen: 'Personen',
    anleitung: 'Anleitung',
    notiz: 'Notiz',
    werkzeuge: 'Werkzeuge',
    links: 'Links',
  };

  function textVon(wert: Kopf[keyof Kopf]): string {
    if (typeof wert === 'string') return wert;
    return wert.map((eintrag) => (typeof eintrag === 'string' ? eintrag : eintrag.url)).join(', ');
  }

  async function speichern(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    felder = {};
    const personen = Number(kopf.personen);
    const geaenderteFelder = (Object.keys(kopf) as (keyof Kopf)[]).filter(
      (feld) => !gleich(kopf[feld], basis[feld])
    );
    // With the version the form started from: a change of others meanwhile is a conflict
    const body: Record<string, unknown> = { etag: basisEtag };
    // Empty links are left out; the form index of each sent one, for the errors coming back
    const linkIndex = kopf.links.flatMap((link, index) =>
      link.url.trim() || link.titel.trim() ? [index] : []
    );
    for (const feld of geaenderteFelder) {
      body[feld] =
        feld === 'personen'
          ? Number.isInteger(personen)
            ? personen
            : kopf.personen
          : feld === 'links'
            ? linkIndex.map((index) => kopf.links[index])
            : kopf[feld];
    }
    const gesendet = $state.snapshot(kopf);
    const ok = await kontext.aendern(async () => {
      try {
        return await kontext.api.senden('PATCH', `/gerichte/${gericht.id}`, body);
      } catch (error: unknown) {
        if (error instanceof ApiError && error.fields)
          felder = Object.fromEntries(
            Object.entries(error.fields).map(([feld, text]) => [
              feld.replace(/^links\.(\d+)\./, (_, i) => `links.${linkIndex[Number(i)] ?? i}.`),
              text,
            ])
          );
        throw error;
      }
    }, `${kopf.name} gespeichert.`);
    const aktuell = kopfVon(gericht);
    // What was typed again while saving stays as a draft; after a conflict the fields left alone
    // show what others saved
    for (const feld of Object.keys(kopf) as (keyof Kopf)[]) {
      const weiter = !gleich(kopf[feld], gesendet[feld]);
      const unberuehrt = !geaenderteFelder.includes(feld);
      if (!weiter && (ok || unberuehrt)) kopf = { ...kopf, [feld]: aktuell[feld] };
    }
    basis = aktuell;
    basisEtag = gericht.etag;
  }

  async function loeschen(): Promise<void> {
    // The dish as asked about: a change of others during the question is a conflict
    const { id, name } = gericht;
    const etag = gerichtStand(
      gericht,
      plaetze.map((platz) => platz.einplanung.etag)
    );
    const anzahl = plaetze.length;
    if (
      !(await confirmAction({
        title: `„${name}“ löschen?`,
        message: `Das Gericht wird mit allen ${gericht.zutaten.length} Zutaten gelöscht${anzahl ? ` und aus ${anzahl === 1 ? 'seiner Mahlzeit' : `${anzahl} Mahlzeiten`} genommen` : ''}.`,
        confirmLabel: 'Gericht löschen',
      }))
    )
      return;
    selbstGeloescht = true;
    const ok = await kontext.aendern(
      () => kontext.api.senden('DELETE', `/gerichte/${id}`, undefined, etag),
      `${name} gelöscht.`
    );
    if (!ok) selbstGeloescht = false;
  }

  async function verschiebe(zeile: GerichtZutat, position: number): Promise<void> {
    await kontext.aendern(() =>
      kontext.api.senden('PATCH', `/gericht-zutaten/${zeile.id}`, { ...zeileBody(zeile), position })
    );
  }

  async function zeileLoeschen(zeile: GerichtZutat): Promise<void> {
    const name = zutaten.get(zeile.planungZutatId)?.name ?? 'Zutat';
    if (
      !(await confirmAction({
        title: `${name} entfernen?`,
        message: `Die Zeile wird aus „${gericht.name}“ entfernt.`,
        confirmLabel: 'Entfernen',
      }))
    )
      return;
    await kontext.aendern(
      () => kontext.api.senden('DELETE', `/gericht-zutaten/${zeile.id}`, undefined, zeile.etag),
      `${name} entfernt.`
    );
  }

  let dialog = $state<{
    zeile: GerichtZutat | null;
    vorgabe: ZeilenVorgabe | null;
  } | null>(null);

  /** Where the dish is planned. */
  const plaetze = $derived(plaetzeVon(ansicht, gericht.id));
</script>

<div class="space-y-5">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="space-y-1">
      <p class="text-neutral-700">Mengen für {gericht.personen} Personen</p>
      <GerichtPlaetze {plaetze} />
    </div>
    <div class="flex flex-wrap gap-2 print:hidden">
      <!-- Only with the list, so the card names all allergens -->
      <PdfKnopf
        {kontext}
        label="Rezeptkarte als PDF"
        ariaLabel="Rezeptkarte als PDF: {gericht.name}"
        disabled={!katalog}
        erstellen={onpdf}
      />
      {#if bearbeiten}
        <ActionButton
          type="button"
          variant="danger"
          disabled={kontext.busy}
          onclick={() => void loeschen()}>Gericht löschen</ActionButton
        >
      {/if}
    </div>
  </div>

  {#if warnungen.length}
    <ul class="space-y-1 border-l-4 border-warning py-1 pl-3 text-sm text-warning" role="status">
      {#each warnungen as warnung, index (index)}
        <li>{warnung.text}</li>
      {/each}
    </ul>
  {/if}

  <section aria-labelledby="gericht-{gericht.id}-zutaten" class="space-y-2">
    <h4 id="gericht-{gericht.id}-zutaten" class="font-semibold text-brand-900">Zutaten</h4>
    {#if gericht.zutaten.length}
      <ol class="divide-y divide-neutral-200 border-y border-neutral-200">
        {#each gericht.zutaten as zeile, index (zeile.id)}
          <ZutatZeileInline
            {kontext}
            {zeile}
            zutat={zutaten.get(zeile.planungZutatId)}
            {bearbeiten}
            erste={index === 0}
            letzte={index === gericht.zutaten.length - 1}
            namen={unvertraeglichkeiten}
            katalogDa={katalog !== null}
            position={index + 1}
            onaendern={() => (dialog = { zeile, vorgabe: null })}
            onverschiebe={(position) => void verschiebe(zeile, position)}
            onloeschen={() => void zeileLoeschen(zeile)}
          />
        {/each}
      </ol>
    {:else}
      <p class="text-sm text-neutral-700">Noch keine Zutaten.</p>
    {/if}
    {#if bearbeiten && katalog}
      <NeueZutatZeile
        {kontext}
        {katalog}
        {gericht}
        bind:eingabe={neueZeile}
        onmehr={(vorgabe) => (dialog = { zeile: null, vorgabe })}
      />
    {/if}
  </section>

  {#if bearbeiten}
    <form class="space-y-4 print:hidden" onsubmit={speichern}>
      <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <FormField id="gericht-{gericht.id}-name" label="Name" error={felder.name}>
          {#snippet children(attrs)}
            <input {...attrs} class="form-input" maxlength="150" bind:value={kopf.name} />
          {/snippet}
        </FormField>
        <FormField
          id="gericht-{gericht.id}-personen"
          label="Personen"
          error={felder.personen}
          info="Für so viele Personen gelten die Mengen der Zutaten."
        >
          {#snippet children(attrs)}
            <input {...attrs} class="form-input" inputmode="numeric" bind:value={kopf.personen} />
          {/snippet}
        </FormField>
      </div>
      <FormField
        id="gericht-{gericht.id}-anleitung"
        label="Anleitung"
        labelAs="span"
        optional
        error={felder.anleitung}
      >
        {#snippet children(attrs)}
          {#if editorGeladen}
            <LazyTextEditor
              id={attrs.id}
              labelledBy="{attrs.id}-label"
              describedBy={attrs['aria-describedby']}
              invalid={attrs['aria-invalid'] === 'true'}
              placeholder="z. B. Zwiebeln anbraten, dann …"
              maxLength={20_000}
              bind:value={kopf.anleitung}
            />
          {/if}
        {/snippet}
      </FormField>
      <FormField
        id="gericht-{gericht.id}-werkzeuge"
        label="Werkzeuge"
        optional
        error={felder.werkzeuge}
      >
        {#snippet children(attrs)}
          <TagInput
            id={attrs.id}
            tags={kopf.werkzeuge}
            placeholder="z. B. Pürierstab"
            onchange={(werkzeuge) => (kopf.werkzeuge = werkzeuge)}
            ondraftchange={(text) => (werkzeugEntwurf = text)}
          />
        {/snippet}
      </FormField>
      <fieldset class="space-y-2">
        <legend class="form-label">Links</legend>
        {#each kopf.links as link, index (index)}
          <div class="flex flex-wrap items-end gap-2">
            <FormField
              id="gericht-{gericht.id}-link-{index}-titel"
              label="Titel"
              optional
              class="min-w-0 flex-1"
              error={felder[`links.${index}.titel`]}
            >
              {#snippet children(attrs)}
                <input {...attrs} class="form-input" maxlength="100" bind:value={link.titel} />
              {/snippet}
            </FormField>
            <FormField
              id="gericht-{gericht.id}-link-{index}-url"
              label="Adresse"
              class="min-w-0 flex-[2]"
              error={felder[`links.${index}.url`]}
            >
              {#snippet children(attrs)}
                <input
                  {...attrs}
                  class="form-input"
                  type="url"
                  placeholder="https://"
                  bind:value={link.url}
                />
              {/snippet}
            </FormField>
            <ActionButton
              type="button"
              aria-label="Link {index + 1} entfernen"
              onclick={() => kopf.links.splice(index, 1)}>Entfernen</ActionButton
            >
          </div>
        {/each}
        <ActionButton
          type="button"
          disabled={kopf.links.length >= 10}
          onclick={() => kopf.links.push({ titel: '', url: '' })}>Link hinzufügen</ActionButton
        >
      </fieldset>
      <FormField id="gericht-{gericht.id}-notiz" label="Notiz" optional error={felder.notiz}>
        {#snippet children(attrs)}
          <textarea {...attrs} class="form-input min-h-20" bind:value={kopf.notiz}></textarea>
        {/snippet}
      </FormField>
      <ActionButton type="submit" variant="primary" disabled={kontext.busy || !entwurf}
        >Gericht speichern</ActionButton
      >
    </form>
  {/if}

  <!-- Read-only and for the recipe card -->
  <div class={bearbeiten ? 'hidden space-y-3 print:block' : 'space-y-3'}>
    {#if gericht.anleitung}
      <div>
        <h4 class="font-semibold text-brand-900">Anleitung</h4>
        <div class="[overflow-wrap:anywhere]">
          <ProtokollText text={gericht.anleitung} headingLevel={5} />
        </div>
      </div>
    {/if}
    {#if gericht.werkzeuge.length}
      <div>
        <h4 class="font-semibold text-brand-900">Werkzeuge</h4>
        <p>{gericht.werkzeuge.join(', ')}</p>
      </div>
    {/if}
    {#if gericht.links.length}
      <div>
        <h4 class="font-semibold text-brand-900">Links</h4>
        <ul>
          {#each gericht.links as link, index (index)}
            <li class="[overflow-wrap:anywhere]">
              <a
                class="text-link underline"
                href={link.url}
                target="_blank"
                rel="noopener noreferrer">{link.titel || link.url}</a
              >
              <!-- Paper has no links: the address is printed after the title -->
              {#if link.titel}<span class="hidden print:inline">({link.url})</span>{/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
    {#if gericht.notiz}
      <div>
        <h4 class="font-semibold text-brand-900">Notiz</h4>
        <p class="whitespace-pre-line [overflow-wrap:anywhere]">{gericht.notiz}</p>
      </div>
    {/if}
  </div>
</div>

{#if katalog && dialog}
  <GerichtZeileDialog
    {kontext}
    {katalog}
    {gericht}
    zeile={dialog.zeile}
    vorgabe={dialog.vorgabe}
    open={dialog !== null}
    onclose={() => (dialog = null)}
  />
{/if}
