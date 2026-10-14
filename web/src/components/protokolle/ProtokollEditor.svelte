<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import ProtokollAktionDialog from './ProtokollAktionDialog.svelte';
  import ProtokollAnsicht from './ProtokollAnsicht.svelte';
  import ProtokollKopfEditor from './ProtokollKopfEditor.svelte';
  import ProtokollPunktEditor from './ProtokollPunktEditor.svelte';
  import ProtokollVersionen from './ProtokollVersionen.svelte';
  import FormField from '../pflege/FormField.svelte';
  import StatusNotice from '../pflege/StatusNotice.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';
  import ModalDialog from '../ui/ModalDialog.svelte';
  import { ApiError, fetchApi, sendApi } from '../../lib/api';
  import { authStore, fetchPrincipal } from '../../lib/authStore.svelte';
  import {
    MAX_PUNKTE,
    SPERRE_RENEW_SECONDS,
    clearLocalDraft,
    copyStand,
    formatDateTime,
    formatTime,
    neuerPunkt,
    newElementId,
    parkLocalDraft,
    readLocalDraft,
    readParkedDrafts,
    rememberWriting,
    removeParkedDraft,
    sameStand,
    tabToken,
    wasWriting,
    writeLocalDraft,
  } from '../../lib/protokollEditor';
  import type { LocalDraft, ProtokollStand } from '../../lib/protokollEditor';
  import { guardUnsavedChanges } from '../../lib/unsavedChanges';
  import type {
    ProtokollAktion,
    ProtokollEditorDetail,
    ProtokollEditorPersonen,
    ProtokollLiveResponse,
    ProtokollPerson,
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

  let personen = $state.raw<ProtokollPerson[]>([]);
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
  let starting = $state(false);

  // --- Local copies ---
  /** Unsaved changes on this device, based on the version on the server. */
  let pendingLocal: LocalDraft | null = null;
  /** Unsaved changes on this device, based on an older version. */
  let localConflict = $state.raw<LocalDraft | null>(null);
  let localPreview = $state(false);
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
  let versionsOpen = $state(false);
  let aktionOpen = $state(false);
  let deleting = $state(false);
  let deleteBusy = $state(false);
  let deleteError = $state<string | null>(null);
  let praesentation = $state(false);
  let root = $state<HTMLElement | null>(null);

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

  function errorText(error: unknown, fallback: string): string {
    return error instanceof ApiError ? error.message : fallback;
  }

  function standOf(source: ProtokollEditorDetail | LocalDraft | ProtokollRevision): ProtokollStand {
    return copyStand({ title: source.title, date: source.date, inhalt: source.inhalt });
  }

  async function loadDetail(): Promise<ProtokollEditorDetail | null> {
    if (id === null) return null;
    try {
      const loaded = await fetchApi<ProtokollEditorDetail>(
        `/intern/protokoll-editor/${id}?token=${encodeURIComponent(token)}`
      );
      detail = loaded;
      sperre = loaded.sperre;
      loadError = null;
      return loaded;
    } catch (error: unknown) {
      loadError = errorText(error, 'Das Protokoll konnte nicht geladen werden.');
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
      const result = await sendApi<ProtokollSaveResponse>(
        'POST',
        `/intern/pflege/protokoll-editor/${id}/sperre`,
        { token, uebernehmen, aktiverPunkt: activePunkt }
      );
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
        notify(errorText(error, 'Die Bearbeitung konnte nicht gestartet werden.'), 'error');
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
    else takeoverError = 'Die Bearbeitung konnte nicht übernommen werden.';
  }

  /** Back to reading: saves what is left and frees the lock for others. */
  async function stopWriting(): Promise<void> {
    if (id === null) return;
    await flushSave();
    if (saveState !== 'gespeichert') {
      notify(
        'Noch nicht alles ist gespeichert. Die Änderungen bleiben auf diesem Gerät gesichert.',
        'warning'
      );
      return;
    }
    stopRenewing();
    await sendApi('DELETE', `/intern/pflege/protokoll-editor/${id}/sperre`, { token }).catch(
      () => undefined
    );
    rememberWriting(id, false);
    mode = 'lesen';
    stand = null;
    await loadDetail();
    startPolling();
  }

  /** Another tab took over, or the minutes changed elsewhere: read on, keep the local copy. */
  async function lostLock(): Promise<void> {
    if (id === null) return;
    stopRenewing();
    clearTimeout(saveTimer);
    rememberWriting(id, false);
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
  function onfocusin(event: FocusEvent): void {
    const element = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-punkt]');
    const next = element?.dataset.punkt ?? null;
    if (!next || next === activePunkt) return;
    activePunkt = next;
    clearTimeout(activeTimer);
    activeTimer = setTimeout(() => void renew(), 600);
  }

  /** Called on every change of `stand`: keeps a local copy and schedules the save. */
  function onEdited(json: string): void {
    if (id === null || !stand) return;
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

  async function focusPunkt(punktId: string, field: 'titel' | 'text'): Promise<void> {
    await tick();
    document.getElementById(`${field}-${punktId}`)?.focus();
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

  function movePunkt(at: number, delta: -1 | 1): void {
    if (!stand) return;
    const punkte = stand.inhalt.punkte;
    const target = at + delta;
    if (target < 0 || target >= punkte.length) return;
    const [item] = punkte.splice(at, 1);
    punkte.splice(target, 0, item);
  }

  function hasContent(punkt: ProtokollPunkt): boolean {
    return Boolean(
      punkt.text.trim() ||
      punkt.aufgaben.length > 0 ||
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

  /** IDs of the agenda items whose content differs between two versions. */
  function changedItems(before: ProtokollEditorDetail, after: ProtokollEditorDetail): Set<string> {
    const old = new Map(
      before.inhalt.punkte.flatMap((p) => [p, ...p.unterpunkte]).map((p) => [p.id, p])
    );
    // A new set per check, assigned whole to the state; never changed afterwards
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const result = new Set<string>();
    for (const punkt of after.inhalt.punkte.flatMap((p) => [p, ...p.unterpunkte])) {
      const previous = old.get(punkt.id);
      const own = (p: ProtokollPunkt) =>
        JSON.stringify({ t: p.titel, x: p.text, a: p.aufgaben, k: p.aktion });
      if (!previous || own(previous) !== own(punkt)) result.add(punkt.id);
    }
    return result;
  }

  async function poll(): Promise<void> {
    if (id === null || !detail || mode !== 'lesen') return;
    try {
      const live = await fetchApi<ProtokollLiveResponse>(
        `/intern/protokoll-editor/${id}/live?etag=${encodeURIComponent(detail.etag)}&token=${encodeURIComponent(token)}`
      );
      if (mode !== 'lesen') return;
      const previousActive = sperre?.aktiverPunkt ?? null;
      sperre = live.sperre;
      if (live.protokoll && detail) {
        changed = changedItems(detail, live.protokoll);
        detail = live.protokoll;
        clearTimeout(changedTimer);
        changedTimer = setTimeout(() => (changed = new Set()), 2000);
      }
      const active = live.sperre && !live.sperre.expired ? live.sperre.aktiverPunkt : null;
      if (follow && active && (active !== previousActive || live.protokoll)) {
        await tick();
        document
          .getElementById(`ansicht-${active}`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    } catch {
      // The next check tries again
    }
  }

  /** Scrolling by hand ends following the writer. */
  function stopFollowing(): void {
    if (mode === 'lesen' && follow) follow = false;
  }

  // --- Presentation ---

  async function togglePraesentation(): Promise<void> {
    praesentation = !praesentation;
    try {
      if (praesentation && root && !document.fullscreenElement) await root.requestFullscreen();
      else if (!praesentation && document.fullscreenElement) await document.exitFullscreen();
    } catch {
      // Without fullscreen the larger text still applies
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
      window.location.href = '/leitendenbereich/protokolle';
    } catch (error: unknown) {
      deleteError = errorText(error, 'Das Protokoll konnte nicht gelöscht werden.');
      deleteBusy = false;
    }
  }

  onMount(() => {
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
      await fetchPrincipal();
      void loadPersonen();
      const loaded = await loadDetail();
      if (!loaded) return;
      checkLocal(loaded);
      const resume = loaded.sperre?.mine || wantsToWrite || pendingLocal !== null;
      if (loaded.status === 'entwurf' && resume && !writerActiveFor(loaded)) {
        await startWriting();
      }
      if (mode === 'lesen') startPolling();
    })();

    const unguard = guardUnsavedChanges(() => mode === 'schreiben' && saveState !== 'gespeichert');
    const onFullscreen = (): void => {
      if (!document.fullscreenElement) praesentation = false;
    };
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
    document.addEventListener('fullscreenchange', onFullscreen);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      unguard();
      stopPolling();
      stopRenewing();
      clearTimeout(saveTimer);
      clearTimeout(changedTimer);
      document.removeEventListener('fullscreenchange', onFullscreen);
      window.removeEventListener('pagehide', onPageHide);
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

<div
  bind:this={root}
  class="protokoll-editor space-y-6"
  class:is-praesentation={praesentation}
  {onfocusin}
>
  {#if loadError && !detail}
    <div class="space-y-3">
      <p class="text-sm font-semibold text-danger" role="alert">{loadError}</p>
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
    <div class="leiste flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
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
          {#if !editable}
            Dieses Protokoll ist nicht mehr im Entwurf.
          {:else if writerActive && sperre}
            <span class="font-semibold">{sperre.name}</span> schreibt gerade · Änderungen erscheinen hier
            nach wenigen Sekunden.
          {:else}
            Gerade schreibt niemand.
          {/if}
        </p>
      {/if}
      <div class="flex flex-wrap gap-2">
        {#if mode === 'lesen'}
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" bind:checked={follow} />
            Mitlaufen
          </label>
        {/if}
        <ActionButton onclick={togglePraesentation} aria-pressed={praesentation}>
          {praesentation ? 'Präsentation beenden' : 'Präsentation'}
        </ActionButton>
        <ActionButton onclick={() => (versionsOpen = true)}>Versionen</ActionButton>
        {#if mode === 'schreiben'}
          <ActionButton onclick={stopWriting}>Bearbeitung beenden</ActionButton>
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
      </div>
    </div>

    {#if mode === 'schreiben' && saveState === 'fehler' && saveError}
      <div class="border-l-2 border-danger py-1 pl-4 text-sm" role="alert">
        <p class="text-danger">{saveError}</p>
        <ActionButton class="mt-2" onclick={() => void save()}>Erneut speichern</ActionButton>
      </div>
    {/if}
    {#if localWarning && mode === 'schreiben'}
      <p class="border-l-2 border-warning py-1 pl-4 text-sm text-warning">
        Dieser Browser kann keine Sicherung auf dem Gerät anlegen (Speicher voll oder gesperrt).
        Gespeichert wird trotzdem, solange die Verbindung steht.
      </p>
    {/if}

    {#if localConflict}
      <div class="space-y-2 border-l-2 border-warning py-1 pl-4 text-sm">
        <p class="font-semibold text-warning">
          Auf diesem Gerät gibt es eine nicht gespeicherte Fassung vom {formatDateTime(
            localConflict.changedAt
          )}.
        </p>
        <p class="text-neutral-800">
          Das Protokoll wurde inzwischen anders gespeichert. Du kannst deine Fassung ansehen, sie
          übernehmen (die jetzige bleibt als Version gesichert) oder verwerfen.
        </p>
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

        <ProtokollKopfEditor bind:kopf={stand.inhalt.kopf} {personen} {personenUnavailable} />

        <section class="space-y-6" aria-labelledby="tagesordnung-titel">
          <h2 id="tagesordnung-titel" class="font-serif text-xl text-brand-900">Tagesordnung</h2>
          {#each stand.inhalt.punkte as punkt, at (punkt.id)}
            <div class="border-t border-neutral-200 pt-4">
              <ProtokollPunktEditor
                bind:punkt={stand.inhalt.punkte[at]}
                index={at}
                count={stand.inhalt.punkte.length}
                {personen}
                onmove={(delta) => movePunkt(at, delta)}
                onremove={() =>
                  stand &&
                  confirmRemove(stand.inhalt.punkte[at], `${at + 1}.`, () =>
                    stand?.inhalt.punkte.splice(at, 1)
                  )}
                {confirmRemove}
              />
            </div>
          {/each}
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
    <p class="text-sm text-neutral-700">
      Die Fassung bis jetzt wird gesichert. Was dort noch nicht gespeichert war, bleibt auf dem
      anderen Gerät erhalten.
    </p>
  {/if}
</ConfirmDialog>

<ConfirmDialog
  open={removing !== null}
  title="Tagesordnungspunkt löschen?"
  onclose={() => (removing = null)}
  onconfirm={() => {
    removing?.remove();
    removing = null;
  }}
>
  {#if removing}
    <p>
      Punkt {removing.nummer} „{removing.titel}“ hat Inhalt. Er wird mit Text, Aufgaben und
      Unterpunkten gelöscht. Frühere Fassungen bleiben unter „Versionen“ erhalten.
    </p>
  {/if}
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
  open={deleting}
  title="Protokoll löschen?"
  busy={deleteBusy}
  error={deleteError}
  onclose={() => (deleting = false)}
  onconfirm={deleteProtokoll}
>
  <p>Das Protokoll und alle gesicherten Fassungen werden endgültig gelöscht.</p>
</ConfirmDialog>

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
  .leiste {
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--color-neutral-50);
    border-bottom: 1px solid var(--color-neutral-200);
  }
  .protokoll-editor.is-praesentation {
    background: var(--color-neutral-50);
    font-size: 1.25rem;
    overflow-y: auto;
    padding: 1.5rem 2rem 4rem;
  }
  .protokoll-editor.is-praesentation :global(.text-sm) {
    font-size: 1.05rem;
  }
  .protokoll-editor.is-praesentation :global(.form-input) {
    font-size: 1.25rem;
  }
  .protokoll-editor.is-praesentation :global(h2) {
    font-size: 1.9rem;
  }
  .protokoll-editor.is-praesentation :global(h3) {
    font-size: 1.5rem;
  }
</style>
