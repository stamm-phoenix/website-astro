<script lang="ts">
  import { onMount } from 'svelte';
  import { navigate } from 'astro:transitions/client';
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import MessageText from '../ui/MessageText.svelte';
  import KonversationListe from './KonversationListe.svelte';
  import KonversationAnsicht from './KonversationAnsicht.svelte';
  import { errorMessage } from '../../lib/api';
  import {
    alleGelesen,
    ladePostfach,
    neuLaden,
    postfachListe,
  } from '../../lib/postfachStore.svelte';
  import {
    POSTFACH_FILTER,
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
  const LEER: Record<PostfachFilter, string> = {
    offen: 'Alles erledigt: Keine E-Mail ist mehr offen.',
    mir: 'Dir ist gerade keine offene E-Mail zugewiesen.',
    ohne: 'Für jede offene E-Mail ist jemand zuständig.',
    ungelesen: 'Du hast alles gelesen.',
    erledigt: 'Noch keine E-Mail ist erledigt.',
    alle: 'Im Posteingang liegt keine E-Mail.',
  };

  /** Empty filters of a full inbox: only the newest messages were looked at. */
  const LEER_BEGRENZT: Record<PostfachFilter, string> = {
    offen: 'Unter den neuesten 100 E-Mails ist keine mehr offen.',
    mir: 'Unter den neuesten 100 E-Mails ist dir keine offene zugewiesen.',
    ohne: 'Unter den neuesten 100 E-Mails hat jede offene eine Zuständige.',
    ungelesen: 'Unter den neuesten 100 E-Mails hast du alles gelesen.',
    erledigt: 'Unter den neuesten 100 E-Mails ist noch keine erledigt.',
    alle: '',
  };

  let filter = $state<PostfachFilter>('offen');
  let aktiv = $state<string | null>(null);
  /** Counts „Neu laden“, so the open conversation is read again too. */
  let neuladen = $state(0);
  let busy = $state(false);
  let meldung = $state<string | null>(null);
  let fehler = $state<string | null>(null);

  const daten = $derived(store.data?.postfach.id === postfach ? store.data : null);
  const ich = $derived(daten?.ich ?? '');
  const zeilen = $derived(filterKonversationen(daten?.konversationen ?? [], filter, ich));
  const anzahl = $derived(filterAnzahl(daten?.konversationen ?? [], ich));
  const optionen = $derived(
    POSTFACH_FILTER.map((option) => ({ ...option, count: anzahl[option.value] }))
  );
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
        <div class="border-b border-neutral-200 p-2">
          <FilterTabs
            label="E-Mails filtern"
            options={optionen}
            value={filter}
            onselect={(value) => (filter = value)}
            countNouns={['E-Mail', 'E-Mails']}
          />
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto">
          <KonversationListe
            {zeilen}
            {ich}
            {aktiv}
            leer={!daten?.konversationen.length
              ? LEER.alle
              : daten.begrenzt && filter !== 'alle'
                ? `${LEER_BEGRENZT[filter]} Ältere E-Mails siehst du in Outlook.`
                : LEER[filter]}
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
            onkonflikt={() => void ladePostfach(postfach)}
          />
        {:else}
          <p class="surface-muted p-6 text-center text-neutral-700">Wähle links eine E-Mail aus.</p>
        {/if}
      </section>
    </div>
  </LoadState>
</div>
