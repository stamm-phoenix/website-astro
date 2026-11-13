/**
 * Automatic saving while writing minutes: every change goes to the copy on this device and is
 * saved to the server shortly after; the status bar shows how far it got. Timing comes from
 * `Autosave`, the decisions after a failure from `classifySaveError`.
 */
import { sendApi } from './api';
import { Autosave, type SaveStart } from './autosave';
import type { Clock } from './clock';
import type { ProtokollStand } from './protokollEditor';
import { clearLocalDraft, writeLocalDraft } from './protokollLokal';
import { classifySaveError, saveStatusText, type SaveState } from './protokollSpeichern';
import type { NoticeKind } from './protokollEditorSession.svelte';
import type {
  ProtokollEditorDetail,
  ProtokollSaveResponse,
  ProtokollSperre,
} from '../../../api/lib/protokoll-editor-model';

/** Why the next save keeps the version on the server as a revision. */
export type Sicherung = 'ueberschreiben' | 'wiederherstellen';

/** The part of the session that saving reads and updates. */
export interface SpeicherQuelle {
  readonly id: number | null;
  readonly mode: 'lesen' | 'schreiben';
  readonly stand: ProtokollStand | null;
  readonly activePunkt: string | null;
  readonly token: string;
  readonly login: string;
  sperre: ProtokollSperre | null;
  /** A plain copy of `stand`. */
  snapshot(): ProtokollStand | null;
  /** Shows the version in the presentation window. */
  broadcast(snapshot: ProtokollStand): void;
  /** Another tab took over or the minutes changed elsewhere: back to reading. */
  lostLock(): Promise<void>;
  notify(text: string, kind?: NoticeKind): void;
}

export class ProtokollSpeicherung {
  saveState = $state<SaveState>('gespeichert');
  saveError = $state<string | null>(null);
  lastSavedAt = $state<string | null>(null);
  /** The browser refused to keep the copy on this device. */
  localWarning = $state(false);
  readonly statusText = $derived(saveStatusText(this.saveState, this.lastSavedAt, this.saveError));

  /** Version on the server that `stand` is based on. */
  etag = '';
  /** `stand` as last confirmed by the server. */
  private savedJson = '';
  /** Counts the changes of `stand`, to tell whether one came during a save. */
  private edits = 0;
  private sicherung: Sicherung | null = null;
  private readonly quelle: SpeicherQuelle;
  private readonly autosave: Autosave;
  private readonly clock: Clock;

  constructor(quelle: SpeicherQuelle, clock: Clock) {
    this.quelle = quelle;
    this.clock = clock;
    this.autosave = new Autosave({
      active: () => quelle.id !== null && quelle.stand !== null && quelle.mode === 'schreiben',
      run: () => this.runSave(),
      clock,
    });
  }

  /** The editor opens on `loaded`, which `stand` was just copied from. */
  begin(loaded: ProtokollEditorDetail, stand: ProtokollStand): void {
    this.etag = loaded.etag;
    this.savedJson = JSON.stringify(stand);
    this.lastSavedAt = loaded.updatedAt;
    this.saveState = 'gespeichert';
    this.saveError = null;
  }

  /** The next save keeps the version on the server, because `stand` replaces it as a whole. */
  keepVersion(reason: Sicherung): void {
    this.sicherung = reason;
  }

  /** Called on every change of `stand`: keeps a local copy and schedules the save. */
  edited(snapshot: ProtokollStand): void {
    const id = this.quelle.id;
    if (id === null || !this.quelle.stand) return;
    this.edits++;
    this.quelle.broadcast(snapshot);
    const json = JSON.stringify(snapshot);
    if (json === this.savedJson) {
      if (this.saveState === 'ungespeichert') this.saveState = 'gespeichert';
      clearLocalDraft(id);
      return;
    }
    if (this.saveState === 'gespeichert' || this.saveState === 'fehler') {
      this.saveState = 'ungespeichert';
    }
    const stored = writeLocalDraft(id, json, {
      baseEtag: this.etag,
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- only turned into text
      changedAt: new Date(this.clock.now()).toISOString(),
      login: this.quelle.login,
    });
    this.localWarning = !stored;
    this.autosave.schedule();
  }

  /** Saves now, e.g. for „Erneut speichern“. */
  save(): Promise<void> {
    return this.autosave.save();
  }

  /** Saves right away and waits for it, e.g. before leaving the editor. */
  flush(): Promise<void> {
    return this.autosave.flush();
  }

  /** Drops the planned save, e.g. when writing ends; a request on its way goes on. */
  cancel(): void {
    this.autosave.cancel();
  }

  private runSave(): SaveStart {
    const snapshot = this.quelle.snapshot();
    if (!snapshot) return 'unchanged';
    const json = JSON.stringify(snapshot);
    if (json === this.savedJson && !this.sicherung) {
      this.saveState = 'gespeichert';
      return 'unchanged';
    }
    if (!snapshot.title.trim() || !snapshot.date) {
      this.saveState = 'fehler';
      this.saveError = 'Bitte Titel und Datum angeben, dann wird wieder gespeichert.';
      return 'invalid';
    }
    if (this.saveState !== 'offline') this.saveState = 'speichert';
    return this.send(snapshot, json);
  }

  private async send(snapshot: ProtokollStand, json: string): Promise<void> {
    const id = this.quelle.id;
    if (id === null) return;
    const edits = this.edits;
    try {
      const result = await sendApi<ProtokollSaveResponse>(
        'PUT',
        `/intern/pflege/protokoll-editor/${id}`,
        {
          token: this.quelle.token,
          etag: this.etag,
          ...snapshot,
          aktiverPunkt: this.quelle.activePunkt,
          sicherung: this.sicherung,
        }
      );
      this.sicherung = null;
      this.etag = result.etag;
      this.savedJson = json;
      this.quelle.sperre = result.sperre;
      this.lastSavedAt = result.updatedAt;
      this.saveError = null;
      this.autosave.succeeded();
      if (this.quelle.stand && this.edits === edits) {
        clearLocalDraft(id);
        this.saveState = 'gespeichert';
      } else {
        // Typed on during the save; the local copy is now based on the new version
        this.saveState = 'ungespeichert';
        const current = this.quelle.snapshot();
        if (current) this.edited(current);
      }
    } catch (error: unknown) {
      await this.handleSaveError(error);
    }
  }

  private async handleSaveError(error: unknown): Promise<void> {
    const failure = classifySaveError(error);
    switch (failure.kind) {
      case 'retry':
        // Offline or a hiccup of the server: keep trying; the changes are on this device
        this.saveState = 'offline';
        this.autosave.retryLater();
        return;
      case 'lostLock':
        await this.quelle.lostLock();
        return;
      case 'notEditable':
        await this.quelle.lostLock();
        this.quelle.notify(failure.message, 'warning');
        return;
      case 'fatal':
        this.saveState = 'fehler';
        this.saveError = failure.message;
    }
  }
}
