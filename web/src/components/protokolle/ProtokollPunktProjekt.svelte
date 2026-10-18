<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { ApiError, errorMessage } from '../../lib/api';
  import {
    aenderungenAbwarten,
    createProjektFuerAktion,
    erledigtStand,
    laufend,
    projektFuerAktion,
    protokollAufgaben,
    setAufgabeErledigt,
  } from '../../lib/protokollAufgabenStore.svelte';
  import {
    formatShortDate,
    mergeOffeneAufgaben,
    offeneAufgabe,
    offeneAufgabenFuer,
    personNames,
  } from '../../lib/protokollEditor';
  import type {
    OffeneAufgabe,
    ProtokollAktion,
    ProtokollProjekt,
    ProtokollProjektOption,
  } from '../../lib/types';

  /**
   * The link of an agenda item to the module Aufgaben (#277, step 3): the project its tasks go
   * into on approval, and the open tasks shown in the item (of its project, or in the item
   * „Offene Aufgaben“ those from earlier minutes) with a box to tick them off at once.
   */
  interface Props {
    projekt: ProtokollProjekt | null;
    offeneAufgaben: OffeneAufgabe[];
    /** The Aktion of the item; its project is suggested. */
    aktion: ProtokollAktion | null;
    /** „1.“, „1a.“ */
    nummer: string;
    /** A sub-item without a project of its own belongs to the project of its item. */
    isSub?: boolean;
    /** Whether the list of projects is open; „Projekt verknüpfen“ of the item opens it. */
    choosing?: boolean;
  }
  let {
    projekt = $bindable(),
    offeneAufgaben = $bindable(),
    aktion,
    nummer,
    isSub = false,
    choosing = $bindable(false),
  }: Props = $props();

  const uid = $props.id();
  const data = $derived(protokollAufgaben.state.data);
  const vorschlag = $derived(projekt ? null : projektFuerAktion(aktion, data));
  let busy = $state<Record<number, boolean>>({});
  let fehler = $state<Record<number, string>>({});
  let projektBusy = $state(false);
  let projektFehler = $state<string | null>(null);
  let reloadHinweis = $state<string | null>(null);

  // Ticked in another item of these minutes: this one follows
  $effect(() => {
    for (const aufgabe of offeneAufgaben) {
      const stand = erledigtStand.byId[aufgabe.id];
      if (stand !== undefined && stand !== aufgabe.erledigt) aufgabe.erledigt = stand;
    }
  });

  /** Links the project and shows its open tasks; without a project the list goes. */
  function link(next: ProtokollProjektOption | null): void {
    choosing = false;
    projektFehler = null;
    reloadHinweis = null;
    projekt = next ? { id: next.id, titel: next.titel } : null;
    offeneAufgaben = next && data ? offeneAufgabenFuer(data.offen, next.id).map(offeneAufgabe) : [];
  }

  function onselect(event: Event): void {
    const value = Number((event.currentTarget as HTMLSelectElement).value);
    link(data?.projekte.find((option) => option.id === value) ?? null);
  }

  async function createForAktion(): Promise<void> {
    if (!aktion) return;
    projektBusy = true;
    projektFehler = null;
    try {
      // Approving right now would create the tasks without the project; it waits for the link
      await laufend(async () => {
        const created = await createProjektFuerAktion(aktion);
        if (!created) {
          projektFehler = 'Das Projekt wurde angelegt, aber nicht gefunden. Lade die Seite neu.';
        } else if (projekt === null) {
          // A project chosen meanwhile stays; the new one is in the list to pick
          link(created);
        }
      });
    } catch (error: unknown) {
      projektFehler = errorMessage(
        error,
        'Das Projekt wurde nicht angelegt. Tippe noch einmal auf „Projekt für die Aktion anlegen“.'
      );
    } finally {
      projektBusy = false;
    }
  }

  async function toggle(aufgabe: OffeneAufgabe, erledigt: boolean): Promise<void> {
    busy[aufgabe.id] = true;
    delete fehler[aufgabe.id];
    try {
      // Until the box shows the answer, finishing the writing waits for it
      await laufend(async () => {
        await setAufgabeErledigt(aufgabe.id, erledigt);
        aufgabe.erledigt = erledigt;
      });
    } catch (error: unknown) {
      fehler[aufgabe.id] =
        error instanceof ApiError && error.status === 409
          ? `„${aufgabe.titel}“ wurde inzwischen im Modul Aufgaben geändert und ist deshalb nicht ${erledigt ? 'abgehakt' : 'wieder geöffnet'}. Prüf den Stand dort und tippe dann noch einmal auf das Kästchen.`
          : errorMessage(
              error,
              `„${aufgabe.titel}“ wurde nicht ${erledigt ? 'abgehakt' : 'wieder geöffnet'}. Tippe noch einmal auf das Kästchen.`
            );
    } finally {
      busy[aufgabe.id] = false;
    }
  }

  /** Adds tasks opened since, keeps the ticked ones and updates names and dates. */
  async function reload(): Promise<void> {
    reloadHinweis = null;
    // Counts at once, so approving right now waits for the merged list
    await laufend(async () => {
      // A tick on its way is in the module already but not yet in the list; merging now would
      // drop it
      await aenderungenAbwarten();
      await mergeReload();
    }, 'neuladen');
  }

  async function mergeReload(): Promise<void> {
    await protokollAufgaben.load({ force: true });
    const current = protokollAufgaben.state.data;
    // A failed load keeps the older list in the store; it must not replace newer entries
    if (!current || protokollAufgaben.state.error) {
      reloadHinweis =
        'Die offenen Aufgaben wurden nicht neu geladen, die Liste ist unverändert. Prüfe deine Internetverbindung und tippe noch einmal auf „Offene Aufgaben neu laden“.';
      return;
    }
    const before = offeneAufgaben.length;
    // Known to the module but not open: done elsewhere, so they stay in the list as done
    const offenIds = new Set(current.offen.map((task) => task.id));
    const erledigt = new Set(
      Object.keys(current.versionen)
        .map(Number)
        .filter((id) => !offenIds.has(id))
    );
    offeneAufgaben = mergeOffeneAufgaben(
      $state.snapshot(offeneAufgaben),
      offeneAufgabenFuer(current.offen, projekt?.id ?? null),
      erledigt
    );
    const added = offeneAufgaben.length - before;
    reloadHinweis =
      added > 0
        ? `${added === 1 ? 'Eine Aufgabe' : `${added} Aufgaben`} dazugekommen.`
        : 'Die Liste ist aktuell.';
  }
</script>

<div class="space-y-2">
  {#if projekt && !choosing}
    <p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span><span class="font-semibold">Projekt:</span> {projekt.titel}</span>
      {#if data}
        <button type="button" class="link-button" onclick={() => (choosing = true)}>
          Projekt ändern
        </button>
      {/if}
      <button type="button" class="link-button" onclick={() => link(null)}>Projekt lösen</button>
    </p>
  {:else if choosing && data}
    <div class="flex flex-wrap items-end gap-2">
      <div class="min-w-0 flex-1">
        <label for="{uid}-projekt" class="text-sm text-neutral-700"
          >Projekt für Punkt {nummer}</label
        >
        <select id="{uid}-projekt" class="form-input" value={projekt?.id ?? ''} onchange={onselect}>
          <option value="">{isSub ? 'Projekt des Hauptpunkts' : 'Kein Projekt'}</option>
          {#each data.projekte as option (option.id)}
            <option value={option.id}>{option.titel}</option>
          {/each}
        </select>
      </div>
      <ActionButton onclick={() => (choosing = false)}>Abbrechen</ActionButton>
    </div>
    <p class="text-sm text-neutral-700">
      Aufgaben dieses Punkts landen bei der Freigabe im gewählten Projekt, und der Punkt zeigt die
      offenen Aufgaben des Projekts.{isSub
        ? ' Ohne eigenes Projekt gilt das Projekt des Hauptpunkts.'
        : ''}
    </p>
  {:else if aktion && data}
    <div class="flex flex-wrap items-center gap-2">
      {#if vorschlag}
        <ActionButton onclick={() => link(vorschlag)}>
          Mit Projekt „{vorschlag.titel}“ verknüpfen
        </ActionButton>
      {:else}
        <ActionButton onclick={createForAktion} disabled={projektBusy}>
          {projektBusy ? 'Legt an …' : 'Projekt für die Aktion anlegen'}
        </ActionButton>
      {/if}
      {#if data.projekte.length > 0}
        <button
          type="button"
          class="link-button text-sm"
          disabled={projektBusy}
          onclick={() => (choosing = true)}
        >
          Anderes Projekt wählen
        </button>
      {/if}
    </div>
  {/if}
  {#if projekt && !choosing}
    <p class="text-sm text-neutral-700">
      Aufgaben dieses Punkts landen bei der Freigabe im Projekt „{projekt.titel}“.
    </p>
  {/if}
  {#if projektFehler}
    <p class="text-sm text-danger" role="alert">{projektFehler}</p>
  {/if}

  {#if offeneAufgaben.length > 0}
    <div class="offene space-y-1">
      <p class="text-sm font-semibold" id="{uid}-offene">
        {projekt
          ? `Offene Aufgaben im Projekt „${projekt.titel}“`
          : 'Offene Aufgaben aus früheren Protokollen'}
      </p>
      <ul class="space-y-1" aria-labelledby="{uid}-offene">
        {#each offeneAufgaben as aufgabe (aufgabe.id)}
          {@const details = [
            personNames(aufgabe.zustaendig),
            aufgabe.faellig ? `bis ${formatShortDate(aufgabe.faellig)}` : '',
          ].filter(Boolean)}
          <li>
            <label class="flex min-h-11 cursor-pointer items-start gap-3 py-1">
              <input
                type="checkbox"
                class="mt-0.5 h-6 w-6 shrink-0"
                checked={aufgabe.erledigt}
                disabled={busy[aufgabe.id]}
                onchange={(event) => void toggle(aufgabe, event.currentTarget.checked)}
              />
              <span class="min-w-0">
                <span class:erledigt={aufgabe.erledigt} class="break-words">{aufgabe.titel}</span>
                <span class="block text-sm text-neutral-700">
                  {aufgabe.erledigt ? 'Erledigt' : 'Noch offen'}{details.length
                    ? ` · ${details.join(' · ')}`
                    : ''}{busy[aufgabe.id] ? ' · speichert …' : ''}
                </span>
              </span>
            </label>
            {#if fehler[aufgabe.id]}
              <p class="text-sm text-danger" role="alert">{fehler[aufgabe.id]}</p>
            {/if}
          </li>
        {/each}
      </ul>
      <p class="text-sm text-neutral-700">Häkchen werden sofort im Modul Aufgaben gespeichert.</p>
    </div>
  {/if}
  {#if projekt || offeneAufgaben.length > 0}
    <div class="flex flex-wrap items-center gap-2">
      <ActionButton onclick={reload} disabled={protokollAufgaben.state.loading}>
        {protokollAufgaben.state.loading ? 'Lädt …' : 'Offene Aufgaben neu laden'}
      </ActionButton>
      {#if reloadHinweis}
        <p class="text-sm text-neutral-700" role="status" aria-live="polite">{reloadHinweis}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .offene {
    border-left: 2px solid var(--color-neutral-300);
    padding-left: 0.75rem;
  }
  /* The document styles lists of the text; this one is a list of boxes */
  .offene ul {
    list-style: none;
    padding-left: 0;
  }
  .erledigt {
    color: var(--color-neutral-700);
    text-decoration: line-through;
  }
  .link-button {
    min-height: 2.75rem;
    color: var(--color-link);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
