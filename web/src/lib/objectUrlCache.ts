/**
 * Object URLs of loaded pictures, so a list that reloads does not load them again. It keeps one
 * version per item: a newer version frees the URL of the older one once it has loaded, and the
 * items used longest ago go when there are more than `limit`.
 */

interface Entry {
  version: string;
  url: Promise<string>;
}

export interface ObjectUrlCacheOptions {
  limit?: number;
  create?: (blob: Blob) => string;
  revoke?: (url: string) => void;
}

export class ObjectUrlCache {
  private readonly entries = new Map<string, Entry>();
  private readonly limit: number;
  private readonly create: (blob: Blob) => string;
  private readonly revoke: (url: string) => void;

  constructor(options: ObjectUrlCacheOptions = {}) {
    this.limit = options.limit ?? 100;
    this.create = options.create ?? ((blob) => URL.createObjectURL(blob));
    this.revoke = options.revoke ?? ((url) => URL.revokeObjectURL(url));
  }

  /** The URL of this version of the item, loaded with `load` unless it is already there. */
  get(id: string, version: string, load: () => Promise<Blob>): Promise<string> {
    const previous = this.entries.get(id);
    // Map keeps the order of insertion: the item used last moves to the end
    this.entries.delete(id);
    if (previous && previous.version === version) {
      this.entries.set(id, previous);
      return previous.url;
    }
    const entry: Entry = { version, url: load().then((blob) => this.create(blob)) };
    this.entries.set(id, entry);
    // A failed load is tried again the next time
    entry.url.catch(() => {
      if (this.entries.get(id) === entry) this.entries.delete(id);
    });
    // The older picture stays until the newer one is there, so the row never shows a gap
    if (previous) void entry.url.catch(() => undefined).then(() => this.release(previous));
    while (this.entries.size > this.limit) {
      const [oldest, dropped] = this.entries.entries().next().value as [string, Entry];
      this.entries.delete(oldest);
      this.release(dropped);
    }
    return entry.url;
  }

  /** Number of items kept. */
  get size(): number {
    return this.entries.size;
  }

  private release(entry: Entry): void {
    entry.url.then(this.revoke, () => undefined);
  }
}
