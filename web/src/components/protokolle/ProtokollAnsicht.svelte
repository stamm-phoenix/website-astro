<script lang="ts">
  import ProtokollText from './ProtokollText.svelte';
  import {
    aktionZeitraum,
    formatMeetingDate,
    formatShortDate,
    punktNummer,
  } from '../../lib/protokollEditor';
  import type { ProtokollAufgabe, ProtokollInhalt, ProtokollPunkt } from '../../lib/types';

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
  const anwesend = $derived(kopf.teilnehmende.filter((p) => p.status === 'anwesend'));
  const entschuldigt = $derived(kopf.teilnehmende.filter((p) => p.status === 'entschuldigt'));
  const naechste = $derived(inhalt.naechsteSitzung);
  const hasNaechste = $derived(Boolean(naechste.datum || naechste.uhrzeit || naechste.ort.trim()));

  function names(list: { name: string }[]): string {
    return list
      .map((p) => p.name.trim())
      .filter(Boolean)
      .join(', ');
  }
</script>

{#snippet aufgaben(list: ProtokollAufgabe[])}
  {#if list.some((a) => a.titel.trim())}
    <ul class="mt-2 space-y-1" aria-label="Aufgaben">
      {#each list.filter((a) => a.titel.trim()) as aufgabe (aufgabe.id)}
        <li class="border-l-2 border-accent-500 pl-3">
          <span class="font-semibold">Aufgabe:</span>
          {aufgabe.titel}
          {#if aufgabe.zustaendig.length > 0}
            <span class="text-neutral-700">– {names(aufgabe.zustaendig)}</span>
          {/if}
          {#if aufgabe.faellig}
            <span class="text-neutral-700">– bis {formatShortDate(aufgabe.faellig)}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

{#snippet punkt(item: ProtokollPunkt, index: number, subIndex: number | null)}
  {@const level = subIndex === null ? 2 : 3}
  <section
    id="{idPrefix}-{item.id}"
    class="punkt scroll-mt-28 space-y-2 rounded-[var(--radius-md)]"
    class:is-changed={changed.has(item.id)}
    class:is-active={active === item.id}
    aria-labelledby="{idPrefix}-{item.id}-titel"
  >
    <svelte:element
      this={level === 2 ? 'h3' : 'h4'}
      id="{idPrefix}-{item.id}-titel"
      class={level === 2
        ? 'text-lg font-semibold text-brand-900'
        : 'text-base font-semibold text-brand-900'}
    >
      <span class="tabular-nums">{punktNummer(index, subIndex ?? undefined)}</span>
      {item.titel.trim() || 'Ohne Titel'}
    </svelte:element>
    {#if item.aktion}
      {@const zeitraum = aktionZeitraum(item.aktion)}
      <p class="-mt-1 text-sm text-neutral-700">
        Aktion{zeitraum ? `, ${zeitraum}` : ''}
      </p>
    {/if}
    {#if item.text.trim()}
      <div class="space-y-2 leading-relaxed text-neutral-800">
        <ProtokollText text={item.text} />
      </div>
    {/if}
    {@render aufgaben(item.aufgaben)}
    {#if item.unterpunkte.length > 0}
      <div class="space-y-4 pl-4">
        {#each item.unterpunkte as sub, subIndex (sub.id)}
          {@render punkt(sub, index, subIndex)}
        {/each}
      </div>
    {/if}
  </section>
{/snippet}

<article class="protokoll-ansicht space-y-6" class:is-gross={gross} aria-label="Protokoll">
  <header class="space-y-3">
    <h2 class="font-serif text-2xl text-brand-900">
      {title.trim() || 'Protokoll'}{date ? ` am ${formatShortDate(date)}` : ''}
    </h2>
    <dl class="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
      {#if date}
        <dt class="font-semibold">Datum</dt>
        <dd>{formatMeetingDate(date)}</dd>
      {/if}
      <dt class="font-semibold">Sitzungsleitung</dt>
      <dd>{kopf.sitzungsleitung.trim() || '–'}</dd>
      <dt class="font-semibold">Protokoll</dt>
      <dd>{kopf.protokollant.trim() || '–'}</dd>
      <dt class="font-semibold">Beginn / Ende</dt>
      <dd>{kopf.beginn || '–'} / {kopf.ende || '–'} Uhr</dd>
      <dt class="font-semibold">Anwesend</dt>
      <dd>{names(anwesend) || '–'}</dd>
      {#if entschuldigt.length > 0}
        <dt class="font-semibold">Entschuldigt</dt>
        <dd>{names(entschuldigt)}</dd>
      {/if}
      {#if kopf.externe.trim()}
        <dt class="font-semibold">Externe</dt>
        <dd class="whitespace-pre-line">{kopf.externe}</dd>
      {/if}
    </dl>
  </header>

  <div class="space-y-6 border-t border-neutral-200 pt-4">
    {#each inhalt.punkte as item, index (item.id)}
      {@render punkt(item, index, null)}
    {:else}
      <p class="text-sm text-neutral-700">Noch keine Tagesordnungspunkte.</p>
    {/each}
  </div>

  {#if hasNaechste}
    <section class="border-t border-neutral-200 pt-4" aria-labelledby="{idPrefix}-naechste">
      <h3 id="{idPrefix}-naechste" class="text-lg font-semibold text-brand-900">
        Nächste Leitendenrunde
      </h3>
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
  .is-gross :global(h3) {
    font-size: 1.75rem;
  }
  .is-gross :global(h4) {
    font-size: 1.4rem;
  }
  @media (max-width: 40rem) {
    .is-gross {
      font-size: 1.125rem;
    }
    .is-gross :global(h2) {
      font-size: 1.75rem;
    }
    .is-gross :global(h3) {
      font-size: 1.4rem;
    }
  }
  .punkt {
    transition: background-color 1.2s ease-out;
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
</style>
