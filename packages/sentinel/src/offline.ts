/**
 * In-process immune response for the browser demo and tests: sim telemetry -> rules -> authority -> quarantine.
 * In live mode the same engine runs in the Railway service and quarantine is applied when the
 * real testnet tx confirms. `submitDelaySec` models tx confirmation latency.
 */
import type { World } from "@opsonin/sim";
import { RulesEngine, type Proposal } from "./rules.ts";
import { Authority, type Batch } from "./authority.ts";

export type OfflineSentinelOpts = {
  submitDelaySec?: number;
  /** Seconds after the cap binds before the owner escalates (models the owner reviewing and signing). null = never. */
  ownerEscalateSec?: number | null;
  onBatch?: (b: Batch & { by: "sentinel" | "owner" }, proposals: Proposal[]) => void;
};

export class OfflineSentinel {
  readonly rules: RulesEngine;
  readonly authority = new Authority();
  private inflight: Array<{ ids: number[]; at: number }> = [];
  private lastProposals = new Map<number, Proposal>();

  constructor(private readonly world: World, private readonly opts: OfflineSentinelOpts = {}) {
    this.rules = new RulesEngine(undefined, world.cfg.hz);
  }

  /** Call once per sim tick, after world.step(). */
  tick() {
    const nowSec = this.world.tick / this.world.cfg.hz;
    for (const p of this.rules.ingest(this.world.drainTelemetry())) {
      if (this.world.isolated(p.robot)) continue;
      this.lastProposals.set(p.robot, p);
      this.authority.propose(p.robot);
    }
    const b = this.authority.flush(nowSec);
    if (b) {
      this.world.markPending(b.ids);
      this.inflight.push({ ids: b.ids, at: nowSec + (this.opts.submitDelaySec ?? 1.5) });
      this.opts.onBatch?.({ ...b, by: "sentinel" }, b.ids.map((id) => this.lastProposals.get(id)!).filter(Boolean));
    }
    const esc = this.opts.ownerEscalateSec === undefined ? 4 : this.opts.ownerEscalateSec;
    if (esc !== null && this.authority.overCapWaitSec(nowSec) >= esc) {
      const ids = this.authority.drainForOwner().filter((id) => !this.world.isolated(id));
      if (ids.length) {
        this.world.markPending(ids);
        this.inflight.push({ ids, at: nowSec + (this.opts.submitDelaySec ?? 1.5) });
        this.opts.onBatch?.({ ids, t: nowSec, by: "owner" }, ids.map((id) => this.lastProposals.get(id)!).filter(Boolean));
      }
    }
    while (this.inflight.length && this.inflight[0]!.at <= nowSec) this.world.quarantine(this.inflight.shift()!.ids);
  }
}
