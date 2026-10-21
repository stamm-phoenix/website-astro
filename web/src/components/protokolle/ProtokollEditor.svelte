<script lang="ts">
  import { scrollBehavior } from '../../lib/motion';
  import MessageText from '../ui/MessageText.svelte';
  import { onMount, tick, untrack } from 'svelte';
  import { navigate } from 'astro:transitions/client';
  import ProtokollAktionDialog from './ProtokollAktionDialog.svelte';
  import ProtokollAnsicht from './ProtokollAnsicht.svelte';
  import ProtokollKopfEditor from './ProtokollKopfEditor.svelte';
  import ProtokollFreigabeDialog from './ProtokollFreigabeDialog.svelte';
  import ProtokollReview from './ProtokollReview.svelte';
  import ProtokollTagesordnung from './ProtokollTagesordnung.svelte';
  import ProtokollVersionen from './ProtokollVersionen.svelte';
  import FormField from '../pflege/FormField.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import InfoHint from '../ui/InfoHint.svelte';
  import ModalDialog from '../ui/ModalDialog.svelte';
  import { ApiError, errorMessage, fetchApi, sendApi } from '../../lib/api';
  import { authStore, fetchPrincipal } from '../../lib/authStore.svelte';
  import {
    MAX_PUNKTE,
    SPERRE_RENEW_SECONDS,
    aufgabenAnzahl,
    changedPunkte,
    clearLocalDraft,
    copyStand,
    currentTime,
    formatDateTime,
    formatTime,
    freigabeAufgaben,
    neuerPunkt,
    newElementId,
    openPraesentation,
    parkLocalDraft,
    praesentationChannel,
    readLocalDraft,
    readParkedDrafts,
    rememberWriting,
    removeParkedDraft,
    sameStand,
    tabToken,
    wasWriting,
    writeLocalDraft,
  } from '../../lib/protokollEditor';
  import type {
    LocalDraft,
    PraesentationMessage,
    ProtokollStand,
    TextModus,
  } from '../../lib/protokollEditor';
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
  import type {
    ProtokollAktion,
    ProtokollEditorDetail,
    ProtokollEditorPersonen,
    ProtokollFreigabeResponse,
    PersonOption,
    ProtokollLiveResponse,
    ProtokollPunkt,
    ProtokollRevision,
    ProtokollSaveResponse,
    ProtokollSperre,
  } from '../../lib/types';

  /** Quiet time after the last keystroke before saving, and the longest wait while typing. */
  const SAVE_DELAY_MS = 1000;
  const SAVE_MAX_WAIT_MS = 5000;
  /** How often readers check for changes while the page is visible. */
  const POLL_MS = 2500;
  const RETRY_MS = [2000, 5000, 10_000, 20_000, 30_000];

  type SaveState = 'gespeichert' | 'ungespeichert' | 'speichert' | 'offline' | 'fehler';
  type Sicherung = 'ueberschreiben' | 'wiederherstellen';

  let id = $state<number | null>(null);
  let token = '';
  let detail = $state.raw<ProtokollEditorDetail | null>(null);
  let sperre = $state.raw<ProtokollSperre | null>(null);
  let loadError = $state<string | null>(null);
  let message = $state<string | null>(null);
  let messageKind = $state<'success' | 'warning' | 'error'>('success');

  let personen = $state.raw<PersonOption[]>([]);
  let personenUnavailable = $state(false);

  // --- Writing ---
  let mode = $state<'lesen' | 'schreiben'>('lesen');
  /** The editable copy while writing. */
  let stand = $state<ProtokollStand | null>(null);
  /** Version on the server that `stand` is based on. */
  let etag = '';
  /** `stand` as last confirmed by the server. */
  let savedJson = '';
  let saveState = $state<SaveState>('gespeichert');
  let saveError = $state<string | null>(null);
  let lastSavedAt = $state<string | null>(null);
  let localWarning = $state(false);
  let saving = false;
  let saveAgain = false;
  let sicherung: Sicherung | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let firstPendingAt: number | null = null;
  let retryIndex = 0;
  let renewTimer: ReturnType<typeof setInterval> | undefined;
  let activeTimer: ReturnType<typeof setTimeout> | undefined;
  let activePunkt = $state<string | null>(null);
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
  let starting = $state(false);

  // --- Local copies ---
  /** Unsaved changes on this device, based on the version on the server. */
  let pendingLocal: LocalDraft | null = null;
  /** Unsaved changes on this device, based on an older version. */
  let localConflict = $state.raw<LocalDraft | null>(null);
  let localPreview = $state(false);
  /** The minutes being written as they will read, without leaving the editor. */
  let ownPreview = $state(false);
  let discardingLocal = $state(false);

  // --- Reading ---
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let changed = $state.raw<Set<string>>(new Set());
  let changedTimer: ReturnType<typeof setTimeout> | undefined;
  let follow = $state(true);

  // --- Dialogs ---
  let takeover = $state.raw<ProtokollSperre | null>(null);
  let takeoverBusy = $state(false);
  let takeoverError = $state<string | null>(null);
  let removing = $state.raw<{ titel: string; nummer: string; remove: () => void } | null>(null);
  /** Asked when leaving the editor while the end of the meeting is still empty. */
  let endeFrage = $state(false);
  /** The time offered as the end, taken when the question opens. */
  let endeJetzt = $state('');
  let versionsOpen = $state(false);
  let aktionOpen = $state(false);
  let deleting = $state(false);
  let deleteBusy = $state(false);
  let deleteError = $state<string | null>(null);
  /** The step chosen for the finished draft: a review, or approving it directly. */
  let submitting = $state<'review' | 'approve' | null>(null);
  let submitBusy = $state(false);
  let submitError = $state<string | null>(null);
  /** Channel to the presentation window of this browser (`ProtokollPraesentation`). */
  let channel: BroadcastChannel | null = null;
  /** Height of the sticky site header; the status bar sticks right below it. */
  let headerHeight = $state(0);

  const login = $derived(authStore.principal?.userDetails ?? '');
  const editable = $derived(detail?.status === 'entwurf');
  const writerActive = $derived(sperre !== null && !sperre.expired && !sperre.mine);
  const usedAktionen = $derived(
    new Set(
      (stand?.inhalt.punkte ?? [])
        .flatMap((p) => [p, ...p.unterpunkte])
        .flatMap((p) => (p.aktion ? [p.aktion.id] : []))
    )
  );

  function notify(text: string, kind: 'success' | 'warning' | 'error' = 'success'): void {
    messageKind = kind;
    message = text;
  }

  function standOf(source: ProtokollEditorDetail | LocalDraft | ProtokollRevision): ProtokollStand {
    return copyStand({ title: source.title, date: source.date, inhalt: source.inhalt });
  }

  /** The token of this tab goes in a header, never in the URL (logs, history). */
  function tabHeader(): Record<string, string> {
    return { 'X-Protokoll-Tab': token };
  }

  async function loadDetail(): Promise<ProtokollEditorDetail | null> {
    if (id === null) return null;
    try {
      const loaded = await fetchApi<ProtokollEditorDetail>(
        `/intern/protokoll-editor/${id}`,
        undefined,
        tabHeader()
      );
      detail = loaded;
      sperre = loaded.sperre;
      loadError = null;
      return loaded;
    } catch (error: unknown) {
      loadError = errorMessage(
        error,
        'Das Protokoll konnte nicht geladen werden. Prüfe deine Internetverbindung und lade die Seite neu.'
      );
      return null;
    }
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

  /**
   * Sorts the local copy into „continue with it“ (based on the stored version) or „ask what
   * to do“ (parked, see `parkLocalDraft`).
   */
  function checkLocal(loaded: ProtokollEditorDetail): void {
    if (id === null || !login) return;
    const local = readLocalDraft(id, login);
    pendingLocal = null;
    if (local) {
      if (sameStand(standOf(local), standOf(loaded))) {
        clearLocalDraft(id);
      } else if (local.baseEtag === loaded.etag && loaded.status === 'entwurf') {
        pendingLocal = local;
      } else {
        parkLocalDraft(id, local);
      }
    }
    localConflict = readParkedDrafts(id, login)[0] ?? null;
  }

  // --- Writing ---

  /** Takes the lock and opens the editor; asks first if another tab writes. */
  async function startWriting(uebernehmen = false): Promise<void> {
    if (id === null || starting) return;
    starting = true;
    try {
      const [result] = await Promise.all([
        sendApi<ProtokollSaveResponse>('POST', `/intern/pflege/protokoll-editor/${id}/sperre`, {
          token,
          uebernehmen,
          aktiverPunkt: activePunkt,
        }),
        fixTextModus(),
      ]);
      sperre = result.sperre;
      let loaded = detail;
      if (!loaded || loaded.etag !== result.etag) loaded = await loadDetail();
      if (!loaded) return;
      checkLocal(loaded);
      etag = loaded.etag;
      stand = standOf(loaded);
      savedJson = JSON.stringify(stand);
      lastSavedAt = loaded.updatedAt;
      saveState = 'gespeichert';
      saveError = null;
      mode = 'schreiben';
      rememberWriting(id, true);
      stopPolling();
      startRenewing();
      if (pendingLocal) {
        stand = standOf(pendingLocal);
        notify(
          `Nicht gespeicherte Änderungen von ${formatTime(pendingLocal.changedAt)} wiederhergestellt.`
        );
        pendingLocal = null;
      }
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 423) {
        const loaded = await loadDetail();
        if (loaded?.sperre) takeover = loaded.sperre;
      } else {
        notify(
          errorMessage(
            error,
            'Die Bearbeitung wurde nicht gestartet. Tippe noch einmal auf „Bearbeiten“.'
          ),
          'error'
        );
      }
    } finally {
      starting = false;
    }
  }

  async function confirmTakeover(): Promise<void> {
    takeoverBusy = true;
    takeoverError = null;
    await startWriting(true);
    takeoverBusy = false;
    if (mode === 'schreiben') takeover = null;
    else
      takeoverError = 'Die Bearbeitung wurde nicht übernommen. Tippe noch einmal auf „Übernehmen“.';
  }

  /** „Bearbeitung beenden“: asks first whether the meeting ends now, unless it has an end. */
  function requestStop(): void {
    if (stand && !stand.inhalt.kopf.ende) {
      endeJetzt = currentTime();
      endeFrage = true;
      return;
    }
    void stopWriting();
  }

  async function finishWriting(setEnde: boolean): Promise<void> {
    endeFrage = false;
    if (setEnde && stand) {
      const ende = endeJetzt;
      stand.inhalt.kopf.ende = ende;
      await tick();
      if ((await stopWriting()) && mode === 'lesen') {
        notify(`Sitzungsende ${ende} Uhr eingetragen und Bearbeitung beendet.`);
      }
      return;
    }
    await stopWriting();
  }

  /** Ticks on their way reach the document first, so the saved minutes show them. */
  async function settleAufgaben(): Promise<void> {
    await aufgabenAbwarten();
    await tick();
  }

  /** Back to reading: saves what is left and frees the lock for others. */
  async function stopWriting(): Promise<boolean> {
    if (id === null) return false;
    await settleAufgaben();
    await flushSave();
    if (saveState !== 'gespeichert') {
      notify(
        'Noch nicht alles ist gespeichert. Die Änderungen bleiben auf diesem Gerät gesichert.',
        'warning'
      );
      return false;
    }
    stopRenewing();
    await sendApi('DELETE', `/intern/pflege/protokoll-editor/${id}/sperre`, { token }).catch(
      () => undefined
    );
    rememberWriting(id, false);
    // The presentation window follows the server again
    endBroadcast();
    mode = 'lesen';
    stand = null;
    await loadDetail();
    startPolling();
    return true;
  }

  /** Another tab took over, or the minutes changed elsewhere: read on, keep the local copy. */
  async function lostLock(): Promise<void> {
    if (id === null) return;
    stopRenewing();
    clearTimeout(saveTimer);
    rememberWriting(id, false);
    // The presentation window follows the server again
    endBroadcast();
    mode = 'lesen';
    stand = null;
    const loaded = await loadDetail();
    if (loaded) checkLocal(loaded);
    const name = loaded?.sperre && !loaded.sperre.mine ? loaded.sperre.name : 'Jemand anderes';
    notify(
      pendingLocal || readParkedDrafts(id, login).length > 0
        ? `${name} hat die Bearbeitung übernommen. Deine letzten Änderungen sind auf diesem Gerät gesichert.`
        : `${name} hat die Bearbeitung übernommen.`,
      'warning'
    );
    if (pendingLocal) {
      // The other tab writes on this version; never continue it silently
      parkLocalDraft(id, pendingLocal);
      pendingLocal = null;
      localConflict = readParkedDrafts(id, login)[0] ?? null;
    }
    startPolling();
  }

  function startRenewing(): void {
    stopRenewing();
    renewTimer = setInterval(() => void renew(), SPERRE_RENEW_SECONDS * 1000);
  }

  function stopRenewing(): void {
    clearInterval(renewTimer);
    clearTimeout(activeTimer);
  }

  async function renew(): Promise<void> {
    if (id === null || mode !== 'schreiben') return;
    try {
      const result = await sendApi<ProtokollSaveResponse>(
        'POST',
        `/intern/pflege/protokoll-editor/${id}/sperre`,
        { token, aktiverPunkt: activePunkt }
      );
      sperre = result.sperre;
    } catch (error: unknown) {
      if (error instanceof ApiError && (error.status === 423 || error.status === 409)) {
        await lostLock();
      }
      // Network errors: the save status says so; the next renewal tries again
    }
  }

  /** The item being written, for readers following along; sent shortly after it changes. */
  function setActive(next: string | null): void {
    if (!next || next === activePunkt) return;
    activePunkt = next;
    clearTimeout(activeTimer);
    activeTimer = setTimeout(() => void renew(), 600);
    broadcast();
  }

  function onfocusin(event: FocusEvent): void {
    const element = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-punkt]');
    setActive(element?.dataset.punkt ?? null);
  }

  /** Shows the current version in the presentation window of this browser right away. */
  function broadcast(snapshot?: ProtokollStand): void {
    if (!channel || mode !== 'schreiben' || !stand) return;
    const current = snapshot ?? ($state.snapshot(stand) as ProtokollStand);
    const message: PraesentationMessage = { type: 'stand', ...current, aktiverPunkt: activePunkt };
    channel.postMessage(message);
  }

  function endBroadcast(): void {
    const message: PraesentationMessage = { type: 'ende' };
    channel?.postMessage(message);
  }

  function showPraesentation(): void {
    if (id === null) return;
    if (!openPraesentation(id)) {
      notify(
        'Der Browser hat das Fenster blockiert. Bitte Pop-ups für diese Seite erlauben.',
        'warning'
      );
    }
  }

  /** Called on every change of `stand`: keeps a local copy and schedules the save. */
  function onEdited(json: string): void {
    if (id === null || !stand) return;
    broadcast(JSON.parse(json) as ProtokollStand);
    if (json === savedJson) {
      if (saveState === 'ungespeichert') saveState = 'gespeichert';
      clearLocalDraft(id);
      return;
    }
    if (saveState === 'gespeichert' || saveState === 'fehler') saveState = 'ungespeichert';
    const stored = writeLocalDraft(id, {
      ...(JSON.parse(json) as ProtokollStand),
      baseEtag: etag,
      changedAt: new Date().toISOString(),
      login,
    });
    localWarning = !stored;
    scheduleSave();
  }

  function scheduleSave(delay = SAVE_DELAY_MS): void {
    clearTimeout(saveTimer);
    const now = Date.now();
    firstPendingAt ??= now;
    const wait = Math.min(delay, Math.max(0, firstPendingAt + SAVE_MAX_WAIT_MS - now));
    saveTimer = setTimeout(() => void save(), wait);
  }

  /** Saves right away and waits for it, e.g. before leaving the editor. */
  async function flushSave(): Promise<void> {
    clearTimeout(saveTimer);
    await save();
    while (saving) await new Promise((resolve) => setTimeout(resolve, 100));
  }

  async function save(): Promise<void> {
    if (id === null || !stand || mode !== 'schreiben') return;
    if (saving) {
      saveAgain = true;
      return;
    }
    clearTimeout(saveTimer);
    const snapshot = JSON.parse(JSON.stringify(stand)) as ProtokollStand;
    const json = JSON.stringify(snapshot);
    if (json === savedJson && !sicherung) {
      saveState = 'gespeichert';
      firstPendingAt = null;
      return;
    }
    if (!snapshot.title.trim() || !snapshot.date) {
      saveState = 'fehler';
      saveError = 'Bitte Titel und Datum angeben, dann wird wieder gespeichert.';
      return;
    }
    saving = true;
    if (saveState !== 'offline') saveState = 'speichert';
    firstPendingAt = null;
    try {
      const result = await sendApi<ProtokollSaveResponse>(
        'PUT',
        `/intern/pflege/protokoll-editor/${id}`,
        { token, etag, ...snapshot, aktiverPunkt: activePunkt, sicherung }
      );
      sicherung = null;
      etag = result.etag;
      savedJson = json;
      sperre = result.sperre;
      lastSavedAt = result.updatedAt;
      saveError = null;
      retryIndex = 0;
      if (stand && JSON.stringify(stand) === json) {
        clearLocalDraft(id);
        saveState = 'gespeichert';
      } else {
        // Typed on during the save; the local copy is now based on the new version
        saveState = 'ungespeichert';
        if (stand) onEdited(JSON.stringify(stand));
      }
    } catch (error: unknown) {
      await handleSaveError(error);
    } finally {
      saving = false;
      if (saveAgain && mode === 'schreiben') {
        saveAgain = false;
        void save();
      }
    }
  }

  async function handleSaveError(error: unknown): Promise<void> {
    if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) {
      // Offline or a hiccup of the server: keep trying; the changes are on this device
      saveState = 'offline';
      const delay = RETRY_MS[Math.min(retryIndex, RETRY_MS.length - 1)];
      retryIndex++;
      saveTimer = setTimeout(() => void save(), delay);
      return;
    }
    if (error.status === 423 || (error.status === 409 && error.code === 'CONFLICT')) {
      await lostLock();
      return;
    }
    if (error.status === 409 && error.code === 'NOT_EDITABLE') {
      await lostLock();
      notify(error.message, 'warning');
      return;
    }
    if (error.status === 404) {
      saveState = 'fehler';
      saveError = 'Das Protokoll wurde gelöscht. Deine Änderungen sind auf diesem Gerät gesichert.';
      return;
    }
    saveState = 'fehler';
    saveError =
      error.status === 401
        ? 'Bitte neu anmelden. Deine Änderungen sind auf diesem Gerät gesichert.'
        : error.fields
          ? Object.values(error.fields).join(' ')
          : error.message;
  }

  // Every change of the document while writing
  $effect(() => {
    if (mode !== 'schreiben' || !stand) return;
    const json = JSON.stringify(stand);
    untrack(() => onEdited(json));
  });

  // --- Local copies ---

  /** Replaces the stored version with the copy on this device; the stored one is kept. */
  async function adoptLocal(): Promise<void> {
    const local = localConflict;
    if (!local) return;
    if (mode !== 'schreiben') await startWriting();
    if (mode !== 'schreiben' || !stand) return;
    localPreview = false;
    sicherung = 'ueberschreiben';
    stand = standOf(local);
    await flushSave();
    if (saveState === 'gespeichert' && id !== null) {
      removeParkedDraft(id, local.changedAt);
      localConflict = readParkedDrafts(id, login)[0] ?? null;
      notify('Die Fassung von diesem Gerät ist übernommen; die vorige ist gesichert.');
    }
  }

  function discardLocal(): void {
    if (id === null || !localConflict) return;
    removeParkedDraft(id, localConflict.changedAt);
    localConflict = readParkedDrafts(id, login)[0] ?? null;
    discardingLocal = false;
    localPreview = false;
    notify('Die Fassung auf diesem Gerät wurde verworfen.');
  }

  function restoreRevision(revision: ProtokollRevision): void {
    if (mode !== 'schreiben' || !stand) return;
    versionsOpen = false;
    sicherung = 'wiederherstellen';
    stand = standOf(revision);
    void flushSave().then(() => {
      if (saveState === 'gespeichert') {
        notify(
          `Die Fassung von ${formatDateTime(revision.savedAt)} ist wiederhergestellt; die vorige ist gesichert.`
        );
      }
    });
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
    if (!stand) return;
    const punkt = neuerPunkt(newElementId());
    stand.inhalt.punkte.push(punkt);
    void focusPunkt(punkt.id, 'titel');
  }

  function addAktion(aktion: ProtokollAktion): void {
    if (!stand) return;
    aktionOpen = false;
    const punkt: ProtokollPunkt = { ...neuerPunkt(newElementId(), aktion.titel), aktion };
    stand.inhalt.punkte.push(punkt);
    void focusPunkt(punkt.id, 'text');
  }

  function hasContent(punkt: ProtokollPunkt): boolean {
    return Boolean(
      punkt.text.trim() ||
      punkt.aktion ||
      punkt.aufgaben.length > 0 ||
      punkt.termine.length > 0 ||
      punkt.projekt ||
      punkt.offeneAufgaben.length > 0 ||
      punkt.unterpunkte.some((sub) => sub.titel.trim() || hasContent(sub))
    );
  }

  function confirmRemove(punkt: ProtokollPunkt, nummer: string, remove: () => void): void {
    if (!hasContent(punkt)) {
      remove();
      return;
    }
    removing = { titel: punkt.titel.trim() || 'Ohne Titel', nummer, remove };
  }

  // --- Reading ---

  function startPolling(): void {
    stopPolling();
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void poll();
    }, POLL_MS);
  }

  function stopPolling(): void {
    clearInterval(pollTimer);
  }

  async function poll(): Promise<void> {
    if (id === null || !detail || mode !== 'lesen') return;
    try {
      const live = await fetchApi<ProtokollLiveResponse>(
        `/intern/protokoll-editor/${id}/live?etag=${encodeURIComponent(detail.etag)}`,
        undefined,
        tabHeader()
      );
      if (mode !== 'lesen') return;
      const previousActive = sperre?.aktiverPunkt ?? null;
      sperre = live.sperre;
      if (live.protokoll && detail) {
        changed = changedPunkte(detail.inhalt, live.protokoll.inhalt);
        detail = live.protokoll;
        clearTimeout(changedTimer);
        changedTimer = setTimeout(() => (changed = new Set()), 2000);
      }
      const active = live.sperre && !live.sperre.expired ? live.sperre.aktiverPunkt : null;
      if (follow && active && (active !== previousActive || live.protokoll)) {
        await tick();
        document
          .getElementById(`ansicht-${active}`)
          ?.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
      }
    } catch {
      // The next check tries again
    }
  }

  /** Scrolling by hand ends following the writer. */
  function stopFollowing(): void {
    if (mode === 'lesen' && follow) follow = false;
  }

  /**
   * Finishes a draft: gives it to the review, or approves it directly (which files the PDF).
   * Saves what is left first, then the server releases the lock and nobody can write any more,
   * unless the minutes come back from the review.
   */
  async function finishDraft(action: 'review' | 'approve', ownConfirmed = false): Promise<void> {
    if (id === null || !detail) return;
    const label = action === 'review' ? 'Zur Prüfung geben' : 'Freigeben';
    submitBusy = true;
    submitError = null;
    try {
      let version = detail.etag;
      if (mode === 'schreiben') {
        await settleAufgaben();
        await flushSave();
        if (saveState !== 'gespeichert') {
          submitError = `Noch ist nicht alles gespeichert. Warte, bis „Gespeichert“ erscheint, und tippe dann noch einmal auf „${label}“.`;
          return;
        }
        version = etag;
      }
      const result = await sendApi<Partial<ProtokollFreigabeResponse>>(
        'POST',
        `/intern/pflege/protokoll-editor/${id}/review`,
        { action, etag: version, token, ownConfirmed }
      );
      if (mode === 'schreiben') {
        stopRenewing();
        clearTimeout(saveTimer);
        rememberWriting(id, false);
        mode = 'lesen';
        stand = null;
        endBroadcast();
      }
      submitting = null;
      await loadDetail();
      startPolling();
      notify(
        action === 'review'
          ? 'Zur Prüfung gegeben. Alle Leitenden können es jetzt freigeben oder zurückgeben.'
          : `Freigegeben. „${result.fileName ?? detail.title}“ liegt jetzt im Protokoll-Ordner.${result.aufgaben ? ` ${aufgabenAnzahl(result.aufgaben).replace(/^e/, 'E')} im Modul Aufgaben angelegt.` : ''}`
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
    if (id === null) return;
    deleteBusy = true;
    deleteError = null;
    try {
      stopRenewing();
      clearTimeout(saveTimer);
      await sendApi('DELETE', `/intern/pflege/protokoll-editor/${id}`);
      clearLocalDraft(id);
      rememberWriting(id, false);
      mode = 'lesen';
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
      loadError = 'Kein Protokoll ausgewählt.';
      return;
    }
    id = parsed;
    token = tabToken(parsed);
    const wantsToWrite = params.get('bearbeiten') === '1' || wasWriting(parsed);
    if (params.has('bearbeiten')) {
      params.delete('bearbeiten');
      history.replaceState(history.state, '', `${window.location.pathname}?${params}`);
    }

    void (async () => {
      // Only the copy kept on this device needs the login, so the minutes do not wait for it
      const principalLoaded = fetchPrincipal();
      void loadPersonen();
      // Projects may have been added in the module Aufgaben since the last editor on this page
      void protokollAufgaben.load({ force: true });
      // The settings arrive on their own; the start of the writing takes them up but must not
      // wait for them here, or a late answer would act on an outdated version
      settingsLoaded = loadStaffSettings();
      const [loaded] = await Promise.all([loadDetail(), principalLoaded]);
      if (!loaded) return;
      checkLocal(loaded);
      const resume = loaded.sperre?.mine || wantsToWrite || pendingLocal !== null;
      if (loaded.status === 'entwurf' && resume && !writerActiveFor(loaded)) {
        await startWriting();
      }
      if (mode === 'lesen') startPolling();
    })();

    // A tick on its way is not in the document yet, but it is already in the module Aufgaben
    const unguard = guardUnsavedChanges(
      () => mode === 'schreiben' && (saveState !== 'gespeichert' || aufgabenLaufen())
    );
    channel = praesentationChannel(parsed);
    channel?.addEventListener('message', (event: MessageEvent<PraesentationMessage>) => {
      if (event.data?.type === 'hallo') broadcast();
    });
    const onPageHide = (): void => {
      // A clean editor frees the lock right away; with unsaved changes it runs out, and
      // reloading this tab continues writing
      if (mode === 'schreiben' && saveState === 'gespeichert' && id !== null) {
        void fetch(`/api/intern/pflege/protokoll-editor/${id}/sperre`, {
          method: 'DELETE',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        }).catch(() => undefined);
      }
    };
    window.addEventListener('pagehide', onPageHide);
    const header = document.querySelector<HTMLElement>('body > header');
    const resize = new ResizeObserver(() => (headerHeight = header?.offsetHeight ?? 0));
    if (header) resize.observe(header);
    return () => {
      unguard();
      stopPolling();
      stopRenewing();
      clearTimeout(saveTimer);
      clearTimeout(changedTimer);
      window.removeEventListener('pagehide', onPageHide);
      resize.disconnect();
      endBroadcast();
      channel?.close();
    };
  });

  /** Whether another tab writes these minutes and its lock has not run out. */
  function writerActiveFor(loaded: ProtokollEditorDetail): boolean {
    return loaded.sperre !== null && !loaded.sperre.expired && !loaded.sperre.mine;
  }

  const statusText = $derived.by(() => {
    switch (saveState) {
      case 'gespeichert':
        return lastSavedAt ? `Gespeichert um ${formatTime(lastSavedAt)}` : 'Gespeichert';
      case 'ungespeichert':
        return 'Änderungen werden gleich gespeichert …';
      case 'speichert':
        return 'Speichert …';
      case 'offline':
        return 'Offline – Änderungen sind auf diesem Gerät gesichert';
      default:
        return saveError ?? 'Nicht gespeichert';
    }
  });
</script>

<svelte:window onwheel={stopFollowing} ontouchmove={stopFollowing} />

<div class="protokoll-editor space-y-6" {onfocusin}>
  {#if loadError && !detail}
    <div class="space-y-3">
      <p class="text-sm font-semibold text-danger" role="alert"><MessageText text={loadError} /></p>
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
          class:text-success={saveState === 'gespeichert'}
          class:text-warning={saveState === 'offline' || saveState === 'ungespeichert'}
          class:text-danger={saveState === 'fehler'}
          role="status"
          aria-live="polite"
        >
          {statusText}
        </p>
      {:else}
        <p class="text-sm" role="status" aria-live="polite">
          {#if detail.status === 'review'}
            In Prüfung
          {:else if !editable}
            Freigegeben
          {:else if writerActive && sperre}
            <span class="font-semibold">{sperre.name}</span> schreibt gerade
          {/if}
        </p>
      {/if}
      {#if mode === 'schreiben'}
        <ActionButton onclick={requestStop}>Bearbeitung beenden</ActionButton>
      {:else if editable}
        <ActionButton
          variant="primary"
          disabled={starting}
          aria-busy={starting}
          onclick={() => (writerActive && sperre ? (takeover = sperre) : startWriting())}
        >
          {writerActive ? 'Bearbeitung übernehmen' : 'Bearbeiten'}
        </ActionButton>
      {/if}
      <div class="flex flex-wrap gap-2 py-2">
        {#if mode === 'lesen'}
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" bind:checked={follow} />
            Mitlesen
          </label>
        {/if}
        {#if mode === 'schreiben'}
          <ActionButton onclick={() => (ownPreview = true)}>Leseansicht</ActionButton>
        {/if}
        <ActionButton onclick={showPraesentation}>Präsentation öffnen</ActionButton>
        <ActionButton onclick={() => (versionsOpen = true)}>Versionen</ActionButton>
        {#if editable && (mode === 'schreiben' || !writerActive)}
          <ActionButton
            onclick={() => {
              submitting = 'review';
              submitError = null;
            }}
          >
            Zur Prüfung geben
          </ActionButton>
          <ActionButton
            onclick={() => {
              submitting = 'approve';
              submitError = null;
            }}
          >
            Freigeben
          </ActionButton>
        {/if}
      </div>
    </div>

    {#if mode === 'schreiben' && saveState === 'fehler' && saveError}
      <div class="border-l-2 border-danger py-1 pl-4 text-sm" role="alert">
        <p class="text-danger"><MessageText text={saveError} /></p>
        <ActionButton class="mt-2" onclick={() => void save()}>Erneut speichern</ActionButton>
      </div>
    {/if}
    {#if localWarning && mode === 'schreiben'}
      <p class="border-l-2 border-warning py-1 pl-4 text-sm text-warning">
        Ungespeicherte Änderungen gehen verloren, wenn du diese Seite schließt.
      </p>
    {/if}

    {#if localConflict}
      <div class="space-y-2 border-l-2 border-warning py-1 pl-4 text-sm">
        <p class="font-semibold text-warning">
          Auf diesem Gerät gibt es eine nicht gespeicherte Fassung vom {formatDateTime(
            localConflict.changedAt
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

    <ProtokollReview {detail} {login} onchanged={loadDetail} {notify} />

    {#if mode === 'schreiben' && stand}
      <div class="space-y-8">
        <div class="grid gap-4 sm:grid-cols-[1fr_auto]">
          <FormField
            id="protokoll-titel"
            label="Titel"
            error={stand.title.trim() ? undefined : 'Bitte einen Titel angeben.'}
          >
            {#snippet children(attrs)}
              <input
                {...attrs}
                type="text"
                class="form-input"
                maxlength="200"
                bind:value={stand!.title}
              />
            {/snippet}
          </FormField>
          <FormField
            id="protokoll-datum"
            label="Datum der Sitzung"
            error={stand.date ? undefined : 'Bitte das Datum angeben.'}
          >
            {#snippet children(attrs)}
              <input {...attrs} type="date" class="form-input" bind:value={stand!.date} />
            {/snippet}
          </FormField>
        </div>

        <details class="border-y border-neutral-200 py-2">
          <summary class="min-h-11 cursor-pointer content-center font-semibold text-brand-900"
            >Sitzungsdaten und Teilnehmende bearbeiten ({stand.inhalt.kopf.teilnehmende.length} eingetragen)</summary
          >
          <div class="py-4">
            <ProtokollKopfEditor bind:kopf={stand.inhalt.kopf} {personen} {personenUnavailable} />
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
            <!-- Not in the sticky bar: on phones every row there hides content -->
            <div class="flex items-center gap-1">
              <FilterTabs
                variant="segmented"
                label="Texte schreiben als"
                showLabel
                options={[
                  { value: 'formatiert', label: 'Formatiert' },
                  { value: 'markdown', label: 'Einfacher Text (Markdown)' },
                ]}
                value={textModus}
                onselect={(value) => void chooseTextModus(value)}
              />
              <InfoHint label="Markdown" class="markdown-hilfe">
                <p>
                  <code>**fett**</code>, <code>*kursiv*</code>, <code>~~durchgestrichen~~</code>
                </p>
                <p>
                  <code>- Punkt</code> oder <code>1. Punkt</code>, eingerückt verschachtelt;
                  <code>- [ ] offen</code>, <code>- [x] erledigt</code>
                </p>
                <p><code>[Text](https://…)</code>, Adressen werden von selbst zu Links</p>
                <p>
                  <code>## Zwischenüberschrift</code>, <code>&gt; Zitat</code>, <code>---</code> Linie
                </p>
                <p><code>| A | B |</code> mit <code>|---|---|</code> darunter für Tabellen</p>
                <p><code>`Code`</code>, drei <code>```</code> für einen Codeblock</p>
              </InfoHint>
            </div>
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
            bind:punkte={stand.inhalt.punkte}
            {personen}
            {confirmRemove}
            {textModus}
            onactive={setActive}
          />
          <div class="flex flex-wrap gap-2 border-t border-neutral-200 pt-4">
            <ActionButton onclick={addPunkt} disabled={stand.inhalt.punkte.length >= MAX_PUNKTE}>
              + Tagesordnungspunkt
            </ActionButton>
            <ActionButton
              onclick={() => (aktionOpen = true)}
              disabled={stand.inhalt.punkte.length >= MAX_PUNKTE}
            >
              + Punkt aus Aktion
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
                  bind:value={stand!.inhalt.naechsteSitzung.datum}
                />
              {/snippet}
            </FormField>
            <FormField id="naechste-uhrzeit" label="Uhrzeit" optional>
              {#snippet children(attrs)}
                <input
                  {...attrs}
                  type="time"
                  class="form-input"
                  bind:value={stand!.inhalt.naechsteSitzung.uhrzeit}
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
                  bind:value={stand!.inhalt.naechsteSitzung.ort}
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
        {changed}
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

{#if id !== null}
  <ProtokollVersionen
    open={versionsOpen}
    protokollId={id}
    canRestore={mode === 'schreiben'}
    onclose={() => (versionsOpen = false)}
    onrestore={restoreRevision}
  />
{/if}

<ProtokollAktionDialog
  open={aktionOpen}
  date={stand?.date ?? detail?.date ?? ''}
  used={usedAktionen}
  onclose={() => (aktionOpen = false)}
  onselect={addAktion}
/>

<ConfirmDialog
  open={takeover !== null}
  title="Bearbeitung übernehmen?"
  tone="neutral"
  submitLabel="Übernehmen"
  busyLabel="Wird übernommen …"
  busy={takeoverBusy}
  error={takeoverError}
  onclose={() => {
    takeover = null;
    takeoverError = null;
  }}
  onconfirm={confirmTakeover}
>
  {#if takeover}
    <p>
      <strong>{takeover.name}</strong> schreibt gerade (seit {formatTime(takeover.since)}). Wenn du
      übernimmst, kann {takeover.name} nicht mehr speichern.
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
    title={stand?.title.trim() || detail.title}
    own={login !== '' && detail.createdBy.toLowerCase() === login.toLowerCase()}
    draft
    version={detail.etag}
    consequence="Das Protokoll wird als PDF im Protokoll-Ordner abgelegt und lässt sich danach nicht mehr ändern."
    aufgaben={freigabeAufgaben(stand?.inhalt ?? detail.inhalt)}
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
  title={`Protokoll „${stand?.title.trim() || detail?.title || 'Ohne Titel'}“ löschen?`}
  busy={deleteBusy}
  error={deleteError}
  onclose={() => (deleting = false)}
  onconfirm={deleteProtokoll}
>
  <p>Das Protokoll und alle gesicherten Fassungen werden endgültig gelöscht.</p>
</ConfirmDialog>

{#if stand && mode === 'schreiben'}
  <ModalDialog open={ownPreview} title="Leseansicht" onclose={() => (ownPreview = false)}>
    <div class="px-5 py-4">
      <ProtokollAnsicht
        title={stand.title}
        date={stand.date}
        inhalt={stand.inhalt}
        idPrefix="vorschau"
      />
    </div>
  </ModalDialog>
{/if}

{#if localConflict}
  <ModalDialog
    open={localPreview}
    title="Fassung auf diesem Gerät"
    onclose={() => (localPreview = false)}
  >
    <div class="px-5 py-4">
      <ProtokollAnsicht
        title={localConflict.title}
        date={localConflict.date}
        inhalt={localConflict.inhalt}
        idPrefix="lokal"
      />
    </div>
  </ModalDialog>
{/if}

<style>
  @media print {
    .leiste {
      display: none;
    }
  }
  .leiste {
    position: relative;
    z-index: 20;
    background: var(--color-neutral-50);
    border-bottom: 1px solid var(--color-neutral-200);
  }
  :global(.markdown-hilfe code) {
    font-size: 0.8125rem;
    background: var(--color-neutral-100);
    padding: 0 0.2rem;
    border-radius: var(--radius-sm);
  }
  @media (min-width: 48rem) {
    .leiste {
      top: var(--header-height);
      position: sticky;
    }
  }
</style>
