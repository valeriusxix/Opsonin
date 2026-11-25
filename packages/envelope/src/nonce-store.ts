/** Single-use nonce store with TTL. `checkAndInsert` is atomic in a single-threaded runtime. */
export interface NonceStore {
  /** Returns true if the nonce was unseen (and records it until `expiresAt`), false if it is a replay. */
  checkAndInsert(issuer: string, nonce: string, expiresAt: number, now: number): boolean;
}

export class MemoryNonceStore implements NonceStore {
  private seen = new Map<string, number>();
  constructor(private readonly maxEntries = 100_000) {}

  checkAndInsert(issuer: string, nonce: string, expiresAt: number, now: number): boolean {
    if (this.seen.size > this.maxEntries / 2) this.prune(now);
    const k = issuer + "\u0000" + nonce;
    const exp = this.seen.get(k);
    if (exp !== undefined && exp >= now) return false;
    if (this.seen.size >= this.maxEntries) return false; // fail closed when full
    this.seen.set(k, expiresAt);
    return true;
  }

  prune(now: number) {
    for (const [k, exp] of this.seen) if (exp < now) this.seen.delete(k);
  }

  get size() {
    return this.seen.size;
  }
}
