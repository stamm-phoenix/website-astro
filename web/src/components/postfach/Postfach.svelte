<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { navigate } from 'astro:transitions/client';
  import ActionButton from '../ui/ActionButton.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import MessageText from '../ui/MessageText.svelte';
  import KonversationListe from './KonversationListe.svelte';
  import PostfachFilterLeiste from './PostfachFilterLeiste.svelte';
  import KonversationAnsicht from './KonversationAnsicht.svelte';
  import MehrfachAktionen from './MehrfachAktionen.svelte';
  import { errorMessage } from '../../lib/api';
  import {
    alleGelesen,
    ladeNachKonflikt,
    ladePostfach,
    neuLaden,
    postfachListe,
  } from '../../lib/postfachStore.svelte';
  import {
    FILTER_START,
    filterAktiv,
    filterAnzahl,
    filterKonversationen,
    konversationAusHash,
    konversationHash,
    type PostfachFilter,
  } from '../../lib/postfachAnsicht';
  import { postfachOutlookUrl } from '../../../../api/lib/postfach-liste';

  /**
   * The page of a shared mailbox: the conversations of the inbox on the left, the open one on
   * the right; on a phone one after the other. The open conversation sits in the address
   * (`#konversation=`), so links from the note mails and the start page open it directly.
   */
  interface Props {
    postfach: string;
    address: string;
  }
  let { postfach, address }: Props = $props();

  const store = postfachListe.state;
  let filter = $state<PostfachFilter>({ ...FILTER_START });
  /** Conversations chosen for the actions on several at once. */
  const ausgewaehlt = new SvelteSet<string>();
  /** While the chosen ones are saved, the choice stays as it is. */
  let mehrfachBusy = $state(false);
  let aktiv = $state<string | null>(null);
  /** Counts „Neu laden“, so the open conversation is read again too. */
  let neuladen = $state(0);
  let busy = $state(false);
  let meldung = $state<string | null>(null);
  let fehler = $state<string | null>(null);

  const daten = $derived(store.data?.postfach.id === postfach ? store.data : null);
  const ich = $derived(daten?.ich ?? '');
  const zeilen = $derived(filterKonversationen(daten?.konversationen ?? [], filter, ich));
  const anzahl = $derived(filterAnzahl(daten?.konversationen ?? [], filter, ich));
  /** Empty list: nothing in the inbox, or nothing that fits the filters. */
  const leer = $derived(
    !daten?.konversationen.length
      ? 'Im Posteingang liegt keine E-Mail.'
      : daten.begrenzt
        ? 'Unter den neuesten 100 E-Mails passt keine zu den Filtern. Ältere siehst du in Outlook.'
        : 'Keine E-Mail passt zu den Filtern.'
  );
  /** The chosen ones still in the mailbox, in the order of the list. */
  const gewaehlteZeilen = $derived(
    (daten?.konversationen ?? []).filter((zeile) => ausgewaehlt.has(zeile.id))
  );
  const alleSichtbarenGewaehlt = $derived(
    zeilen.length > 0 && zeilen.every((zeile) => ausgewaehlt.has(zeile.id))
  );

  function waehle(id: string, gewaehlt: boolean): void {
    if (gewaehlt) ausgewaehlt.add(id);
    else ausgewaehlt.delete(id);
  }

  function alleSichtbaren(gewaehlt: boolean): void {
    for (const zeile of zeilen) {
      if (gewaehlt) ausgewaehlt.add(zeile.id);
      else ausgewaehlt.delete(zeile.id);
    }
  }

  function mehrfachFertig(offenGeblieben: string[]): void {
    // The open conversation shows the new state too
    if (aktiv && gewaehlteZeilen.some((zeile) => zeile.id === aktiv)) neuladen++;
    ausgewaehlt.clear();
    for (const id of offenGeblieben) ausgewaehlt.add(id);
    // Who changed what meanwhile shows after reading the list again
    if (offenGeblieben.length) void ladeNachKonflikt(postfach);
  }

  const outlook = $derived(daten?.postfach.outlookUrl ?? postfachOutlookUrl(address));

  /** The conversation was opened from the list on this page, so „back“ leads to the list. */
  let vonListe = false;

  function ausAdresse(): void {
    aktiv = konversationAusHash(window.location.hash);
    if (aktiv === null) vonListe = false;
  }

  // The client router of Astro does not report changes of the hash to the page
  function oeffnen(id: string): void {
    if (id === aktiv) return;
    // Through the router, so its history stays intact: going back then only changes the hash
    // instead of rendering the page anew (which would drop the chosen filter)
    void navigate(konversationHash(id), { history: aktiv === null ? 'push' : 'replace' });
    if (aktiv === null) vonListe = true;
    aktiv = id;
  }

  onMount(() => {
    ausAdresse();
    void ladePostfach(postfach);
    window.addEventListener('popstate', ausAdresse);
    window.addEventListener('hashchange', ausAdresse);
    return () => {
      window.removeEventListener('popstate', ausAdresse);
      window.removeEventListener('hashchange', ausAdresse);
    };
  });

  function zurListe(): void {
    if (vonListe) {
      history.back();
      return;
    }
    history.replaceState(history.state, '', window.location.pathname + window.location.search);
    aktiv = null;
  }

  async function aktualisieren(): Promise<void> {
    busy = true;
    meldung = null;
    fehler = null;
    try {
      await neuLaden(postfach);
      neuladen++;
      meldung = 'Neu geladen.';
    } catch (error: unknown) {
      fehler = errorMessage(
        error,
        'Das Postfach konnte nicht neu geladen werden. Prüfe deine Internetverbindung.'
      );
    } finally {
      busy = false;
    }
  }

  async function allesGelesen(): Promise<void> {
    busy = true;
    meldung = null;
    fehler = null;
    try {
      await alleGelesen(postfach);
      meldung = 'Alle als gelesen markiert.';
    } catch (error: unknown) {
      fehler = errorMessage(
        error,
        'Die E-Mails konnten nicht als gelesen markiert werden. Nichts wurde geändert.'
      );
    } finally {
      busy = false;
    }
  }
</script>

<div class="space-y-3">
  <div class="flex flex-wrap items-center gap-2" class:max-lg:hidden={aktiv}>
    <a
      class="btn-primary inline-flex items-center gap-1"
      href={outlook}
      target="_blank"
      rel="noopener noreferrer"
      >Postfach in Outlook öffnen<span aria-hidden="true">↗</span><span class="sr-only">
        (öffnet neuen Tab)</span
      ></a
    >
    <ActionButton disabled={busy} onclick={aktualisieren}>Neu laden</ActionButton>
    {#if anzahl.ungelesen > 0}
      <ActionButton disabled={busy} onclick={allesGelesen}>Alle als gelesen markieren</ActionButton>
    {/if}
    {#if meldung}<span role="status" class="text-sm text-success">{meldung}</span>{/if}
    {#if fehler}<span role="alert" class="text-sm text-danger"><MessageText text={fehler} /></span
      >{/if}
  </div>

  <LoadState
    data={daten}
    loading={store.loading}
    error={store.error}
    loadingText="E-Mails werden geladen …"
    onretry={() => void ladePostfach(postfach)}
  >
    <div class="grid gap-4 lg:grid-cols-[minmax(18rem,26rem)_1fr]">
      <section
        aria-label="Posteingang"
        class="surface min-w-0 lg:flex lg:max-h-[calc(100dvh-11rem)] lg:flex-col"
        class:max-lg:hidden={aktiv}
      >
        <PostfachFilterLeiste bind:filter {anzahl}>
          {#snippet vorne()}
            {#if zeilen.length}
              <label
                class="flex min-h-11 cursor-pointer items-center gap-3 pl-1 text-sm text-brand-900"
              >
                <input
                  type="checkbox"
                  class="size-5 cursor-pointer accent-brand-900"
                  checked={alleSichtbarenGewaehlt}
                  disabled={mehrfachBusy}
                  indeterminate={!alleSichtbarenGewaehlt &&
                    zeilen.some((zeile) => ausgewaehlt.has(zeile.id))}
                  onchange={(event) => alleSichtbaren(event.currentTarget.checked)}
                />
                Alle {zeilen.length} auswählen
              </label>
            {/if}
          {/snippet}
        </PostfachFilterLeiste>
        <MehrfachAktionen
          bind:busy={mehrfachBusy}
          {postfach}
          zeilen={gewaehlteZeilen}
          {ich}
          onfertig={mehrfachFertig}
          onaufheben={() => ausgewaehlt.clear()}
        />
        <div class="min-h-0 flex-1 overflow-y-auto">
          <KonversationListe
            {ausgewaehlt}
            auswahlGesperrt={mehrfachBusy}
            onwaehle={waehle}
            {zeilen}
            {ich}
            {aktiv}
            {leer}
            onzuruecksetzen={filterAktiv(filter) ? () => (filter = { ...FILTER_START }) : undefined}
            onoeffnen={oeffnen}
          />
          {#if daten?.begrenzt}
            <!-- The list reads the newest messages only; nothing older is hidden silently -->
            <p class="border-t border-neutral-200 p-3 text-sm text-neutral-700">
              Hier stehen die neuesten 100 E-Mails.
              <a class="text-link" href={outlook} target="_blank" rel="noopener noreferrer"
                >Ältere in Outlook ansehen<span aria-hidden="true">↗</span></a
              >
            </p>
          {/if}
        </div>
      </section>

      <section
        aria-label="Gewählte E-Mail"
        class="min-w-0 lg:max-h-[calc(100dvh-11rem)] lg:overflow-y-auto lg:pr-1"
        class:max-lg:hidden={!aktiv}
      >
        {#if aktiv}
          <KonversationAnsicht
            {postfach}
            outlookPostfach={outlook}
            konversation={aktiv}
            {neuladen}
            {ich}
            onzurueck={zurListe}
            onkonflikt={() => void ladeNachKonflikt(postfach)}
          />
        {:else}
          <p class="surface-muted p-6 text-center text-neutral-700">Wähle links eine E-Mail aus.</p>
        {/if}
      </section>
    </div>
  </LoadState>
</div>
