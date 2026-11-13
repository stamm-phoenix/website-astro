/** A `Clock` that unit tests move by hand, so timers of minutes or seconds run at once. */
import type { Clock } from '../../src/lib/clock';

interface Timer {
  id: number;
  at: number;
  every: number | null;
  callback: () => void;
}

/** Lets pending promises and answers of a stubbed `fetch` settle. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

export class FakeClock implements Clock {
  time = 1_800_000_000_000;
  private timers: Timer[] = [];
  private nextId = 0;

  now(): number {
    return this.time;
  }

  later(callback: () => void, ms: number): () => void {
    return this.add(callback, ms, null);
  }

  every(callback: () => void, ms: number): () => void {
    return this.add(callback, ms, ms);
  }

  /** Delays of the timers still waiting, counted from now. */
  pending(): number[] {
    return this.timers.map((timer) => timer.at - this.time).sort((a, b) => a - b);
  }

  /** Moves time forward, fires the timers due on the way in order and lets their work settle. */
  async advance(ms: number): Promise<void> {
    const end = this.time + ms;
    for (;;) {
      await settle();
      const due = this.timers
        .filter((timer) => timer.at <= end)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.time = due.at;
      if (due.every === null) this.timers = this.timers.filter((timer) => timer !== due);
      else due.at += due.every;
      due.callback();
    }
    this.time = end;
    await settle();
  }

  private add(callback: () => void, ms: number, every: number | null): () => void {
    const timer: Timer = { id: this.nextId++, at: this.time + ms, every, callback };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((other) => other !== timer);
    };
  }
}

/** A `Storage` in memory, for code that keeps things in `localStorage` or `sessionStorage`. */
export function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}
