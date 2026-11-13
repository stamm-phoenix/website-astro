/**
 * Holding the lock while writing minutes: it is renewed in time, carries the item being written
 * for readers following along, and a refused renewal means another tab took over.
 */
import { ApiError, sendApi } from './api';
import type { Clock } from './clock';
import { SPERRE_RENEW_SECONDS } from './protokollEditor';
import type {
  ProtokollSaveResponse,
  ProtokollSperre,
} from '../../../api/lib/protokoll-editor-model';

/** The part of the session that holding the lock reads and updates. */
export interface SperreQuelle {
  readonly id: number | null;
  readonly mode: 'lesen' | 'schreiben';
  readonly token: string;
  sperre: ProtokollSperre | null;
  /** Another tab took over or the minutes changed elsewhere: back to reading. */
  lostLock(): Promise<void>;
  /** Shows the current version, with the active item, in the presentation window. */
  broadcast(): void;
}

export class ProtokollSperreHalten {
  /** The item being written. */
  activePunkt = $state<string | null>(null);

  private readonly quelle: SperreQuelle;
  private readonly clock: Clock;
  private stopRenewTimer: (() => void) | null = null;
  private cancelActiveTimer: (() => void) | null = null;

  constructor(quelle: SperreQuelle, clock: Clock) {
    this.quelle = quelle;
    this.clock = clock;
  }

  start(): void {
    this.stop();
    this.stopRenewTimer = this.clock.every(() => void this.renew(), SPERRE_RENEW_SECONDS * 1000);
  }

  stop(): void {
    this.stopRenewTimer?.();
    this.stopRenewTimer = null;
    this.cancelActiveTimer?.();
    this.cancelActiveTimer = null;
  }

  async renew(): Promise<void> {
    const { id } = this.quelle;
    if (id === null || this.quelle.mode !== 'schreiben') return;
    try {
      const result = await sendApi<ProtokollSaveResponse>(
        'POST',
        `/intern/pflege/protokoll-editor/${id}/sperre`,
        { token: this.quelle.token, aktiverPunkt: this.activePunkt }
      );
      this.quelle.sperre = result.sperre;
    } catch (error: unknown) {
      if (error instanceof ApiError && (error.status === 423 || error.status === 409)) {
        await this.quelle.lostLock();
      }
      // Network errors: the save status says so; the next renewal tries again
    }
  }

  /** The item being written, for readers following along; sent shortly after it changes. */
  setActive(next: string | null): void {
    if (!next || next === this.activePunkt) return;
    this.activePunkt = next;
    this.cancelActiveTimer?.();
    this.cancelActiveTimer = this.clock.later(() => void this.renew(), 600);
    this.quelle.broadcast();
  }
}
