/**
 * Client-side mirror of the contract's sentinel rate cap ("authority budget") plus a batcher.
 * The contract is the real enforcement; this keeps the sentinel from sending txs that would revert
 * (reverted txs still burn an EVM-window slot and budget).
 */
export type AuthorityConfig = {
  /** Max robots the sentinel may quarantine per window (mirror of maxQuarantinePerEpochWindow). */
  cap: number;
  /** Window length in seconds (contract uses blocks; ~1.03 s/block on testnet). */
  windowSec: number;
  /** Batch flush interval in seconds. */
  batchSec: number;
};

export const DEFAULT_AUTHORITY: AuthorityConfig = { cap: 20, windowSec: 60, batchSec: 2 };

export type Batch = { ids: number[]; t: number };

export class Authority {
  private used: Array<{ t: number; count: number }> = [];
  private queue: number[] = [];
  private queued = new Set<number>();
  private lastFlush = -Infinity;
  /** Robots the cap refused; they wait for the owner to escalate (owner may quarantine beyond the cap). */
  readonly overCap = new Set<number>();
  private overCapSince = -1;

  constructor(private readonly cfg: AuthorityConfig = DEFAULT_AUTHORITY) {}

  remaining(nowSec: number): number {
    this.used = this.used.filter((u) => nowSec - u.t < this.cfg.windowSec);
    return this.cfg.cap - this.used.reduce((a, u) => a + u.count, 0);
  }

  propose(robot: number) {
    if (!this.queued.has(robot)) {
      this.queued.add(robot);
      this.queue.push(robot);
    }
  }

  /** Returns a batch when the flush interval elapsed and budget allows; never exceeds the cap. */
  flush(nowSec: number): Batch | null {
    if (this.queue.length === 0 || nowSec - this.lastFlush < this.cfg.batchSec) return null;
    this.lastFlush = nowSec;
    const room = Math.max(0, this.remaining(nowSec));
    const ids = this.queue.splice(0, room);
    for (const id of this.queue) this.overCap.add(id);
    if (this.queue.length && this.overCapSince < 0) this.overCapSince = nowSec;
    for (const id of ids) this.queued.delete(id);
    if (ids.length === 0) return null;
    this.used.push({ t: nowSec, count: ids.length });
    return { ids, t: nowSec };
  }

  /** Seconds the oldest over-cap robot has been waiting, or -1. */
  overCapWaitSec(nowSec: number) {
    return this.overCapSince < 0 ? -1 : nowSec - this.overCapSince;
  }

  /** Owner escalation: hand every waiting robot to the owner path and clear the queue. Does not use sentinel budget. */
  drainForOwner(): number[] {
    const ids = [...this.queue];
    this.queue = [];
    this.queued.clear();
    this.overCap.clear();
    this.overCapSince = -1;
    return ids;
  }
}
