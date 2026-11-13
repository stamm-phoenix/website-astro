<script lang="ts">
  import { freigabeErwaehnte, freigabeMeldung } from '../../lib/protokollFreigabe';
  import { scrollBehavior } from '../../lib/motion';
  import MessageText from '../ui/MessageText.svelte';
  import { onMount, tick, untrack } from 'svelte';
  import { navigate } from 'astro:transitions/client';
  import ProtokollAktionDialog from './ProtokollAktionDialog.svelte';
  import type { AktionKapitel } from './ProtokollAktionDialog.svelte';
  import ProtokollAnsicht from './ProtokollAnsicht.svelte';
  import ProtokollKopfEditor from './ProtokollKopfEditor.svelte';
  import ProtokollFreigabeDialog from './ProtokollFreigabeDialog.svelte';
  import ProtokollReview from './ProtokollReview.svelte';
  import ProtokollTagesordnung from './ProtokollTagesordnung.svelte';
  import ProtokollTextModusWahl from './ProtokollTextModusWahl.svelte';
  import ProtokollVersionen from './ProtokollVersionen.svelte';
  import FormField from '../pflege/FormField.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import ModalDialog from '../ui/ModalDialog.svelte';
  import { ApiError, errorMessage, fetchApi, sendApi } from '../../lib/api';
  import { authStore, fetchPrincipal } from '../../lib/authStore.svelte';
  import {
    MAX_PUNKTE,
    PROTOKOLL_STATUS,
    currentTime,
    formatDateTime,
    formatTime,
    freigabeAufgaben,
    neuerPunkt,
    newElementId,
    openPraesentation,
  } from '../../lib/protokollEditor';
  import type { TextModus } from '../../lib/protokollEditor';
  import { wasWriting } from '../../lib/protokollLokal';
  import { ProtokollEditorSession } from '../../lib/protokollEditorSession.svelte';
  import type { NoticeKind } from '../../lib/protokollEditorSession.svelte';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import {
    aufgabenAbwarten,
    aufgabenLaufen,
    protokollAufgaben,
    resetAufgabenStand,
  } from '../../lib/protokollAufgabenStore.svelte';
  import {
    loadStaffSettings,
    saveStaffSetting,
    settingsStore,
  } from '../../lib/staffSettingsStore.svelte';
  import { punktHatInhalt } from '../../lib/protokollPunktInhalt';
  import type {
    ProtokollAktion,
    ProtokollEditorPersonen,
    ProtokollFreigabeResponse,
    PersonOption,
    ProtokollPunkt,
    ProtokollRevision,
  } from '../../../../api/lib/protokoll-editor-model';

  let message = $state<string | null>(null);
  let messageKind = $state<NoticeKind>('success');

  let personen = $state.raw<PersonOption[]>([]);
  let personenUnavailable = $state(false);

  const session = new ProtokollEditorSession({
    notify,
    settle: settleAufgaben,
    beforeStart: fixTextModus,
    follow: async (punktId) => {
      await tick();
      document
        .getElementById(`ansicht-${punktId}`)
        ?.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
    },
    login: () => authStore.principal?.userDetails ?? '',
    loadLogin: fetchPrincipal,
    visible: () => document.visibilityState === 'visible',
  });
  const speicherung = session.speicherung;
  const mitlesen = session.mitlesen;

  /**
   * The formatting editor or the Markdown field for the texts (#320). The choice is saved per
   * person on the server and fixed when the writing starts, so a late answer of the server never
   * swaps the field under the hands of the person; it applies at the next opening.
   */
  let textModus = $state<TextModus>('formatiert');
  let textModusHinweis = $state<string | null>(null);
  /** The load of the settings for this opening; the start of the writing waits briefly for it. */
  let settingsLoaded: Promise<void> = Promise.resolve();

  /** Takes the saved choice, or the default when the settings are still on their way. */
  async function fixTextModus(): Promise<void> {
    await Promise.race([settingsLoaded, new Promise((resolve) => setTimeout(resolve, 1500))]);
    textModus = settingsStore.settings.protokollText ?? 'formatiert';
  }

  /** Switches at once and saves the choice; a failed save keeps the switch for this page. */
  async function chooseTextModus(value: TextModus): Promise<void> {
    // The other view replaces this one; a tick or a project link on its way lands here first
    await settleAufgaben();
    textModus = value;
    textModusHinweis = null;
    try {
      await saveStaffSetting('protokollText', value);
      // The saves run one after another, so a success also clears the failure of an older choice
      textModusHinweis = null;
    } catch (error: unknown) {
      textModusHinweis = errorMessage(
        error,
        'Deine Wahl gilt für diese Seite, wurde aber nicht gespeichert. Prüfe deine Internetverbindung; beim nächsten Umschalten wird sie wieder gespeichert.'
      );
    }
  }

  // --- Local copies ---
  let localPreview = $state(false);
  /** The minutes being written as they will read, without leaving the editor. */
  let ownPreview = $state(false);
  let discardingLocal = $state(false);

  // --- Dialogs ---
  let takeoverBusy = $state(false);
  let takeoverError = $state<string | null>(null);
  let removing = $state.raw<{ titel: string; nummer: string; remove: () => void } | null>(null);
  /** Asked when leaving the editor while the end of the meeting is still empty. */
  let endeFrage = $state(false);
  /** The time offered as the end, taken when the question opens. */
  let endeJetzt = $state('');
  let versionsOpen = $state(false);
  let aktionOpen = $state<AktionKapitel | null>(null);
  let deleting = $state(false);
  let deleteBusy = $state(false);
  let deleteError = $state<string | null>(null);
  /** The step chosen for the finished draft: a review, or approving it directly. */
  let submitting = $state<'review' | 'approve' | null>(null);
  let submitBusy = $state(false);
  let submitError = $state<string | null>(null);
  /** Height of the sticky site header; the status bar sticks right below it. */
  let headerHeight = $state(0);

  const login = $derived(authStore.principal?.userDetails ?? '');
  const detail = $derived(session.detail);
  const sperre = $derived(session.sperre);
  const mode = $derived(session.mode);
  const editable = $derived(detail?.status === 'entwurf');
  const writerActive = $derived(sperre !== null && !sperre.expired && !sperre.mine);
  const usedAktionen = $derived(
    new Set(
      (session.stand?.inhalt.punkte ?? [])
        .flatMap((p) => [p, ...p.unterpunkte])
        .flatMap((p) => (p.aktion ? [p.aktion.id] : []))
    )
  );

  function notify(text: string, kind: NoticeKind = 'success'): void {
    messageKind = kind;
    message = text;
  }

  async function loadPersonen(): Promise<void> {
    try {
      const result = await fetchApi<ProtokollEditorPersonen>('/intern/protokoll-editor-personen');
      personen = result.personen;
      personenUnavailable = result.unavailable;
    } catch {
      personenUnavailable = true;
    }
  }

  // --- Writing ---

  async function confirmTakeover(): Promise<void> {
    takeoverBusy = true;
    takeoverError = null;
    await session.startWriting(true);
    takeoverBusy = false;
    if (session.mode === 'schreiben') session.takeover = null;
    else
      takeoverError = 'Die Bearbeitung wurde nicht übernommen. Tippe noch einmal auf „Übernehmen“.';
  }

  /** „Bearbeitung beenden“: asks first whether the meeting ends now, unless it has an end. */
  function requestStop(): void {
    if (session.stand && !session.stand.inhalt.kopf.ende) {
      endeJetzt = currentTime();
      endeFrage = true;
      return;
    }
    void session.stopWriting();
  }

  async function finishWriting(setEnde: boolean): Promise<void> {
    endeFrage = false;
    if (setEnde && session.stand) {
      const ende = endeJetzt;
      session.stand.inhalt.kopf.ende = ende;
      await tick();
      if ((await session.stopWriting()) && session.mode === 'lesen') {
        notify(`Sitzungsende ${ende} Uhr eingetragen und Bearbeitung beendet.`);
      }
      return;
    }
    await session.stopWriting();
  }

  /** Ticks on their way reach the document first, so the saved minutes show them. */
  async function settleAufgaben(): Promise<void> {
    await aufgabenAbwarten();
    await tick();
  }

  function onfocusin(event: FocusEvent): void {
    const element = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-punkt]');
    session.setActive(element?.dataset.punkt ?? null);
  }

  function showPraesentation(): void {
    if (session.id === null) return;
    if (!openPraesentation(session.id)) {
      notify(
        'Der Browser hat das Fenster blockiert. Bitte Pop-ups für diese Seite erlauben.',
        'warning'
      );
    }
  }

  // Every change of the document while writing; the snapshot reads, and so tracks, all of it
  $effect(() => {
    if (session.mode !== 'schreiben') return;
    const snapshot = session.snapshot();
    if (snapshot) untrack(() => speicherung.edited(snapshot));
  });

  // --- Local copies ---

  function adoptLocal(): Promise<void> {
    return session.adoptLocal(() => (localPreview = false));
  }

  function discardLocal(): void {
    if (!session.discardLocal()) return;
    discardingLocal = false;
    localPreview = false;
    notify('Die Fassung auf diesem Gerät wurde verworfen.');
  }

  function restoreRevision(revision: ProtokollRevision): void {
    const restoring = session.restoreRevision(revision, () =>
      notify(
        `Die Fassung von ${formatDateTime(revision.savedAt)} ist wiederhergestellt; die vorige ist gesichert.`
      )
    );
    if (restoring) versionsOpen = false;
  }

  // --- Agenda ---

  /**
   * Focuses a field of an item as soon as it exists; the formatting editor may still be
   * loading. Gives up once the person clicks or types elsewhere in the meantime.
   */
  async function focusPunkt(punktId: string, field: 'titel' | 'text'): Promise<void> {
    const id = `${field}-${punktId}`;
    let interrupted = false;
    const interrupt = (): void => {
      interrupted = true;
    };
    document.addEventListener('pointerdown', interrupt, true);
    document.addEventListener('keydown', interrupt, true);
    try {
      for (let attempt = 0; attempt < 60; attempt++) {
        await tick();
        if (interrupted) return;
        const element = document.getElementById(id);
        if (element) {
          focusField(element, field);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      document.removeEventListener('pointerdown', interrupt, true);
      document.removeEventListener('keydown', interrupt, true);
    }
  }

  /** Focuses a field; a field of the document editor gets the cursor at its start or end. */
  function focusField(element: HTMLElement, field: 'titel' | 'text'): void {
    const dokument = element.closest<HTMLElement>('.ProseMirror');
    if (!dokument) {
      element.focus();
      return;
    }
    // The cursor goes to the end of the title or into the first block of the text
    const block =
      field === 'text'
        ? (element.querySelector('p, li, h1, h2, h3, td, th, pre') ?? element)
        : element;
    const range = document.createRange();
    range.selectNodeContents(block);
    range.collapse(field === 'text');
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    dokument.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'nearest' });
  }

  function addPunkt(): void {
    if (!session.stand) return;
    const punkt = neuerPunkt(newElementId());
    session.stand.inhalt.punkte.push(punkt);
    void focusPunkt(punkt.id, 'titel');
  }

  function addAktion(aktion: ProtokollAktion): void {
    if (!session.stand) return;
    const art = aktionOpen ?? 'Planung';
    aktionOpen = null;
    const punkt: ProtokollPunkt = {
      ...neuerPunkt(newElementId(), `${art} ${aktion.titel}`.slice(0, 200)),
      aktion,
    };
    session.stand.inhalt.punkte.push(punkt);
    void focusPunkt(punkt.id, 'text');
  }

  function confirmRemove(punkt: ProtokollPunkt, nummer: string, remove: () => void): void {
    if (!punktHatInhalt(punkt)) {
      remove();
      return;
    }
    removing = { titel: punkt.titel.trim() || 'Ohne Titel', nummer, remove };
  }

  /**
   * Finishes a draft: gives it to the review, or approves it directly (which files the PDF).
   * Saves what is left first, then the server releases the lock and nobody can write any more,
   * unless the minutes come back from the review.
   */
  async function finishDraft(action: 'review' | 'approve', ownConfirmed = false): Promise<void> {
    const id = session.id;
    const shown = session.detail;
    if (id === null || !shown) return;
    const label = action === 'review' ? 'Zur Prüfung geben' : 'Freigeben';
    submitBusy = true;
    submitError = null;
    try {
      let version = shown.etag;
      if (session.mode === 'schreiben') {
        await settleAufgaben();
        await speicherung.flush();
        if (speicherung.saveState !== 'gespeichert') {
          submitError = `Noch ist nicht alles gespeichert. Warte, bis „Gespeichert“ erscheint, und tippe dann noch einmal auf „${label}“.`;
          return;
        }
        version = speicherung.etag;
      }
      const result = await sendApi<Partial<ProtokollFreigabeResponse>>(
        'POST',
        `/intern/pflege/protokoll-editor/${id}/review`,
        { action, etag: version, token: session.token, ownConfirmed }
      );
      if (session.mode === 'schreiben') session.leave();
      submitting = null;
      await session.loadDetail();
      session.mitlesen.start();
      notify(
        action === 'review'
          ? 'Zur Prüfung gegeben. Alle Leitenden können es jetzt freigeben oder zurückgeben.'
          : freigabeMeldung(result, (session.detail ?? shown).title)
      );
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 423) {
        submitError = 'Gerade schreibt jemand anderes. Erst wenn niemand mehr schreibt, geht das.';
      } else if (error instanceof ApiError && error.status === 409) {
        submitError = `Das Protokoll wurde inzwischen geändert. Lade die Seite neu und tippe dann noch einmal auf „${label}“.`;
      } else {
        submitError = errorMessage(
          error,
          action === 'review'
            ? 'Das Protokoll wurde nicht zur Prüfung gegeben. Tippe noch einmal auf „Zur Prüfung geben“.'
            : 'Das Protokoll wurde nicht freigegeben. Tippe noch einmal auf „Freigeben“.'
        );
      }
    } finally {
      submitBusy = false;
    }
  }

  async function deleteProtokoll(): Promise<void> {
    if (session.id === null) return;
    deleteBusy = true;
    deleteError = null;
    try {
      await session.delete();
      await navigate('/leitendenbereich/protokolle');
    } catch (error: unknown) {
      deleteError = errorMessage(
        error,
        'Das Protokoll wurde nicht gelöscht. Prüfe deine Internetverbindung und tippe noch einmal auf „Löschen“.'
      );
      deleteBusy = false;
    }
  }

  onMount(() => {
    // What was ticked in other minutes opened before on this page stays there
    resetAufgabenStand();
    // Read once when the page opens; not reactive state
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const params = new URLSearchParams(window.location.search);
    const parsed = Number(params.get('id'));
    if (!Number.isInteger(parsed) || parsed <= 0) {
      session.loadError = 'Kein Protokoll ausgewählt.';
      return;
    }
    const wantsToWrite = params.get('bearbeiten') === '1' || wasWriting(parsed);
    if (params.has('bearbeiten')) {
      params.delete('bearbeiten');
      history.replaceState(history.state, '', `${window.location.pathname}?${params}`);
    }

    void loadPersonen();
    // Projects may have been added in the module Aufgaben since the last editor on this page
    void protokollAufgaben.load({ force: true });
    // The settings arrive on their own; the start of the writing takes them up but must not
    // wait for them here, or a late answer would act on an outdated version
    settingsLoaded = loadStaffSettings();
    session.open(parsed, wantsToWrite);

    // A tick on its way is not in the document yet, but it is already in the module Aufgaben
    const unguard = guardUnsavedChanges(
      () =>
        session.mode === 'schreiben' &&
        (speicherung.saveState !== 'gespeichert' || aufgabenLaufen())
    );
    const onPageHide = (): void => session.releaseOnPageHide();
    window.addEventListener('pagehide', onPageHide);
    const header = document.querySelector<HTMLElement>('body > header');
    const resize = new ResizeObserver(() => (headerHeight = header?.offsetHeight ?? 0));
    if (header) resize.observe(header);
    return () => {
      unguard();
      session.close();
      window.removeEventListener('pagehide', onPageHide);
      resize.disconnect();
    };
  });
</script>

<svelte:window
  onwheel={() => mitlesen.stopFollowing()}
  ontouchmove={() => mitlesen.stopFollowing()}
/>

<div class="protokoll-editor space-y-6" {onfocusin}>
  {#if session.loadError && !detail}
    <div class="space-y-3">
      <p class="text-sm font-semibold text-danger" role="alert">
        <MessageText text={session.loadError} />
      </p>
      <a href="/leitendenbereich/protokolle" class="text-link text-sm">Zur Übersicht</a>
    </div>
  {:else if !detail}
    <div role="status" aria-live="polite" class="space-y-2">
      <span class="sr-only">Protokoll wird geladen …</span>
      {#each [1, 2, 3] as n (n)}
        <div class="skeleton-element h-16 rounded-[var(--radius-lg)]"></div>
      {/each}
    </div>
  {:else}
    <div
      data-sticky-top
      class="leiste flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2"
      style:--header-height="{headerHeight}px"
    >
      {#if mode === 'schreiben'}
        <p
          class="text-sm font-semibold"
          class:text-success={speicherung.saveState === 'gespeichert'}
          class:text-warning={speicherung.saveState === 'offline' ||
            speicherung.saveState === 'ungespeichert'}
          class:text-danger={speicherung.saveState === 'fehler'}
          role="status"
          aria-live="polite"
        >
          {speicherung.statusText}
        </p>
      {:else}
        <p
          class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
          role="status"
          aria-live="polite"
        >
          <StatusLabel
            label={PROTOKOLL_STATUS[detail.status].label}
            tone={PROTOKOLL_STATUS[detail.status].tone}
          />
          {#if editable && writerActive && sperre}
            <span><span class="font-semibold">{sperre.name}</span> schreibt gerade</span>
          {/if}
        </p>
      {/if}
      {#if mode === 'schreiben'}
        <ActionButton onclick={requestStop}>Bearbeitung beenden</ActionButton>
      {:else if editable}
        <ActionButton
          variant="primary"
          disabled={session.starting}
          aria-busy={session.starting}
          onclick={() =>
            writerActive && sperre ? (session.takeover = sperre) : session.startWriting()}
        >
          {writerActive ? 'Bearbeitung übernehmen' : 'Bearbeiten'}
        </ActionButton>
      {/if}
    </div>

    {#if mode === 'schreiben' && speicherung.saveState === 'fehler' && speicherung.saveError}
      <div class="border-l-2 border-danger py-1 pl-4 text-sm" role="alert">
        <p class="text-danger"><MessageText text={speicherung.saveError} /></p>
        <ActionButton class="mt-2" onclick={() => void speicherung.save()}
          >Erneut speichern</ActionButton
        >
      </div>
    {/if}
    {#if speicherung.localWarning && mode === 'schreiben'}
      <p class="border-l-2 border-warning py-1 pl-4 text-sm text-warning">
        Ungespeicherte Änderungen gehen verloren, wenn du diese Seite schließt.
      </p>
    {/if}

    {#if session.localConflict}
      <div class="space-y-2 border-l-2 border-warning py-1 pl-4 text-sm">
        <p class="font-semibold text-warning">
          Auf diesem Gerät gibt es eine nicht gespeicherte Fassung vom {formatDateTime(
            session.localConflict.changedAt
          )}.
        </p>
        <p class="text-neutral-800">Das Protokoll wurde inzwischen anders gespeichert.</p>
        <div class="flex flex-wrap gap-2">
          <ActionButton onclick={() => (localPreview = true)}>Ansehen</ActionButton>
          {#if editable}
            <ActionButton variant="primary" onclick={adoptLocal}
              >Meine Fassung übernehmen</ActionButton
            >
          {/if}
          <ActionButton variant="danger" onclick={() => (discardingLocal = true)}
            >Verwerfen</ActionButton
          >
        </div>
      </div>
    {/if}

    <StatusNotice {message} kind={messageKind} popup />

    <ProtokollReview
      {detail}
      {login}
      writing={mode === 'schreiben'}
      bind:follow={mitlesen.follow}
      canFinish={editable && (mode === 'schreiben' || !writerActive)}
      onfinish={(action) => {
        submitting = action;
        submitError = null;
      }}
      onpraesentation={showPraesentation}
      onleseansicht={() => (ownPreview = true)}
      onversionen={() => (versionsOpen = true)}
      onchanged={() => session.loadDetail()}
      {notify}
    />

    {#if mode === 'schreiben' && session.stand}
      <div class="space-y-8">
        <div class="grid gap-4 sm:grid-cols-[1fr_auto]">
          <FormField
            id="protokoll-titel"
            label="Titel"
            error={session.stand.title.trim() ? undefined : 'Bitte einen Titel angeben.'}
          >
            {#snippet children(attrs)}
              <input
                {...attrs}
                type="text"
                class="form-input"
                maxlength="200"
                bind:value={session.stand!.title}
              />
            {/snippet}
          </FormField>
          <FormField
            id="protokoll-datum"
            label="Datum der Sitzung"
            error={session.stand.date ? undefined : 'Bitte das Datum angeben.'}
          >
            {#snippet children(attrs)}
              <input {...attrs} type="date" class="form-input" bind:value={session.stand!.date} />
            {/snippet}
          </FormField>
        </div>

        <details class="border-y border-neutral-200 py-2">
          <summary class="min-h-11 cursor-pointer content-center font-semibold text-brand-900"
            >Sitzungsdaten und Teilnehmende bearbeiten ({session.stand.inhalt.kopf.teilnehmende
              .length} eingetragen)</summary
          >
          <div class="py-4">
            <ProtokollKopfEditor
              bind:kopf={session.stand.inhalt.kopf}
              {personen}
              {personenUnavailable}
            />
          </div>
        </details>

        <section class="space-y-4" aria-labelledby="tagesordnung-titel">
          <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div class="flex items-center gap-1">
              <h2 id="tagesordnung-titel" class="font-serif text-xl text-brand-900">
                Tagesordnung
              </h2>
              <InfoHint label="Tagesordnung">
                <p>
                  Punkte lassen sich am Griff
                  <svg
                    aria-hidden="true"
                    class="inline h-4 w-4 align-[-2px]"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    ><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle
                      cx="9"
                      cy="12"
                      r="1.6"
                    /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle
                      cx="15"
                      cy="18"
                      r="1.6"
                    /></svg
                  >
                  verschieben: nach rechts gezogen wird ein Punkt Unterpunkt, nach links Hauptpunkt.
                </p>
              </InfoHint>
            </div>
            <ProtokollTextModusWahl
              value={textModus}
              onselect={(value) => void chooseTextModus(value)}
            />
          </div>
          {#if textModusHinweis}
            <p class="text-sm text-warning" role="status" aria-live="polite">
              <MessageText text={textModusHinweis} />
            </p>
          {/if}
          {#if protokollAufgaben.state.error && !protokollAufgaben.state.data}
            <div class="flex flex-wrap items-center gap-2 text-sm text-warning" role="status">
              <p>
                Projekte und offene Aufgaben aus dem Modul Aufgaben wurden nicht geladen. Du kannst
                weiterschreiben; Aufgaben im Protokoll werden bei der Freigabe trotzdem angelegt.
              </p>
              <ActionButton
                onclick={() => void protokollAufgaben.load({ force: true })}
                disabled={protokollAufgaben.state.loading}
              >
                {protokollAufgaben.state.loading ? 'Lädt …' : 'Erneut laden'}
              </ActionButton>
            </div>
          {/if}
          <ProtokollTagesordnung
            bind:punkte={session.stand.inhalt.punkte}
            {personen}
            {confirmRemove}
            {textModus}
            onactive={(punkt) => session.setActive(punkt)}
          />
          <div class="flex flex-wrap gap-2 border-t border-neutral-200 pt-4">
            <ActionButton
              onclick={addPunkt}
              disabled={session.stand.inhalt.punkte.length >= MAX_PUNKTE}
            >
              + Tagesordnungspunkt
            </ActionButton>
            <ActionButton
              onclick={() => (aktionOpen = 'Planung')}
              disabled={session.stand.inhalt.punkte.length >= MAX_PUNKTE}
            >
              + Planungskapitel aus Aktion
            </ActionButton>
            <ActionButton
              onclick={() => (aktionOpen = 'Reflexion')}
              disabled={session.stand.inhalt.punkte.length >= MAX_PUNKTE}
            >
              + Reflexionskapitel aus Aktion
            </ActionButton>
          </div>
        </section>

        <section class="space-y-4" aria-labelledby="naechste-titel">
          <h2 id="naechste-titel" class="font-serif text-xl text-brand-900">
            Nächste Leitendenrunde
          </h2>
          <div class="grid gap-4 sm:grid-cols-[auto_auto_1fr]">
            <FormField id="naechste-datum" label="Datum" optional>
              {#snippet children(attrs)}
                <input
                  {...attrs}
                  type="date"
                  class="form-input"
                  bind:value={session.stand!.inhalt.naechsteSitzung.datum}
                />
              {/snippet}
            </FormField>
            <FormField id="naechste-uhrzeit" label="Uhrzeit" optional>
              {#snippet children(attrs)}
                <input
                  {...attrs}
                  type="time"
                  class="form-input"
                  bind:value={session.stand!.inhalt.naechsteSitzung.uhrzeit}
                />
              {/snippet}
            </FormField>
            <FormField id="naechste-ort" label="Ort" optional>
              {#snippet children(attrs)}
                <input
                  {...attrs}
                  type="text"
                  class="form-input"
                  maxlength="200"
                  bind:value={session.stand!.inhalt.naechsteSitzung.ort}
                />
              {/snippet}
            </FormField>
          </div>
        </section>

        {#if detail.canDelete}
          <div class="border-t border-neutral-200 pt-4">
            <ActionButton variant="danger" onclick={() => (deleting = true)}>
              Protokoll löschen
            </ActionButton>
          </div>
        {/if}
      </div>
    {:else}
      <ProtokollAnsicht
        title={detail.title}
        date={detail.date}
        inhalt={detail.inhalt}
        changed={mitlesen.changed}
        active={writerActive ? (sperre?.aktiverPunkt ?? null) : null}
      />
      <p class="text-sm text-neutral-700">
        Zuletzt gespeichert {formatDateTime(detail.updatedAt)} von {detail.updatedBy}.
      </p>
      {#if detail.canDelete && !writerActive}
        <ActionButton variant="danger" onclick={() => (deleting = true)}
          >Protokoll löschen</ActionButton
        >
      {/if}
    {/if}
  {/if}
</div>

{#if session.id !== null}
  <ProtokollVersionen
    open={versionsOpen}
    protokollId={session.id}
    canRestore={mode === 'schreiben'}
    onclose={() => (versionsOpen = false)}
    onrestore={restoreRevision}
  />
{/if}

<ProtokollAktionDialog
  art={aktionOpen}
  date={session.stand?.date ?? detail?.date ?? ''}
  used={usedAktionen}
  onclose={() => (aktionOpen = null)}
  onselect={addAktion}
/>

<ConfirmDialog
  open={session.takeover !== null}
  title="Bearbeitung übernehmen?"
  tone="neutral"
  submitLabel="Übernehmen"
  busyLabel="Wird übernommen …"
  busy={takeoverBusy}
  error={takeoverError}
  onclose={() => {
    session.takeover = null;
    takeoverError = null;
  }}
  onconfirm={confirmTakeover}
>
  {#if session.takeover}
    <p>
      <strong>{session.takeover.name}</strong> schreibt gerade (seit {formatTime(
        session.takeover.since
      )}). Wenn du übernimmst, kann {session.takeover.name} nicht mehr speichern.
    </p>
    <p class="text-sm text-neutral-700">Die bisherige Fassung bleibt erhalten.</p>
  {/if}
</ConfirmDialog>

<ModalDialog open={endeFrage} title="Sitzungsende eintragen?" onclose={() => (endeFrage = false)}>
  <div class="space-y-3 px-5 py-4">
    <p>Für das Sitzungsende ist noch keine Uhrzeit eingetragen. Endet die Sitzung jetzt?</p>
  </div>
  <div class="flex flex-wrap justify-end gap-2 border-t border-neutral-200 px-5 py-3">
    <ActionButton onclick={() => (endeFrage = false)}>Weiter bearbeiten</ActionButton>
    <ActionButton onclick={() => void finishWriting(false)}>Nein, Ende leer lassen</ActionButton>
    <ActionButton variant="primary" onclick={() => void finishWriting(true)}>
      Ja, Ende auf jetzt setzen
    </ActionButton>
  </div>
</ModalDialog>

<ConfirmDialog
  open={removing !== null}
  title={`Punkt ${removing?.nummer ?? ''} „${removing?.titel ?? ''}“ löschen?`}
  onclose={() => (removing = null)}
  onconfirm={() => {
    removing?.remove();
    removing = null;
  }}
>
  <p>Text, Aufgaben, Termine und Unterpunkte werden mitgelöscht.</p>
</ConfirmDialog>

<ConfirmDialog
  open={discardingLocal}
  title="Fassung auf diesem Gerät verwerfen?"
  submitLabel="Verwerfen"
  onclose={() => (discardingLocal = false)}
  onconfirm={discardLocal}
>
  <p>Die nicht gespeicherten Änderungen auf diesem Gerät gehen dabei verloren.</p>
</ConfirmDialog>

<ConfirmDialog
  open={submitting === 'review'}
  title="Zur Prüfung geben?"
  tone="neutral"
  submitLabel="Zur Prüfung geben"
  busyLabel="Wird gespeichert …"
  busy={submitBusy}
  error={submitError}
  onclose={() => {
    if (!submitBusy) submitting = null;
  }}
  onconfirm={() => void finishDraft('review')}
>
  <p>
    Danach kann niemand mehr schreiben, bis jemand anderes das Protokoll freigibt oder mit einem
    Hinweis zurückgibt.
  </p>
</ConfirmDialog>

{#if detail}
  <ProtokollFreigabeDialog
    open={submitting === 'approve'}
    title={session.stand?.title.trim() || detail.title}
    own={login !== '' && detail.createdBy.toLowerCase() === login.toLowerCase()}
    draft
    version={detail.etag}
    consequence="Das Protokoll wird als PDF im Protokoll-Ordner abgelegt und lässt sich danach nicht mehr ändern."
    aufgaben={freigabeAufgaben(session.stand?.inhalt ?? detail.inhalt)}
    erwaehnte={freigabeErwaehnte(session.stand?.inhalt ?? detail.inhalt, login)}
    busy={submitBusy}
    error={submitError}
    onclose={() => {
      if (!submitBusy) submitting = null;
    }}
    onconfirm={(ownConfirmed) => void finishDraft('approve', ownConfirmed)}
  />
{/if}

<ConfirmDialog
  open={deleting}
  title={`Protokoll „${session.stand?.title.trim() || detail?.title || 'Ohne Titel'}“ löschen?`}
  busy={deleteBusy}
  error={deleteError}
  onclose={() => (deleting = false)}
  onconfirm={deleteProtokoll}
>
  <p>Das Protokoll und alle gesicherten Fassungen werden endgültig gelöscht.</p>
</ConfirmDialog>

{#if session.stand && mode === 'schreiben'}
  <ModalDialog open={ownPreview} title="Leseansicht" onclose={() => (ownPreview = false)}>
    <div class="px-5 py-4">
      <ProtokollAnsicht
        title={session.stand.title}
        date={session.stand.date}
        inhalt={session.stand.inhalt}
        idPrefix="vorschau"
      />
    </div>
  </ModalDialog>
{/if}

{#if session.localConflict}
  <ModalDialog
    open={localPreview}
    title="Fassung auf diesem Gerät"
    onclose={() => (localPreview = false)}
  >
    <div class="px-5 py-4">
      <ProtokollAnsicht
        title={session.localConflict.title}
        date={session.localConflict.date}
        inhalt={session.localConflict.inhalt}
        idPrefix="lokal"
      />
    </div>
  </ModalDialog>
{/if}

<style>
  .leiste {
    position: relative;
    z-index: 20;
    background: var(--color-neutral-50);
    border-bottom: 1px solid var(--color-neutral-200);
  }
  @media (min-width: 48rem) {
    .leiste {
      top: var(--header-height);
      position: sticky;
    }
  }
</style>
