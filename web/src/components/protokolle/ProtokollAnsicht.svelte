<script lang="ts">
  import ProtokollText from './ProtokollText.svelte';
  import {
    aktionZeitraum,
    formatMeetingDate,
    formatShortDate,
    formatTermin,
    personNames,
    punktNummer,
  } from '../../lib/protokollEditor';
  import type {
    OffeneAufgabe,
    ProtokollAufgabe,
    ProtokollInhalt,
    ProtokollPerson,
    ProtokollPunkt,
    PunktTermin,
  } from '../../lib/types';

  /**
   * The minutes as they read: in the editor's preview, while reading along, in the
   * presentation window. Shows nothing that can be edited.
   */
  interface Props {
    title: string;
    date: string;
    inhalt: ProtokollInhalt;
    /** Agenda items that just changed; they light up briefly. */
    changed?: Set<string>;
    /** The item being written right now. */
    active?: string | null;
    /** Prefix for element IDs, so two views on one page do not clash. */
    idPrefix?: string;
    /** Large type and line width of the presentation window; reading on the page stays normal. */
    gross?: boolean;
  }
  let {
    title,
    date,
    inhalt,
    changed = new Set(),
    active = null,
    idPrefix = 'ansicht',
    gross = false,
  }: Props = $props();

  const kopf = $derived(inhalt.kopf);
  const anwesend = $derived(
    kopf.teilnehmende.filter((p) => p.status === 'anwesend' && p.name.trim())
  );
  const entschuldigt = $derived(
    kopf.teilnehmende.filter((p) => p.status === 'entschuldigt' && p.name.trim())
  );
  const zeit = $derived(
    kopf.beginn || kopf.ende ? `${kopf.beginn || '…'}–${kopf.ende || '…'} Uhr` : ''
  );
  const naechste = $derived(inhalt.naechsteSitzung);
  const hasNaechste = $derived(Boolean(naechste.datum || naechste.uhrzeit || naechste.ort.trim()));

  interface Eintrag<T> {
    nummer: string;
    item: T;
  }

  /** Every item with its number: the items and their sub-items in order. */
  const allePunkte = $derived(
    inhalt.punkte.flatMap((punkt, index) => [
      { nummer: punktNummer(index), punkt },
      ...punkt.unterpunkte.map((sub, subIndex) => ({
        nummer: punktNummer(index, subIndex),
        punkt: sub,
      })),
    ])
  );
  const alleAufgaben = $derived<Eintrag<ProtokollAufgabe>[]>(
    allePunkte.flatMap(({ nummer, punkt }) =>
      punkt.aufgaben.filter((a) => a.titel.trim()).map((item) => ({ nummer, item }))
    )
  );
  /** Termine by date; those without a date last. */
  const alleTermine = $derived<Eintrag<PunktTermin>[]>(
    allePunkte
      .flatMap(({ nummer, punkt }) =>
        punkt.termine.filter((t) => t.titel.trim()).map((item) => ({ nummer, item }))
      )
      .sort(
        (a, b) =>
          (a.item.datum || '9999').localeCompare(b.item.datum || '9999') ||
          (a.item.uhrzeit || '99').localeCompare(b.item.uhrzeit || '99')
      )
  );

  function names(list: ProtokollPerson[]): string {
    return personNames(list) || '–';
  }
</script>

{#snippet namensliste(list: ProtokollPerson[], label: string)}
  <ul class="namen" aria-label={label}>
    {#each list as person, index (index)}
      <li>{person.name.trim()}</li>
    {/each}
  </ul>
{/snippet}

{#snippet aufgabenTabelle(list: Eintrag<ProtokollAufgabe>[], mitPunkt: boolean, label: string)}
  <table class="liste" aria-label={label}>
    <thead>
      <tr>
        {#if mitPunkt}<th scope="col">Punkt</th>{/if}
        <th scope="col">Aufgabe</th>
        <th scope="col">Zuständig</th>
        <th scope="col">Fällig</th>
      </tr>
    </thead>
    <tbody>
      {#each list as { nummer, item } (item.id)}
        <tr>
          {#if mitPunkt}<td data-label="Punkt" class="tabular-nums">{nummer}</td>{/if}
          <td data-label="Aufgabe" class="font-semibold">{item.titel}</td>
          <td data-label="Zuständig">{names(item.zustaendig)}</td>
          <td data-label="Fällig" class="whitespace-nowrap tabular-nums"
            >{item.faellig ? formatShortDate(item.faellig) : '–'}</td
          >
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

{#snippet offeneTabelle(list: OffeneAufgabe[], label: string)}
  <table class="liste" aria-label={label}>
    <thead>
      <tr>
        <th scope="col">Stand</th>
        <th scope="col">Offene Aufgabe</th>
        <th scope="col">Zuständig</th>
        <th scope="col">Fällig</th>
      </tr>
    </thead>
    <tbody>
      {#each list as item (item.id)}
        <tr class:is-erledigt={item.erledigt}>
          <td data-label="Stand" class="whitespace-nowrap"
            >{item.erledigt ? 'Erledigt' : 'Noch offen'}</td
          >
          <td data-label="Offene Aufgabe" class="font-semibold">{item.titel}</td>
          <td data-label="Zuständig">{names(item.zustaendig)}</td>
          <td data-label="Fällig" class="whitespace-nowrap tabular-nums"
            >{item.faellig ? formatShortDate(item.faellig) : '–'}</td
          >
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

{#snippet termineTabelle(list: Eintrag<PunktTermin>[], mitPunkt: boolean, label: string)}
  <table class="liste" aria-label={label}>
    <thead>
      <tr>
        {#if mitPunkt}<th scope="col">Punkt</th>{/if}
        <th scope="col">Termin</th>
        <th scope="col">Wann</th>
        <th scope="col">Ort</th>
        <th scope="col">Zuständig</th>
      </tr>
    </thead>
    <tbody>
      {#each list as { nummer, item } (item.id)}
        <tr>
          {#if mitPunkt}<td data-label="Punkt" class="tabular-nums">{nummer}</td>{/if}
          <td data-label="Termin" class="font-semibold">{item.titel}</td>
          <td data-label="Wann" class="tabular-nums"
            >{formatTermin(item.datum, item.uhrzeit) || '–'}</td
          >
          <td data-label="Ort">{item.ort.trim() || '–'}</td>
          <td data-label="Zuständig">{names(item.zustaendig)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

{#snippet punkt(item: ProtokollPunkt, index: number, subIndex: number | null)}
  {@const nummer = punktNummer(index, subIndex ?? undefined)}
  {@const aufgaben = item.aufgaben.filter((a) => a.titel.trim())}
  {@const termine = item.termine.filter((t) => t.titel.trim())}
  <section
    id="{idPrefix}-{item.id}"
    class="punkt scroll-mt-28"
    class:is-sub={subIndex !== null}
    class:is-changed={changed.has(item.id)}
    class:is-active={active === item.id}
    aria-labelledby="{idPrefix}-{item.id}-titel"
  >
    <svelte:element
      this={subIndex === null ? 'h3' : 'h4'}
      id="{idPrefix}-{item.id}-titel"
      class="punkt-titel"
    >
      <span class="nummer tabular-nums">{nummer}</span>
      <span>{item.titel.trim() || 'Ohne Titel'}</span>
    </svelte:element>
    <div class="punkt-inhalt">
      {#if item.aktion}
        {@const zeitraum = aktionZeitraum(item.aktion)}
        <p class="text-sm text-neutral-700">Aktion{zeitraum ? `, ${zeitraum}` : ''}</p>
      {/if}
      {#if item.projekt}
        <p class="text-sm text-neutral-700">Projekt: {item.projekt.titel}</p>
      {/if}
      {#if item.offeneAufgaben.length > 0}
        {@render offeneTabelle(item.offeneAufgaben, `Offene Aufgaben zu Punkt ${nummer}`)}
      {/if}
      {#if item.text.trim()}
        <div class="lesetext">
          <ProtokollText text={item.text} headingLevel={subIndex === null ? 4 : 5} />
        </div>
      {/if}
      {#if aufgaben.length > 0}
        {@render aufgabenTabelle(
          aufgaben.map((a) => ({ nummer, item: a })),
          false,
          `Aufgaben zu Punkt ${nummer}`
        )}
      {/if}
      {#if termine.length > 0}
        {@render termineTabelle(
          termine.map((t) => ({ nummer, item: t })),
          false,
          `Termine zu Punkt ${nummer}`
        )}
      {/if}
      {#if item.unterpunkte.length > 0}
        <div class="unterpunkte">
          {#each item.unterpunkte as sub, at (sub.id)}
            {@render punkt(sub, index, at)}
          {/each}
        </div>
      {/if}
    </div>
  </section>
{/snippet}

<article class="protokoll-ansicht" class:is-gross={gross} aria-label="Protokoll">
  <header class="kopf surface-muted">
    <h2 class="font-serif text-2xl text-brand-900">
      {title.trim() || 'Protokoll'}{date ? ` am ${formatShortDate(date)}` : ''}
    </h2>
    {#if date || zeit}
      <p class="text-neutral-700">
        {[date ? formatMeetingDate(date) : '', zeit].filter(Boolean).join(' · ')}
      </p>
    {/if}
    <dl class="kopf-daten">
      <div>
        <dt>Sitzungsleitung</dt>
        <dd>{names(kopf.sitzungsleitung)}</dd>
      </div>
      <div>
        <dt>Protokoll</dt>
        <dd>{names(kopf.protokollant)}</dd>
      </div>
      <div class="breit">
        <dt>Anwesend{anwesend.length ? ` (${anwesend.length})` : ''}</dt>
        <dd>
          {#if anwesend.length}{@render namensliste(anwesend, 'Anwesend')}{:else}–{/if}
        </dd>
      </div>
      {#if entschuldigt.length > 0}
        <div class="breit">
          <dt>Entschuldigt ({entschuldigt.length})</dt>
          <dd>{@render namensliste(entschuldigt, 'Entschuldigt')}</dd>
        </div>
      {/if}
      {#if kopf.externe.trim()}
        <div class="breit">
          <dt>Externe</dt>
          <dd class="whitespace-pre-line">{kopf.externe}</dd>
        </div>
      {/if}
    </dl>
  </header>

  <div class="punkte">
    {#each inhalt.punkte as item, index (item.id)}
      {@render punkt(item, index, null)}
    {:else}
      <p class="text-sm text-neutral-700">Noch keine Tagesordnungspunkte.</p>
    {/each}
  </div>

  {#if alleAufgaben.length > 0 || alleTermine.length > 0}
    <div class="ueberblick">
      {#if alleAufgaben.length > 0}
        <section aria-labelledby="{idPrefix}-alle-aufgaben">
          <h3 id="{idPrefix}-alle-aufgaben" class="abschnitt-titel">Alle Aufgaben</h3>
          {@render aufgabenTabelle(alleAufgaben, true, 'Alle Aufgaben')}
        </section>
      {/if}
      {#if alleTermine.length > 0}
        <section aria-labelledby="{idPrefix}-alle-termine">
          <h3 id="{idPrefix}-alle-termine" class="abschnitt-titel">Alle Termine</h3>
          {@render termineTabelle(alleTermine, true, 'Alle Termine')}
        </section>
      {/if}
    </div>
  {/if}

  {#if hasNaechste}
    <section class="naechste surface-muted" aria-labelledby="{idPrefix}-naechste">
      <h3 id="{idPrefix}-naechste" class="abschnitt-titel">Nächste Leitendenrunde</h3>
      <p>
        {[
          naechste.datum ? formatMeetingDate(naechste.datum) : '',
          naechste.uhrzeit ? `${naechste.uhrzeit} Uhr` : '',
          naechste.ort.trim(),
        ]
          .filter(Boolean)
          .join(', ')}
      </p>
    </section>
  {/if}
</article>

<style>
  .protokoll-ansicht {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    min-width: 0;
  }

  /* Head */
  .kopf {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1.25rem 1.5rem;
  }
  .kopf-daten {
    display: grid;
    gap: 0.75rem 2rem;
    margin-top: 0.25rem;
  }
  @media (min-width: 40rem) {
    .kopf-daten {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .kopf-daten .breit {
      grid-column: 1 / -1;
    }
  }
  .kopf-daten dt {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-neutral-700);
  }
  .kopf-daten dd {
    margin-top: 0.15rem;
  }
  .namen {
    display: flex;
    flex-wrap: wrap;
    column-gap: 0.3rem;
  }
  .namen li:not(:last-child)::after {
    content: ',';
  }

  /* Agenda */
  .punkte {
    display: flex;
    flex-direction: column;
    gap: 2.25rem;
  }
  .punkt {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    border-radius: var(--radius-md);
    transition: background-color 1.2s ease-out;
  }
  .punkt-titel {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    font-size: 1.25rem;
    font-weight: 600;
    line-height: 1.3;
    color: var(--color-brand-900);
  }
  .punkt:not(.is-sub) > .punkt-titel {
    border-bottom: 1px solid var(--color-neutral-200);
    padding-bottom: 0.4rem;
  }
  .punkt-titel .nummer {
    flex: none;
    min-width: 2rem;
    color: var(--color-accent-500);
  }
  .punkt.is-sub .punkt-titel {
    font-size: 1.05rem;
  }
  .punkt.is-sub .punkt-titel .nummer {
    min-width: 2.25rem;
    color: var(--color-neutral-700);
  }
  .punkt-inhalt {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    padding-left: 2.75rem;
  }
  .punkt.is-sub .punkt-inhalt {
    padding-left: 3rem;
  }
  .unterpunkte {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    margin-top: 0.4rem;
    border-left: 2px solid var(--color-neutral-200);
    padding-left: 1rem;
  }
  @media (max-width: 40rem) {
    .punkt-inhalt,
    .punkt.is-sub .punkt-inhalt {
      padding-left: 0;
    }
    .unterpunkte {
      padding-left: 0.75rem;
    }
  }
  .lesetext {
    max-width: 72ch;
    line-height: 1.65;
    color: var(--color-neutral-800);
  }
  .punkt.is-changed {
    background-color: var(--color-warning-soft);
    transition: none;
  }
  .punkt.is-active {
    box-shadow: -0.75rem 0 0 -0.5rem var(--color-accent-500);
  }
  @media (prefers-reduced-motion: reduce) {
    .punkt {
      transition: none;
    }
  }

  /* Aufgaben and Termine */
  .liste {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9375em;
  }
  .liste th {
    border-bottom: 2px solid var(--color-neutral-200);
    padding: 0.35rem 0.75rem 0.35rem 0;
    text-align: left;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-neutral-700);
  }
  .liste tr.is-erledigt td:not(:first-child) {
    color: var(--color-neutral-700);
    text-decoration: line-through;
  }
  .liste td {
    border-bottom: 1px solid var(--color-neutral-200);
    padding: 0.45rem 0.75rem 0.45rem 0;
    vertical-align: top;
  }
  @media (max-width: 40rem) {
    /* One small card per row on the phone */
    .liste thead {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    .liste,
    .liste tbody,
    .liste tr,
    .liste td {
      display: block;
    }
    .liste tr {
      border-bottom: 1px solid var(--color-neutral-200);
      padding: 0.5rem 0;
    }
    .liste td {
      border: 0;
      padding: 0.1rem 0;
    }
    .liste td:not(:first-child)::before {
      content: attr(data-label) ': ';
      color: var(--color-neutral-700);
    }
    .liste td[data-label='Punkt']::before {
      content: 'Punkt ';
      color: var(--color-neutral-700);
    }
  }

  /* End of the minutes */
  .ueberblick {
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
    border-top: 2px solid var(--color-neutral-200);
    padding-top: 1.5rem;
  }
  .abschnitt-titel {
    margin-bottom: 0.5rem;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--color-brand-900);
  }
  .naechste {
    padding: 1rem 1.5rem;
  }

  /* Presentation window */
  .is-gross {
    width: 100%;
    max-width: 62rem;
    font-size: 1.375rem;
    line-height: 1.6;
  }
  .is-gross :global(.text-sm) {
    font-size: 1.125rem;
  }
  .is-gross :global(h2) {
    font-size: 2.25rem;
  }
  .is-gross .punkt-titel {
    font-size: 1.75rem;
  }
  .is-gross .punkt.is-sub .punkt-titel {
    font-size: 1.4rem;
  }
  .is-gross .lesetext {
    max-width: none;
  }
  @media (max-width: 40rem) {
    .is-gross {
      font-size: 1.125rem;
    }
    .is-gross :global(h2) {
      font-size: 1.75rem;
    }
    .is-gross .punkt-titel {
      font-size: 1.4rem;
    }
  }
</style>
