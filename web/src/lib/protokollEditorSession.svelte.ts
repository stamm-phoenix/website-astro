/**
 * One opened set of minutes in the Protokoll editor: loading, the lock while writing, the copies
 * on this device and the live view of the presentation window. Saving lives in
 * `ProtokollSpeicherung`, reading along in `ProtokollMitlesen`. The component
 * (`ProtokollEditor.svelte`) renders this state and keeps the dialogs and the focus.
 */
import { ApiError, fetchApi, errorMessage, sendApi } from './api';
import { systemClock, type Clock } from './clock';
import {
  formatTime,
  praesentationChannel,
  type PraesentationMessage,
  type ProtokollStand,
} from './protokollEditor';
import {
  clearLocalDraft,
  copyStand,
  parkLocalDraft,
  readParkedDrafts,
  rememberWriting,
  removeParkedDraft,
  sortLocalDraft,
  tabToken,
  type LocalDraft,
} from './protokollLokal';
import { ProtokollMitlesen } from './protokollMitlesen.svelte';
import { ProtokollSperreHalten } from './protokollSperre.svelte';
import { ProtokollSpeicherung } from './protokollSpeicherung.svelte';
import type {
  ProtokollEditorDetail,
  ProtokollRevision,
  ProtokollSaveResponse,
  ProtokollSperre,
} from '../../../api/lib/protokoll-editor-model';

export type NoticeKind = 'success' | 'warning' | 'error';

export interface SessionHooks {
  notify(text: string, kind?: NoticeKind): void;
  /** Lets changes on their way reach the document before it is saved. */
  settle(): Promise<void>;
  /** Runs while the lock is taken, before the editor opens. */
  beforeStart(): Promise<void>;
  /** Shows the item the writer is at, while a reader follows along. */
  follow(punktId: string): Promise<void>;
  /** The login of the person; the copies on this device belong to it. */
  login(): string;
  /** Waits for the login, which may still be on its way. */
  loadLogin(): Promise<unknown>;
  /** Whether the page is visible; readers check for changes only then. */
  visible(): boolean;
  clock?: Clock;
}

function standOf(source: ProtokollEditorDetail | LocalDraft | ProtokollRevision): ProtokollStand {
  return copyStand({ title: source.title, date: source.date, inhalt: source.inhalt });
}

/** Whether another tab writes these minutes and its lock has not run out. */
export function writerActiveFor(loaded: ProtokollEditorDetail): boolean {
  return loaded.sperre !== null && !loaded.sperre.expired && !loaded.sperre.mine;
}

export class ProtokollEditorSession {
  id = $state<number | null>(null);
  detail = $state.raw<ProtokollEditorDetail | null>(null);
  sperre = $state.raw<ProtokollSperre | null>(null);
  loadError = $state<string | null>(null);
  mode = $state<'lesen' | 'schreiben'>('lesen');
  /** The editable copy while writing. */
  stand = $state<ProtokollStand | null>(null);
  starting = $state(false);
  /** Unsaved changes on this device, based on an older version. */
  localConflict = $state.raw<LocalDraft | null>(null);
  /** Another tab writes; set when taking the lock was refused, to ask before taking it over. */
  takeover = $state.raw<ProtokollSperre | null>(null);
  readonly speicherung: ProtokollSpeicherung;
  readonly mitlesen: ProtokollMitlesen;
  readonly sperreHalten: ProtokollSperreHalten;
  /** Token of this tab for the lock. */
  token = '';

  /** Unsaved changes on this device, based on the version on the server. */
  private pendingLocal: LocalDraft | null = null;
  private readonly hooks: SessionHooks;
  private readonly clock: Clock;
  /** Channel to the presentation window of this browser (`ProtokollPraesentation`). */
  private channel: BroadcastChannel | null = null;

  constructor(hooks: SessionHooks) {
    this.hooks = hooks;
    this.clock = hooks.clock ?? systemClock;
    this.speicherung = new ProtokollSpeicherung(this, this.clock);
    this.sperreHalten = new ProtokollSperreHalten(this, this.clock);
    this.mitlesen = new ProtokollMitlesen(this, {
      follow: hooks.follow,
      visible: hooks.visible,
      clock: this.clock,
    });
  }

  /** The item being written, for readers following along. */
  get activePunkt(): string | null {
    return this.sperreHalten.activePunkt;
  }

  /** The item that got the focus while writing. */
  setActive(next: string | null): void {
    this.sperreHalten.setActive(next);
  }

  get login(): string {
    return this.hooks.login();
  }

  notify(text: string, kind?: NoticeKind): void {
    this.hooks.notify(text, kind);
  }

  /** The token of this tab goes in a header, never in the URL (logs, history). */
  tabHeader(): Record<string, string> {
    return { 'X-Protokoll-Tab': this.token };
  }

  /** Opens the minutes; continues writing where this tab or this device left off. */
  open(id: number, wantsToWrite: boolean): void {
    this.id = id;
    this.token = tabToken(id);
    this.channel = praesentationChannel(id);
    this.channel?.addEventListener('message', (event: MessageEvent<PraesentationMessage>) => {
      if (event.data?.type === 'hallo') this.broadcast();
    });
    void (async () => {
      // Only the copy kept on this device needs the login, so the minutes do not wait for it
      const [loaded] = await Promise.all([this.loadDetail(), this.hooks.loadLogin()]);
      if (!loaded) return;
      this.checkLocal(loaded);
      const resume = loaded.sperre?.mine || wantsToWrite || this.pendingLocal !== null;
      if (loaded.status === 'entwurf' && resume && !writerActiveFor(loaded)) {
        await this.startWriting();
      }
      if (this.mode === 'lesen') this.mitlesen.start();
    })();
  }

  /** Ends everything the session runs, when the page goes. */
  close(): void {
    this.mitlesen.close();
    this.stopTimers();
    this.endBroadcast();
    this.channel?.close();
  }

  async loadDetail(): Promise<ProtokollEditorDetail | null> {
    if (this.id === null) return null;
    try {
      const loaded = await fetchApi<ProtokollEditorDetail>(
        `/intern/protokoll-editor/${this.id}`,
        undefined,
        this.tabHeader()
      );
      this.detail = loaded;
      this.sperre = loaded.sperre;
      this.loadError = null;
      return loaded;
    } catch (error: unknown) {
      this.loadError = errorMessage(
        error,
        'Das Protokoll konnte nicht geladen werden. Prüfe deine Internetverbindung und lade die Seite neu.'
      );
      return null;
    }
  }

  /** Continues with the copy on this device, or parks it to ask what to do. */
  private checkLocal(loaded: ProtokollEditorDetail): void {
    if (this.id === null || !this.login) return;
    const sorted = sortLocalDraft(this.id, this.login, loaded);
    this.pendingLocal = sorted.pending;
    this.localConflict = sorted.conflict;
  }

  // --- Writing ---

  /** Takes the lock and opens the editor; asks first if another tab writes. */
  async startWriting(uebernehmen = false): Promise<void> {
    if (this.id === null || this.starting) return;
    const id = this.id;
    this.starting = true;
    try {
      const [result] = await Promise.all([
        sendApi<ProtokollSaveResponse>('POST', `/intern/pflege/protokoll-editor/${id}/sperre`, {
          token: this.token,
          uebernehmen,
          aktiverPunkt: this.activePunkt,
        }),
        this.hooks.beforeStart(),
        // The copy kept on this device belongs to the login, which may still be on its way
        this.hooks.loadLogin(),
      ]);
      this.sperre = result.sperre;
      let loaded = this.detail;
      if (!loaded || loaded.etag !== result.etag) loaded = await this.loadDetail();
      if (!loaded) return;
      this.checkLocal(loaded);
      const fresh = standOf(loaded);
      this.stand = fresh;
      this.speicherung.begin(loaded, fresh);
      this.mode = 'schreiben';
      rememberWriting(id, true);
      this.mitlesen.stop();
      this.sperreHalten.start();
      if (this.pendingLocal) {
        this.stand = standOf(this.pendingLocal);
        this.notify(
          `Nicht gespeicherte Änderungen von ${formatTime(this.pendingLocal.changedAt)} wiederhergestellt.`
        );
        this.pendingLocal = null;
      }
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 423) {
        const loaded = await this.loadDetail();
        if (loaded?.sperre) this.takeover = loaded.sperre;
      } else {
        this.notify(
          errorMessage(
            error,
            'Die Bearbeitung wurde nicht gestartet. Tippe noch einmal auf „Bearbeiten“.'
          ),
          'error'
        );
      }
    } finally {
      this.starting = false;
    }
  }

  /** Back to reading: saves what is left and frees the lock for others. */
  async stopWriting(): Promise<boolean> {
    if (this.id === null) return false;
    const id = this.id;
    await this.hooks.settle();
    await this.speicherung.flush();
    if (this.speicherung.saveState !== 'gespeichert') {
      this.notify(
        'Noch nicht alles ist gespeichert. Die Änderungen bleiben auf diesem Gerät gesichert.',
        'warning'
      );
      return false;
    }
    this.sperreHalten.stop();
    await sendApi('DELETE', `/intern/pflege/protokoll-editor/${id}/sperre`, {
      token: this.token,
    }).catch(() => undefined);
    rememberWriting(id, false);
    // The presentation window follows the server again
    this.endBroadcast();
    this.mode = 'lesen';
    this.stand = null;
    await this.loadDetail();
    this.mitlesen.start();
    return true;
  }

  /** Another tab took over, or the minutes changed elsewhere: read on, keep the local copy. */
  async lostLock(): Promise<void> {
    if (this.id === null) return;
    const id = this.id;
    this.stopTimers();
    rememberWriting(id, false);
    // The presentation window follows the server again
    this.endBroadcast();
    this.mode = 'lesen';
    this.stand = null;
    const loaded = await this.loadDetail();
    if (loaded) this.checkLocal(loaded);
    const name = loaded?.sperre && !loaded.sperre.mine ? loaded.sperre.name : 'Jemand anderes';
    this.notify(
      this.pendingLocal || readParkedDrafts(id, this.login).length > 0
        ? `${name} hat die Bearbeitung übernommen. Deine letzten Änderungen sind auf diesem Gerät gesichert.`
        : `${name} hat die Bearbeitung übernommen.`,
      'warning'
    );
    if (this.pendingLocal) {
      // The other tab writes on this version; never continue it silently
      parkLocalDraft(id, this.pendingLocal);
      this.pendingLocal = null;
      this.localConflict = readParkedDrafts(id, this.login)[0] ?? null;
    }
    this.mitlesen.start();
  }

  /** Stops renewing the lock and the planned save. */
  stopTimers(): void {
    this.sperreHalten.stop();
    this.speicherung.cancel();
  }

  /** Back to reading after the draft was finished; the server already released the lock. */
  leave(): void {
    if (this.id === null) return;
    this.stopTimers();
    rememberWriting(this.id, false);
    this.mode = 'lesen';
    this.stand = null;
    this.endBroadcast();
  }

  /** Deletes the minutes with every saved version and forgets them on this device. */
  async delete(): Promise<void> {
    if (this.id === null) return;
    const id = this.id;
    this.stopTimers();
    await sendApi('DELETE', `/intern/pflege/protokoll-editor/${id}`);
    clearLocalDraft(id);
    rememberWriting(id, false);
    this.mode = 'lesen';
  }

  /** Frees the lock when the page goes, if nothing is left to save. */
  releaseOnPageHide(): void {
    // A clean editor frees the lock right away; with unsaved changes it runs out, and
    // reloading this tab continues writing
    if (
      this.mode === 'schreiben' &&
      this.speicherung.saveState === 'gespeichert' &&
      this.id !== null
    ) {
      void fetch(`/api/intern/pflege/protokoll-editor/${this.id}/sperre`, {
        method: 'DELETE',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.token }),
      }).catch(() => undefined);
    }
  }

  /** A plain copy of the document being written; read in an effect, it tracks every change. */
  snapshot(): ProtokollStand | null {
    return this.stand ? ($state.snapshot(this.stand) as ProtokollStand) : null;
  }

  /** Shows the current version in the presentation window of this browser right away. */
  broadcast(snapshot?: ProtokollStand): void {
    if (!this.channel || this.mode !== 'schreiben' || !this.stand) return;
    const current = snapshot ?? this.snapshot();
    if (!current) return;
    const message: PraesentationMessage = {
      type: 'stand',
      ...current,
      aktiverPunkt: this.activePunkt,
    };
    this.channel.postMessage(message);
  }

  private endBroadcast(): void {
    const message: PraesentationMessage = { type: 'ende' };
    this.channel?.postMessage(message);
  }

  // --- Local copies ---

  /** Replaces the stored version with the copy on this device; the stored one is kept. */
  async adoptLocal(onAdopting: () => void): Promise<void> {
    const local = this.localConflict;
    if (!local) return;
    if (this.mode !== 'schreiben') await this.startWriting();
    if (this.mode !== 'schreiben' || !this.stand) return;
    onAdopting();
    this.speicherung.keepVersion('ueberschreiben');
    this.stand = standOf(local);
    await this.speicherung.flush();
    if (this.speicherung.saveState === 'gespeichert' && this.id !== null) {
      removeParkedDraft(this.id, local.changedAt);
      this.localConflict = readParkedDrafts(this.id, this.login)[0] ?? null;
      this.notify('Die Fassung von diesem Gerät ist übernommen; die vorige ist gesichert.');
    }
  }

  discardLocal(): boolean {
    if (this.id === null || !this.localConflict) return false;
    removeParkedDraft(this.id, this.localConflict.changedAt);
    this.localConflict = readParkedDrafts(this.id, this.login)[0] ?? null;
    return true;
  }

  /** Writes on with an older saved version; the current one is kept as a revision. */
  restoreRevision(revision: ProtokollRevision, onRestored: () => void): boolean {
    if (this.mode !== 'schreiben' || !this.stand) return false;
    this.speicherung.keepVersion('wiederherstellen');
    this.stand = standOf(revision);
    void this.speicherung.flush().then(() => {
      if (this.speicherung.saveState === 'gespeichert') onRestored();
    });
    return true;
  }
}
