/**
 * Reading along in the Protokoll editor: while another tab writes, the reader checks for changes,
 * marks the changed items for a moment and follows the item being written.
 */
import { fetchApi } from './api';
import { systemClock, type Clock } from './clock';
import { changedPunkte } from './protokollEditor';
import { POLL_MS } from './protokollSpeichern';
import type {
  ProtokollEditorDetail,
  ProtokollLiveResponse,
  ProtokollSperre,
} from '../../../api/lib/protokoll-editor-model';

/** The part of the session that reading along looks at and updates. */
export interface MitleseQuelle {
  readonly id: number | null;
  readonly mode: 'lesen' | 'schreiben';
  detail: ProtokollEditorDetail | null;
  sperre: ProtokollSperre | null;
  tabHeader(): Record<string, string>;
}

export interface MitleseOptions {
  /** Shows the item the writer is at. */
  follow(punktId: string): Promise<void>;
  /** Whether the page is visible; hidden pages do not check. */
  visible(): boolean;
  clock?: Clock;
}

/** Nothing marked; replaced as a whole, never changed in place. */
const NONE: ReadonlySet<string> = new Set();

export class ProtokollMitlesen {
  /** Items changed by the last check, marked for a moment. */
  changed = $state.raw<ReadonlySet<string>>(NONE);
  /** Whether the view follows the item being written; scrolling by hand ends it. */
  follow = $state(true);

  private readonly quelle: MitleseQuelle;
  private readonly options: MitleseOptions;
  private readonly clock: Clock;
  private stopPolling: (() => void) | null = null;
  private cancelChanged: (() => void) | null = null;

  constructor(quelle: MitleseQuelle, options: MitleseOptions) {
    this.quelle = quelle;
    this.options = options;
    this.clock = options.clock ?? systemClock;
  }

  start(): void {
    this.stop();
    this.stopPolling = this.clock.every(() => {
      if (this.options.visible()) void this.poll();
    }, POLL_MS);
  }

  stop(): void {
    this.stopPolling?.();
    this.stopPolling = null;
  }

  /** Stops checking and the marking of changes, when the page goes. */
  close(): void {
    this.stop();
    this.cancelChanged?.();
    this.cancelChanged = null;
  }

  /** Scrolling by hand ends following the writer. */
  stopFollowing(): void {
    if (this.quelle.mode === 'lesen' && this.follow) this.follow = false;
  }

  async poll(): Promise<void> {
    const { id, detail } = this.quelle;
    if (id === null || !detail || this.quelle.mode !== 'lesen') return;
    try {
      const live = await fetchApi<ProtokollLiveResponse>(
        `/intern/protokoll-editor/${id}/live?etag=${encodeURIComponent(detail.etag)}`,
        undefined,
        this.quelle.tabHeader()
      );
      if (this.quelle.mode !== 'lesen') return;
      const previousActive = this.quelle.sperre?.aktiverPunkt ?? null;
      this.quelle.sperre = live.sperre;
      const shown = this.quelle.detail;
      if (live.protokoll && shown) {
        this.changed = changedPunkte(shown.inhalt, live.protokoll.inhalt);
        this.quelle.detail = live.protokoll;
        this.cancelChanged?.();
        this.cancelChanged = this.clock.later(() => (this.changed = NONE), 2000);
      }
      const active = live.sperre && !live.sperre.expired ? live.sperre.aktiverPunkt : null;
      if (this.follow && active && (active !== previousActive || live.protokoll)) {
        await this.options.follow(active);
      }
    } catch {
      // The next check tries again
    }
  }
}
