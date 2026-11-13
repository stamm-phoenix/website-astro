<script lang="ts">
  import { untrack } from 'svelte';
  import ErwaehnungListe from './ErwaehnungListe.svelte';
  import ProtokollMarkdownPunkt from './ProtokollMarkdownPunkt.svelte';
  import { ErwaehnungAuswahl } from '../../lib/erwaehnungAuswahl.svelte';
  import { erwaehnungMarkdown, erwaehnungSuche } from '../../lib/protokollErwaehnung';
  import { newElementId } from '../../lib/protokollEditor';
  import { continueList } from '../../lib/protokollMarkdown';
  import { abgleichen } from '../../lib/protokollMarkdownAbgleich';
  import {
    dokumentText,
    grenzen,
    liesDokument,
    punktAnZeile,
  } from '../../lib/protokollMarkdownDokument';
  import type { DokumentProblem } from '../../lib/protokollMarkdownDokument';
  import { personFinder, schluesselOf } from '../../lib/protokollMarkdownZeilen';
  import type {
    PersonOption,
    ProtokollPerson,
    ProtokollPunkt,
  } from '../../../../api/lib/protokoll-editor-model';

  /**
   * The agenda as one Markdown text (#613, `lib/protokollMarkdownDokument.ts`). Every input is
   * read back into the items at once; the text itself stays as typed until the agenda changes
   * from outside (an item from an Aktion, a restored version). Aktion, project and open tasks of
   * the item at the cursor are shown below the text.
   */
  interface Props {
    punkte: ProtokollPunkt[];
    personen: PersonOption[];
    /** The item written at the cursor, for readers following along. */
    onactive?: (id: string | null) => void;
  }
  let { punkte = $bindable(), personen, onactive }: Props = $props();

  const PLATZHALTER = [
    '# Begrüßung',
    '',
    'Was besprochen wurde … Mit @ erwähnst du jemanden.',
    '',
    'Aufgabe: Zelte prüfen; zuständig: Lea; bis: 20.11.2026',
    '',
    '## Unterpunkt',
  ].join('\n');

  const uid = $props.id();
  let textarea = $state<HTMLTextAreaElement | null>(null);
  let text = $state(untrack(() => dokumentText(punkte)));
  /** The agenda as last written by this field, to tell a change from outside. */
  let geschrieben = untrack(() => text);
  /** Items cut out, so pasting them back keeps their Aktion and project. */
  let beiseite: ProtokollPunkt[] = [];
  /** Line of the title and id of every item, in reading order. */
  let zeilen = $state<{ zeile: number; id: string }[]>([]);
  let probleme = $state<DokumentProblem[]>([]);
  let aktivId = $state<string | null>(null);

  function alle(liste: ProtokollPunkt[]): ProtokollPunkt[] {
    return liste.flatMap((punkt) => [punkt, ...punkt.unterpunkte]);
  }

  /** People from the list and those already named, so a name keeps its login. */
  function bekannte(vorher: ProtokollPunkt[]): ProtokollPerson[] {
    return [
      ...personen,
      ...alle(vorher).flatMap((punkt) =>
        [...punkt.aufgaben, ...punkt.termine].flatMap((eintrag) => eintrag.zustaendig)
      ),
    ];
  }

  function lesen(): void {
    const vorher = $state.snapshot(punkte) as ProtokollPunkt[];
    const gelesen = liesDokument(text, personFinder(bekannte(vorher)));
    const result = abgleichen(gelesen.punkte, vorher, beiseite, newElementId);
    beiseite = result.beiseite;
    zeilen = result.ids.map((id, index) => ({ id, zeile: gelesen.punkte[index]?.zeile ?? 0 }));
    probleme = [...gelesen.probleme, ...grenzen(gelesen.punkte)].sort((a, b) => a.zeile - b.zeile);
    geschrieben = dokumentText(result.punkte);
    // Only a real change goes out, so opening the field saves nothing
    if (JSON.stringify(result.punkte) !== JSON.stringify(vorher)) punkte = result.punkte;
    folgeCursor();
  }

  // A change from outside replaces the text; a change of Aktion or project leaves it as typed
  $effect(() => {
    const jetzt = dokumentText(punkte);
    untrack(() => {
      if (jetzt === geschrieben && zeilen.length > 0) return;
      if (jetzt !== geschrieben) text = jetzt;
      lesen();
    });
  });

  function zeileAm(position: number): number {
    return text.slice(0, position).split('\n').length - 1;
  }

  function folgeCursor(): void {
    if (!textarea || document.activeElement !== textarea) return;
    const index = punktAnZeile(zeilen, zeileAm(textarea.selectionStart));
    const id = index === null ? null : (zeilen[index]?.id ?? null);
    if (id !== aktivId) {
      aktivId = id;
      onactive?.(id);
    }
  }

  /** Puts the cursor at the start of a line, e.g. one named in a problem. */
  function zurZeile(zeile: number): void {
    if (!textarea) return;
    const lines = text.split('\n');
    const at = lines.slice(0, zeile - 1).reduce((sum, line) => sum + line.length + 1, 0);
    textarea.focus();
    textarea.setSelectionRange(at, at + (lines[zeile - 1]?.length ?? 0));
    folgeCursor();
  }

  /** `@` picks a person: a mention in the text, the plain name in a task or date line. */
  const erwaehnung = new ErwaehnungAuswahl(
    () => personen,
    (person, suche) => {
      if (!textarea) return;
      const caret = textarea.selectionStart;
      const zeile = text.slice(text.lastIndexOf('\n', suche.start - 1) + 1, suche.start);
      const insert = schluesselOf(zeile) ? person.name : `${erwaehnungMarkdown(person)} `;
      text = text.slice(0, suche.start) + insert + text.slice(caret);
      lesen();
      const at = suche.start + insert.length;
      requestAnimationFrame(() => textarea?.setSelectionRange(at, at));
    }
  );

  function sucheErwaehnung(): void {
    folgeCursor();
    if (!textarea || textarea.selectionStart !== textarea.selectionEnd) {
      erwaehnung.setze(null);
      return;
    }
    erwaehnung.setze(erwaehnungSuche(textarea.value.slice(0, textarea.selectionStart)));
  }

  /** Enter at the end of a list line continues the list; Enter in an empty item ends it. */
  function onkeydown(event: KeyboardEvent): void {
    if (erwaehnung.taste(event)) {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || !textarea) return;
    const { selectionStart, selectionEnd, value } = textarea;
    if (selectionStart !== selectionEnd) return;
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const lineEnd = value.indexOf('\n', selectionStart);
    if (value.slice(selectionStart, lineEnd === -1 ? value.length : lineEnd).trim()) return;
    const list = continueList(value.slice(lineStart, selectionStart));
    if (!list) return;
    event.preventDefault();
    const caret = list.end ? lineStart : selectionStart + 1 + list.next.length;
    text = list.end
      ? value.slice(0, lineStart) + value.slice(selectionStart)
      : `${value.slice(0, selectionStart)}\n${list.next}${value.slice(selectionEnd)}`;
    lesen();
    requestAnimationFrame(() => textarea?.setSelectionRange(caret, caret));
  }

  const aktiv = $derived.by(() => {
    for (const [index, punkt] of punkte.entries()) {
      if (punkt.id === aktivId) return { punkt, index, subIndex: undefined };
      const subIndex = punkt.unterpunkte.findIndex((sub) => sub.id === aktivId);
      if (subIndex >= 0) return { punkt: punkt.unterpunkte[subIndex], index, subIndex };
    }
    return null;
  });
</script>

<div class="space-y-3">
  <label for="{uid}-text" class="sr-only">Tagesordnung als Markdown</label>
  <textarea
    id="{uid}-text"
    bind:this={textarea}
    bind:value={text}
    class="form-input dokument font-mono text-sm"
    spellcheck="true"
    placeholder={PLATZHALTER}
    aria-autocomplete="list"
    aria-controls={erwaehnung.offen ? erwaehnung.id : undefined}
    aria-activedescendant={erwaehnung.aktiveId}
    aria-describedby={probleme.length > 0 ? `${uid}-probleme` : undefined}
    oninput={() => {
      lesen();
      sucheErwaehnung();
    }}
    onkeyup={(event) => {
      const auswahlTaste = event.key === 'ArrowUp' || event.key === 'ArrowDown';
      if (event.key.startsWith('Arrow') && (!auswahlTaste || !erwaehnung.offen)) sucheErwaehnung();
      else if (event.key === 'Home' || event.key === 'End') sucheErwaehnung();
    }}
    onclick={sucheErwaehnung}
    onfocus={folgeCursor}
    onblur={() => erwaehnung.schliessen()}
    {onkeydown}></textarea>
  <ErwaehnungListe auswahl={erwaehnung} />

  {#if probleme.length > 0}
    <ul id="{uid}-probleme" class="space-y-1 text-sm text-warning" aria-label="Hinweise zum Text">
      {#each probleme as problem, index (index)}
        <li>
          <button
            type="button"
            class="link-button text-left"
            onclick={() => zurZeile(problem.zeile)}
          >
            Zeile {problem.zeile}:
          </button>
          {problem.text}
        </li>
      {/each}
    </ul>
  {/if}

  {#if aktiv}
    {#key aktiv.punkt.id}
      {#if aktiv.subIndex === undefined}
        <ProtokollMarkdownPunkt bind:punkt={punkte[aktiv.index]} index={aktiv.index} />
      {:else}
        <ProtokollMarkdownPunkt
          bind:punkt={punkte[aktiv.index].unterpunkte[aktiv.subIndex]}
          index={aktiv.index}
          subIndex={aktiv.subIndex}
        />
      {/if}
    {/key}
  {/if}
</div>

<style>
  .dokument {
    min-height: 16rem;
    height: min(60vh, 40rem);
    resize: vertical;
    line-height: 1.5;
    tab-size: 2;
  }
</style>
