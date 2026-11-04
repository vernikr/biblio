/** Process-local cache lifetime for repeat provider work. */
export const PROVIDER_CACHE_TTL_MS = 45_000;

interface Entry<Value> {
  /** null means the loader is still in flight and should be shared. */
  expiresAt: number | null;
  value: Promise<Value>;
}

/** Small bounded TTL cache that shares in-flight work. A thrown load is never
 *  stored; a load that resolves to a failure value is stored like any value. */
export class AsyncTtlCache<Key, Value> {
  private readonly entries = new Map<Key, Entry<Value>>();

  constructor(
    private readonly ttlMs = PROVIDER_CACHE_TTL_MS,
    private readonly maxEntries = 128
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new RangeError("ttlMs must be a positive finite number");
    }
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError("maxEntries must be a positive integer");
    }
  }

  getOrLoad(key: Key, load: () => Value | Promise<Value>): Promise<Value> {
    const now = Date.now();
    const existing = this.entries.get(key);
    if (existing && (existing.expiresAt === null || existing.expiresAt > now)) {
      // Map insertion order is the LRU order; touch a valid hit.
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing.value;
    }
    if (existing) this.entries.delete(key);

    let entry: Entry<Value>;
    const value = Promise.resolve()
      .then(load)
      .then(
        (result) => {
          if (this.entries.get(key) === entry) entry.expiresAt = Date.now() + this.ttlMs;
          return result;
        },
        (error: unknown) => {
          if (this.entries.get(key) === entry) this.entries.delete(key);
          throw error;
        }
      );
    entry = { expiresAt: null, value };
    this.entries.set(key, entry);
    this.evictOldest();
    return value;
  }

  private evictOldest(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      this.entries.delete(oldest.value);
    }
  }
}
