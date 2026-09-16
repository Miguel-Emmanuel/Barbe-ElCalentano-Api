type Entry<T> = { value: T; expiresAt: number };

/** In-memory TTL cache (Fase 5 local without Redis). */
export class TtlCache<T> {
  private store = new Map<string, Entry<T>>();

  constructor(private defaultTtlMs = 30_000) {}

  get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T, ttlMs = this.defaultTtlMs) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  invalidatePrefix(prefix: string) {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  clear() {
    this.store.clear();
  }
}

export const availabilityCache = new TtlCache<unknown>(20_000);
