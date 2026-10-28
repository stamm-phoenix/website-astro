<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import { zeitplanZeilen } from '../../lib/abrechnungStore.svelte';
  import type { AbrechnungSession } from '../../lib/abrechnungStore.svelte';
  import { downloadKurzbeschreibungPdf, pdfFileName } from '../../lib/abrechnungPdf';
  import { errorMessage } from '../../lib/api';
  import { confirmAction } from '../../lib/confirm';
  import { formatEventRange } from '../../lib/campflowFields';
  import { todayIso } from '../../lib/format';
  import { fetchVorstand, vorstandStore } from '../../lib/vorstandStore.svelte';
  import {
    MAX_ZEITBLOCK_TEXT,
    MAX_ZEITBLOECKE_PRO_TAG,
    MAX_ZEITPLAN_TAGE,
    aktionTage,
    istNachUhrzeit,
    kurzbeschreibungPdfData,
    kurzerWochentag,
    mitAktionTagen,
    mitId,
    nachUhrzeit,
    naechsterBeginn,
    nextDay,
    parseZeitzeilen,
    tagTitel,
    zeitplanTage,
  } from '../../lib/kurzbeschreibung';
  import type { ZeitBlock, ZeitplanTag } from '../../lib/kurzbeschreibung';
  import {
    MAX_ZEITPLAN_SEITEN,
    ZEITPLAN_DATEITYPEN,
    ZeitplanDateiError,
    leseZeitplan,
  } from '../../lib/zeitplanDatei';
  import type { Abrechnung } from '../../lib/types';

  interface Props {
    abrechnung: Abrechnung;
    session: AbrechnungSession;
  }

  let { abrechnung, session }: Props = $props();

  const ZEILEN_BEISPIEL = '8-9 Uhr Frühstück\n9:30-12 Uhr Geländespiel\n20 Uhr Lagerfeuer';

  const event = $derived(abrechnung.event);
  const kurz = $derived(session.kurzbeschreibung);
  /** The days as entered, or the days of the Aktion until something was entered. */
  const tage = $derived(zeitplanTage(kurz, event.start_date, event.end_date));
  const aktionsTage = $derived(new Set(aktionTage(event.start_date, event.end_date)));
  const blockCount = $derived(tage.reduce((sum, tag) => sum + tag.bloecke.length, 0));
  const filled = $derived(kurz.einleitung.trim() !== '' || blockCount > 0);

  let pdfBusy = $state(false);
  let pdfError = $state<string | null>(null);
  /** Result of the last action on the Zeitplan, e.g. a file read or a block deleted. */
  let notice = $state<{ text: string; kind: 'success' | 'error' | 'warning' } | null>(null);
  /** The last deleted block, to bring it back. */
  let deleted = $state<{ block: ZeitBlock; datum: string; index: number } | null>(null);
  // Days with the field for several lines open, and what was typed there; kept in the store so
  // they survive a change of tab
  untrack(() => (zeitplanZeilen[abrechnung.event.id] ??= {}));
  const quick = $derived(zeitplanZeilen[event.id] ?? {});
  let reading = $state<string | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  let controller: AbortController | null = null;
  onDestroy(() => controller?.abort());

  /**
   * The days to change. Until something was entered the page shows the days of the Aktion
   * without keeping them; the first change keeps them with the entries.
   */
  function editable(): ZeitplanTag[] {
    if (session.kurzbeschreibung.tage.length === 0) {
      session.kurzbeschreibung.tage = tage.map((tag) => ({ datum: tag.datum, bloecke: [] }));
    }
    return session.kurzbeschreibung.tage;
  }

  function say(text: string, kind: 'success' | 'error' | 'warning' = 'success'): void {
    notice = { text, kind };
    deleted = null;
  }

  async function focusField(id: string): Promise<void> {
    await tick();
    document.getElementById(id)?.focus();
  }

  function setField(tagIndex: number, id: string, field: 'von' | 'bis' | 'text', value: string) {
    const block = editable()[tagIndex]?.bloecke.find((b) => b.id === id);
    if (block) block[field] = value;
  }

  /** Adds a block after `afterIndex` (at the end without), starting where the one before ended. */
  async function addBlock(tagIndex: number, afterIndex?: number): Promise<void> {
    const tag = editable()[tagIndex];
    if (!tag || tag.bloecke.length >= MAX_ZEITBLOECKE_PRO_TAG) return;
    const at = afterIndex === undefined ? tag.bloecke.length : afterIndex + 1;
    const block = mitId({ von: naechsterBeginn(tag.bloecke.slice(0, at)), bis: '', text: '' });
    tag.bloecke.splice(at, 0, block);
    notice = null;
    await focusField(`block-${block.id}-${block.von ? 'bis' : 'von'}`);
  }

  /** Moves a block up or down; at the edge of a day it moves on to the day before or after. */
  async function move(tagIndex: number, index: number, delta: -1 | 1): Promise<void> {
    const days = editable();
    const from = days[tagIndex].bloecke;
    const target = index + delta;
    const crossing = target < 0 || target >= from.length;
    if (crossing && days[tagIndex + delta].bloecke.length >= MAX_ZEITBLOECKE_PRO_TAG) {
      say(
        `${tagTitel(days[tagIndex + delta].datum)} hat schon ${MAX_ZEITBLOECKE_PRO_TAG} Blöcke. Lösche dort zuerst einen.`,
        'warning'
      );
      return;
    }
    const [block] = from.splice(index, 1);
    if (target >= 0 && target <= from.length) {
      from.splice(target, 0, block);
    } else {
      const day = days[tagIndex + delta];
      if (delta < 0) day.bloecke.push(block);
      else day.bloecke.unshift(block);
    }
    notice = null;
    await tick();
    const button = document.getElementById(`block-${block.id}-${delta < 0 ? 'hoch' : 'runter'}`);
    if (button instanceof HTMLButtonElement && !button.disabled) button.focus();
    else document.getElementById(`block-${block.id}-${delta < 0 ? 'runter' : 'hoch'}`)?.focus();
  }

  async function remove(tagIndex: number, index: number): Promise<void> {
    const tag = editable()[tagIndex];
    const [block] = tag.bloecke.splice(index, 1);
    if (block.text.trim() || block.von) {
      notice = null;
      deleted = { block, datum: tag.datum, index };
    }
    await tick();
    const next = tag.bloecke[Math.min(index, tag.bloecke.length - 1)];
    document.getElementById(next ? `block-${next.id}-text` : `tag-${tag.datum}-neu`)?.focus();
  }

  async function undoDelete(): Promise<void> {
    if (!deleted) return;
    const { block, datum, index } = deleted;
    const tag = editable().find((t) => t.datum === datum);
    deleted = null;
    if (!tag || tag.bloecke.length >= MAX_ZEITBLOECKE_PRO_TAG) return;
    tag.bloecke.splice(Math.min(index, tag.bloecke.length), 0, block);
    await focusField(`block-${block.id}-text`);
  }

  function sortDay(tagIndex: number): void {
    const tag = editable()[tagIndex];
    tag.bloecke = nachUhrzeit(tag.bloecke);
    say(`${tagTitel(tag.datum)} nach Uhrzeit sortiert.`);
  }

  /** Copies the blocks of the day before, e.g. the meals and the Morgenrunde of a camp. */
  function copyPreviousDay(tagIndex: number): void {
    const days = editable();
    const source = days[tagIndex - 1];
    const tag = days[tagIndex];
    const kopien = source.bloecke.map((block) =>
      mitId({ von: block.von, bis: block.bis, text: block.text })
    );
    tag.bloecke = [...tag.bloecke, ...kopien].slice(0, MAX_ZEITBLOECKE_PRO_TAG);
    say(`Ablauf von ${tagTitel(source.datum)} übernommen. Passe ihn jetzt an.`);
  }

  async function addDay(): Promise<void> {
    const days = editable();
    if (days.length >= MAX_ZEITPLAN_TAGE) return;
    const datum = days.length > 0 ? nextDay(days.at(-1)!.datum) : todayIso();
    days.push({ datum, bloecke: [] });
    say(`${tagTitel(datum)} hinzugefügt.`);
    await focusField(`tag-${datum}-neu`);
  }

  async function removeDay(tagIndex: number): Promise<void> {
    const tag = editable()[tagIndex];
    if (
      tag.bloecke.length > 0 &&
      !(await confirmAction({
        title: `${tagTitel(tag.datum)} entfernen?`,
        message: `${tagTitel(tag.datum)} mit ${tag.bloecke.length} ${tag.bloecke.length === 1 ? 'Block' : 'Blöcken'} aus dem Zeitplan entfernen?`,
        confirmLabel: 'Tag entfernen',
      }))
    )
      return;
    editable().splice(tagIndex, 1);
    say(`${tagTitel(tag.datum)} entfernt.`);
  }

  function toggleQuick(datum: string): void {
    if (datum in quick) delete quick[datum];
    else {
      quick[datum] = '';
      void focusField(`tag-${datum}-zeilen`);
    }
  }

  async function applyQuick(tagIndex: number, datum: string): Promise<void> {
    // One block per non-empty line, in the same order as parseZeitzeilen
    const zeilen = (quick[datum] ?? '').split(/\r?\n/).filter((line) => line.trim() !== '');
    const neue = parseZeitzeilen(zeilen.join('\n'));
    if (neue.length === 0) return;
    const tag = editable()[tagIndex];
    const room = Math.max(0, MAX_ZEITBLOECKE_PRO_TAG - tag.bloecke.length);
    tag.bloecke.push(...neue.slice(0, room).map(mitId));
    if (neue.length <= room) {
      delete quick[datum];
      say(`${neue.length} ${neue.length === 1 ? 'Block' : 'Blöcke'} übernommen.`);
      await focusField(`tag-${datum}-neu`);
      return;
    }
    // The lines that did not fit stay in the field
    quick[datum] = zeilen.slice(room).join('\n');
    say(
      `${room} von ${neue.length} Blöcken übernommen. An einen Tag passen höchstens ${MAX_ZEITBLOECKE_PRO_TAG} Blöcke; die übrigen Zeilen stehen noch im Feld.`,
      'warning'
    );
    await focusField(`tag-${datum}-zeilen`);
  }

  async function resetAll(): Promise<void> {
    if (
      !(await confirmAction({
        title: 'Kurzbeschreibung zurücksetzen?',
        message: `Zielsetzung und Zeitplan der Kurzbeschreibung zu „${event.title}“ löschen? Die Tage der Aktion bleiben.`,
        confirmLabel: 'Zurücksetzen',
      }))
    )
      return;
    session.kurzbeschreibung = { einleitung: '', tage: [] };
    say('Kurzbeschreibung zurückgesetzt.');
  }

  async function readFile(file: File): Promise<void> {
    controller?.abort();
    controller = new AbortController();
    reading = file.name;
    notice = null;
    deleted = null;
    try {
      const zeitplan = await leseZeitplan(event.id, file, controller.signal);
      if (!zeitplan) {
        say(
          'Zeitpläne aus Dateien zu lesen ist gerade nicht möglich. Trage den Zeitplan bitte selbst ein.',
          'warning'
        );
        return;
      }
      const count = zeitplan.tage.reduce((sum, tag) => sum + tag.bloecke.length, 0);
      if (count === 0 && !zeitplan.einleitung) {
        say(
          `In „${file.name}“ wurde kein Zeitplan gefunden. Wähle eine andere Datei oder trage ihn selbst ein.`,
          'warning'
        );
        return;
      }
      if (
        count > 0 &&
        blockCount > 0 &&
        !(await confirmAction({
          title: 'Zeitplan ersetzen?',
          message: `Den bisherigen Zeitplan (${blockCount} ${blockCount === 1 ? 'Block' : 'Blöcke'}) durch die ${count} Blöcke aus „${file.name}“ ersetzen?`,
          confirmLabel: 'Zeitplan ersetzen',
          tone: 'neutral',
        }))
      ) {
        say('Zeitplan nicht übernommen. Es wurde nichts geändert.', 'warning');
        return;
      }
      if (count > 0) {
        session.kurzbeschreibung.tage = mitAktionTagen(
          zeitplan.tage,
          event.start_date,
          event.end_date
        );
      }
      const einleitung = !!zeitplan.einleitung && !kurz.einleitung.trim();
      if (einleitung) session.kurzbeschreibung.einleitung = zeitplan.einleitung!;
      const days = zeitplan.tage.length;
      say(
        count > 0
          ? `Zeitplan aus „${file.name}“ übernommen: ${days} ${days === 1 ? 'Tag' : 'Tage'}, ${count} ${count === 1 ? 'Block' : 'Blöcke'}${einleitung ? ' und die Zielsetzung' : ''}. Prüfe ihn bitte.`
          : `Zielsetzung aus „${file.name}“ übernommen. Einen Zeitplan enthält die Datei nicht.`
      );
    } catch (error: unknown) {
      if (controller?.signal.aborted) return;
      say(
        error instanceof ZeitplanDateiError
          ? error.message
          : errorMessage(
              error,
              'Der Zeitplan konnte nicht gelesen werden. Es wurde nichts geändert. Versuche es noch einmal oder trage ihn selbst ein.'
            ),
        'error'
      );
    } finally {
      reading = null;
      if (fileInput) fileInput.value = '';
    }
  }

  async function exportPdf(): Promise<void> {
    pdfError = null;
    if (!filled) {
      pdfError = 'Trage zuerst die Zielsetzung oder einen Block im Zeitplan ein.';
      return;
    }
    pdfBusy = true;
    try {
      if (!vorstandStore.data) await fetchVorstand();
      await downloadKurzbeschreibungPdf(
        kurzbeschreibungPdfData(
          event.title,
          formatEventRange(event),
          kurz,
          tage,
          vorstandStore.data ?? []
        ),
        pdfFileName('Kurzbeschreibung', event.title)
      );
    } catch {
      pdfError = 'Das PDF konnte nicht erstellt werden. Deine Eingaben bleiben erhalten.';
    } finally {
      pdfBusy = false;
    }
  }

  // Dragging a block with the mouse; the arrow buttons do the same by keyboard and touch
  let dragged = $state<{ tagIndex: number; index: number; id: string } | null>(null);
  /** Where the dragged block would land: before block `index` of the day, or at its end. */
  let dropAt = $state<{ tagIndex: number; index: number } | null>(null);

  function onDragStart(event: DragEvent, tagIndex: number, index: number, id: string): void {
    dragged = { tagIndex, index, id };
    event.dataTransfer?.setData('text/plain', id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    const row = (event.currentTarget as HTMLElement).closest('li');
    if (row && event.dataTransfer) event.dataTransfer.setDragImage(row, 16, 16);
  }

  function onDragOver(event: DragEvent, tagIndex: number, index: number): void {
    if (!dragged) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const row = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const lower = event.clientY > row.top + row.height / 2;
    dropAt = { tagIndex, index: index + (lower ? 1 : 0) };
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault();
    if (!dragged || !dropAt) return endDrag();
    const days = editable();
    const [block] = days[dragged.tagIndex].bloecke.splice(dragged.index, 1);
    const sameDay = dragged.tagIndex === dropAt.tagIndex;
    const index = sameDay && dropAt.index > dragged.index ? dropAt.index - 1 : dropAt.index;
    const target = days[dropAt.tagIndex].bloecke;
    if (!sameDay && target.length >= MAX_ZEITBLOECKE_PRO_TAG) {
      days[dragged.tagIndex].bloecke.splice(dragged.index, 0, block);
      say(`An einen Tag passen höchstens ${MAX_ZEITBLOECKE_PRO_TAG} Blöcke.`, 'warning');
    } else {
      target.splice(index, 0, block);
      notice = null;
    }
    endDrag();
  }

  function endDrag(): void {
    dragged = null;
    dropAt = null;
  }

  function onTextKey(event: KeyboardEvent, tagIndex: number, index: number): void {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    void addBlock(tagIndex, index);
  }
</script>

{#snippet arrow(direction: 'up' | 'down')}
  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="currentColor">
    {#if direction === 'up'}
      <path d="M10 4 4 10.5l1.4 1.4L9 8.3V16h2V8.3l3.6 3.6 1.4-1.4z" />
    {:else}
      <path d="m10 16 6-6.5-1.4-1.4L11 11.7V4H9v7.7L5.4 8.1 4 9.5z" />
    {/if}
  </svg>
{/snippet}

<div class="space-y-6">
  <section aria-labelledby="kurzbeschreibung-titel" class="surface p-4 sm:p-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="flex items-center gap-2">
        <h2 id="kurzbeschreibung-titel" class="font-serif text-lg font-semibold text-brand-900">
          Kurzbeschreibung für den KJR
        </h2>
        <InfoHint
          label="Kurzbeschreibung"
          text="Der KJR verlangt beim Antrag auf Zuschuss eine Kurzbeschreibung: wozu die Aktion dient und einen groben Zeitplan. Lade sie als PDF herunter und füge sie dem Antrag bei. Sie gehört zu deinen Eingaben und wird mit „Eingaben speichern“ gesichert."
        />
      </div>
      <div class="flex flex-wrap gap-2">
        {#if filled}
          <ActionButton variant="secondary" onclick={resetAll}>Zurücksetzen</ActionButton>
        {/if}
        <ActionButton variant="primary" disabled={pdfBusy} onclick={exportPdf}>
          {pdfBusy ? 'PDF wird erstellt …' : 'Als PDF herunterladen'}
        </ActionButton>
      </div>
    </div>
    <StatusNotice class="mt-3" kind="error" message={pdfError} />

    <label class="mt-4 block max-w-3xl">
      <span class="form-label">Zielsetzung</span>
      <textarea
        class="form-input min-h-24"
        rows="3"
        maxlength={2000}
        value={kurz.einleitung}
        oninput={(e) => (session.kurzbeschreibung.einleitung = e.currentTarget.value)}
        placeholder="z. B. Mit der Aktion wollen wir die Gemeinschaft im Stamm stärken und ein bisschen Fantasie zurück in den Alltag bringen."
      ></textarea>
    </label>
  </section>

  <section aria-labelledby="zeitplan-titel" class="surface p-4 sm:p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 id="zeitplan-titel" class="font-serif text-lg font-semibold text-brand-900">
        Zeitplan
        {#if blockCount > 0}
          <span class="ml-1 font-sans text-sm font-normal text-neutral-700"
            >({blockCount} {blockCount === 1 ? 'Block' : 'Blöcke'})</span
          >
        {/if}
      </h2>
      <div class="flex flex-wrap items-center gap-2">
        <input
          bind:this={fileInput}
          type="file"
          accept={ZEITPLAN_DATEITYPEN}
          class="sr-only"
          id="zeitplan-datei"
          tabindex="-1"
          onchange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (file) void readFile(file);
          }}
        />
        <ActionButton
          variant="secondary"
          disabled={reading !== null}
          onclick={() => fileInput?.click()}
        >
          {reading ? 'Zeitplan wird gelesen …' : 'Aus Datei übernehmen'}
        </ActionButton>
        <InfoHint
          label="Aus Datei übernehmen"
          text={`Hast du den Zeitplan schon als Foto, PDF (die ersten ${MAX_ZEITPLAN_SEITEN} Seiten) oder Excel-Tabelle? Dann wird er daraus gelesen und hier eingetragen. Die Datei selbst wird nicht gespeichert. Prüfe die übernommenen Blöcke, bevor du das PDF herunterlädst.`}
        />
      </div>
    </div>

    {#if reading}
      <div role="status" class="mt-3 text-sm text-neutral-700">
        <p>„{reading}“ wird gelesen. Das dauert bis zu einer halben Minute …</p>
        <div class="mt-2 h-1.5 w-full max-w-md overflow-hidden rounded bg-neutral-200">
          <div class="zeitplan-progress h-full w-1/3 rounded bg-brand-900"></div>
        </div>
      </div>
    {/if}
    {#if notice}
      <StatusNotice class="mt-3" kind={notice.kind} message={notice.text} popup />
    {/if}
    {#if deleted}
      <p role="status" class="mt-3 flex flex-wrap items-center gap-2 text-sm text-neutral-700">
        <span>„{deleted.block.text || 'Block'}“ gelöscht.</span>
        <ActionButton variant="secondary" onclick={undoDelete}>Rückgängig</ActionButton>
      </p>
    {/if}

    {#if tage.length === 0}
      <p class="mt-4 text-sm text-neutral-700">
        Diese Aktion hat noch kein Datum in CampFlow. Füge die Tage des Zeitplans selbst hinzu.
      </p>
    {/if}

    <div class="mt-4 space-y-4">
      {#each tage as tag, tagIndex (tag.datum)}
        {@const vortag = tagIndex > 0 ? tage[tagIndex - 1] : null}
        <section
          aria-labelledby={`tag-${tag.datum}-titel`}
          class="rounded-sm border border-neutral-300 p-3 sm:p-4"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 id={`tag-${tag.datum}-titel`} class="font-semibold text-brand-900">
              {tagTitel(tag.datum)}
              {#if aktionsTage.size > 0 && !aktionsTage.has(tag.datum)}
                <span class="ml-1 text-xs font-normal text-warning">außerhalb der Aktion</span>
              {/if}
            </h3>
            <div class="flex flex-wrap gap-2">
              {#if vortag && vortag.bloecke.length > 0 && tag.bloecke.length === 0}
                <ActionButton variant="secondary" onclick={() => copyPreviousDay(tagIndex)}>
                  Ablauf vom {kurzerWochentag(vortag.datum)} übernehmen
                </ActionButton>
              {/if}
              {#if !istNachUhrzeit(tag.bloecke)}
                <ActionButton variant="secondary" onclick={() => sortDay(tagIndex)}>
                  Nach Uhrzeit sortieren
                </ActionButton>
              {/if}
              <ActionButton variant="danger" onclick={() => removeDay(tagIndex)}>
                Tag entfernen
              </ActionButton>
            </div>
          </div>

          <ul
            class="mt-2 space-y-2"
            aria-label={`Blöcke am ${tagTitel(tag.datum)}`}
            ondragover={(e) => {
              if (!dragged || e.target !== e.currentTarget) return;
              e.preventDefault();
              dropAt = { tagIndex, index: tag.bloecke.length };
            }}
            ondrop={onDrop}
          >
            {#each tag.bloecke as block, index (block.id)}
              {@const first = tagIndex === 0 && index === 0}
              {@const last = tagIndex === tage.length - 1 && index === tag.bloecke.length - 1}
              <li
                class="zeitplan-block flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm py-1
                  {dragged?.id === block.id ? 'opacity-40' : ''}
                  {dropAt?.tagIndex === tagIndex && dropAt.index === index ? 'drop-before' : ''}
                  {dropAt?.tagIndex === tagIndex &&
                dropAt.index === tag.bloecke.length &&
                index === tag.bloecke.length - 1
                  ? 'drop-after'
                  : ''}"
                ondragover={(e) => onDragOver(e, tagIndex, index)}
                ondrop={onDrop}
              >
                <span
                  class="hidden cursor-grab touch-none select-none self-stretch px-1 text-neutral-700 sm:flex sm:items-center"
                  draggable="true"
                  aria-hidden="true"
                  title="Ziehen zum Verschieben"
                  ondragstart={(e) => onDragStart(e, tagIndex, index, block.id)}
                  ondragend={endDrag}
                >
                  <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor">
                    <circle cx="7" cy="5" r="1.5" /><circle cx="13" cy="5" r="1.5" />
                    <circle cx="7" cy="10" r="1.5" /><circle cx="13" cy="10" r="1.5" />
                    <circle cx="7" cy="15" r="1.5" /><circle cx="13" cy="15" r="1.5" />
                  </svg>
                </span>
                <div class="flex items-center gap-1">
                  <input
                    id={`block-${block.id}-von`}
                    type="time"
                    step="300"
                    class="form-input mt-0! w-[6.75rem] tabular-nums"
                    aria-label={`Beginn von „${block.text || 'neuer Block'}“`}
                    value={block.von}
                    oninput={(e) => setField(tagIndex, block.id, 'von', e.currentTarget.value)}
                  />
                  <span aria-hidden="true" class="text-neutral-700">–</span>
                  <input
                    id={`block-${block.id}-bis`}
                    type="time"
                    step="300"
                    class="form-input mt-0! w-[6.75rem] tabular-nums"
                    aria-label={`Ende von „${block.text || 'neuer Block'}“`}
                    value={block.bis}
                    oninput={(e) => setField(tagIndex, block.id, 'bis', e.currentTarget.value)}
                  />
                </div>
                <input
                  id={`block-${block.id}-text`}
                  type="text"
                  class="form-input order-last mt-0! w-full sm:order-none sm:w-auto sm:flex-1"
                  aria-label="Programmpunkt"
                  maxlength={MAX_ZEITBLOCK_TEXT}
                  placeholder="z. B. Geländespiel"
                  enterkeyhint="next"
                  value={block.text}
                  oninput={(e) => setField(tagIndex, block.id, 'text', e.currentTarget.value)}
                  onkeydown={(e) => onTextKey(e, tagIndex, index)}
                />
                <div class="ml-auto flex">
                  <button
                    type="button"
                    id={`block-${block.id}-hoch`}
                    class="zeitplan-icon"
                    disabled={first}
                    aria-label={index === 0 && vortag
                      ? `„${block.text || 'Block'}“ auf ${tagTitel(vortag.datum)} verschieben`
                      : `„${block.text || 'Block'}“ nach oben`}
                    title={index === 0 && vortag
                      ? `Auf ${kurzerWochentag(vortag.datum)} verschieben`
                      : 'Nach oben'}
                    onclick={() => move(tagIndex, index, -1)}>{@render arrow('up')}</button
                  >
                  <button
                    type="button"
                    id={`block-${block.id}-runter`}
                    class="zeitplan-icon"
                    disabled={last}
                    aria-label={index === tag.bloecke.length - 1 && tage[tagIndex + 1]
                      ? `„${block.text || 'Block'}“ auf ${tagTitel(tage[tagIndex + 1].datum)} verschieben`
                      : `„${block.text || 'Block'}“ nach unten`}
                    title={index === tag.bloecke.length - 1 && tage[tagIndex + 1]
                      ? `Auf ${kurzerWochentag(tage[tagIndex + 1].datum)} verschieben`
                      : 'Nach unten'}
                    onclick={() => move(tagIndex, index, 1)}>{@render arrow('down')}</button
                  >
                  <button
                    type="button"
                    class="zeitplan-icon text-danger"
                    aria-label={`„${block.text || 'Block'}“ löschen`}
                    title="Löschen"
                    onclick={() => remove(tagIndex, index)}
                  >
                    <svg
                      viewBox="0 0 20 20"
                      width="18"
                      height="18"
                      aria-hidden="true"
                      fill="currentColor"
                    >
                      <path
                        d="M8 3h4l1 1h3v2H4V4h3zm-2 4h8l-.7 9.1a1 1 0 0 1-1 .9H7.7a1 1 0 0 1-1-.9z"
                      />
                    </svg>
                  </button>
                </div>
              </li>
            {/each}
          </ul>

          {#if tag.datum in quick}
            <label class="mt-3 block">
              <span class="form-label">Mehrere Blöcke, einer pro Zeile</span>
              <textarea
                id={`tag-${tag.datum}-zeilen`}
                class="form-input min-h-28 font-mono text-sm"
                rows="5"
                value={quick[tag.datum]}
                oninput={(e) => (quick[tag.datum] = e.currentTarget.value)}
                placeholder={ZEILEN_BEISPIEL}></textarea>
            </label>
            <div class="mt-2 flex flex-wrap gap-2">
              <ActionButton
                variant="primary"
                disabled={!quick[tag.datum]?.trim()}
                onclick={() => applyQuick(tagIndex, tag.datum)}>Blöcke übernehmen</ActionButton
              >
              <ActionButton variant="secondary" onclick={() => toggleQuick(tag.datum)}
                >Abbrechen</ActionButton
              >
            </div>
          {:else}
            <div class="mt-2 flex flex-wrap gap-2">
              <ActionButton
                id={`tag-${tag.datum}-neu`}
                variant="secondary"
                disabled={tag.bloecke.length >= MAX_ZEITBLOECKE_PRO_TAG}
                onclick={() => addBlock(tagIndex)}>Block hinzufügen</ActionButton
              >
              <ActionButton variant="secondary" onclick={() => toggleQuick(tag.datum)}
                >Mehrere Zeilen einfügen</ActionButton
              >
            </div>
          {/if}
        </section>
      {/each}
    </div>

    {#if tage.length < MAX_ZEITPLAN_TAGE}
      <ActionButton class="mt-4" variant="secondary" onclick={addDay}>
        Tag hinzufügen{tage.length > 0 ? `: ${tagTitel(nextDay(tage.at(-1)!.datum))}` : ''}
      </ActionButton>
    {/if}
  </section>
</div>

<style>
  .zeitplan-icon {
    display: inline-flex;
    min-height: 2.75rem;
    min-width: 2.75rem;
    align-items: center;
    justify-content: center;
    border-radius: 0.25rem;
    color: var(--color-brand-900);
  }
  .zeitplan-icon:hover:not(:disabled) {
    background: var(--color-field);
  }
  .zeitplan-icon:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 1px;
  }
  .zeitplan-icon:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .drop-before {
    box-shadow: inset 0 3px 0 var(--color-brand-900);
  }
  .drop-after {
    box-shadow: inset 0 -3px 0 var(--color-brand-900);
  }
  .zeitplan-progress {
    animation: zeitplan-progress 1.4s ease-in-out infinite;
  }
  @keyframes zeitplan-progress {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(300%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .zeitplan-progress {
      animation: none;
      width: 100%;
      opacity: 0.4;
    }
  }
</style>
