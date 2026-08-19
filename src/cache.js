class SimpleCache {
  constructor(ttlMs = 60000) {
    this.store = new Map();
    this.ttl = ttlMs;
  }
  get(key) {
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() - item.ts > this.ttl) { this.store.delete(key); return null; }
    return item.data;
  }
  set(key, data) {
    this.store.set(key, { data, ts: Date.now() });
    // Limpar cache velhos periodicamente
    if (this.store.size > 500) {
      const now = Date.now();
      for (const [k, v] of this.store) {
        if (now - v.ts > this.ttl) this.store.delete(k);
      }
    }
  }
  clear() { this.store.clear(); }
}

const cache = new SimpleCache(60000); // 1 min
module.exports = cache;
