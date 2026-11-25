/**
 * Rules engine. Deterministic and side-effect free: telemetry in, quarantine proposals out.
 * The LLM never decides; it only writes the incident report for a decision made here.
 */
import type { Telemetry } from "@opsonin/sim";

export type Rule = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7";
export const RULE_TEXT: Record<Rule, string> = {
  R1: "unsigned or invalid command on a controlled channel",
  R2: "nonce replay or expired envelope",
  R3: "command outside issuer scope",
  R4: "command-rate anomaly vs robot baseline",
  R5: "peer-to-peer handshake outside allowed topology",
  R6: "firmware hash mismatch vs enrolled hash",
  R7: "reported position inconsistent with odometry",
};

export type RulesConfig = {
  weights: Record<Rule, number>;
  /** Score at which a robot is proposed for quarantine. */
  threshold: number;
  /** After a proposal, a robot is not proposed again until its score falls below this (hysteresis). */
  rearm: number;
  /** Score half-life in seconds. */
  halfLifeSec: number;
  /** R4: z-score above which a rate sample counts, and samples needed before the baseline is trusted. */
  rateZ: number;
  rateWarmup: number;
};

export const DEFAULT_RULES: RulesConfig = {
  weights: { R1: 2, R2: 1, R3: 2, R4: 1.5, R5: 3, R6: 3, R7: 1 },
  threshold: 4,
  rearm: 1,
  halfLifeSec: 6,
  rateZ: 3,
  rateWarmup: 5,
};

export type Proposal = { robot: number; score: number; hits: Partial<Record<Rule, number>>; t: number };

type RobotState = { score: number; lastT: number; hits: Partial<Record<Rule, number>>; armed: boolean; n: number; mean: number; m2: number };

export class RulesEngine {
  private robots = new Map<number, RobotState>();
  constructor(private readonly cfg: RulesConfig = DEFAULT_RULES, private readonly hz = 20) {}

  private get(robot: number, t: number): RobotState {
    let r = this.robots.get(robot);
    if (!r) this.robots.set(robot, (r = { score: 0, lastT: t, hits: {}, armed: true, n: 0, mean: 0, m2: 0 }));
    return r;
  }

  private decay(r: RobotState, t: number) {
    const dt = (t - r.lastT) / this.hz;
    if (dt > 0) r.score *= Math.pow(0.5, dt / this.cfg.halfLifeSec);
    r.lastT = t;
  }

  private hit(r: RobotState, rule: Rule) {
    r.score += this.cfg.weights[rule];
    r.hits[rule] = (r.hits[rule] ?? 0) + 1;
  }

  /** Ingest telemetry; returns robots that crossed the threshold in this batch. */
  ingest(events: Telemetry[]): Proposal[] {
    const out: Proposal[] = [];
    for (const e of events) {
      const r = this.get(e.robot, e.t);
      this.decay(r, e.t);
      if (!r.armed && r.score < this.cfg.rearm) r.armed = true;
      if (e.kind === "rate") {
        // Welford running baseline; anomalous samples are NOT folded into the baseline.
        const sd = r.n > 1 ? Math.sqrt(r.m2 / (r.n - 1)) : 0;
        const z = r.n >= this.cfg.rateWarmup ? (e.value - r.mean) / Math.max(sd, 0.75) : 0;
        if (z > this.cfg.rateZ) this.hit(r, "R4");
        else {
          r.n++;
          const d = e.value - r.mean;
          r.mean += d / r.n;
          r.m2 += d * (e.value - r.mean);
        }
      } else {
        this.hit(r, e.kind);
      }
      if (r.armed && r.score >= this.cfg.threshold) {
        r.armed = false;
        out.push({ robot: e.robot, score: r.score, hits: { ...r.hits }, t: e.t });
      }
    }
    return out;
  }

  /** Forget a robot's history (after a release / re-image). */
  reset(robot: number) {
    this.robots.delete(robot);
  }

  scoreOf(robot: number) {
    return this.robots.get(robot)?.score ?? 0;
  }
}
