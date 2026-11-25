import { describe, it, expect } from "vitest";
import { World } from "@opsonin/sim";
import { RulesEngine, Authority, OfflineSentinel, DEFAULT_RULES } from "../src/index.ts";

describe("RulesEngine", () => {
  it("crosses threshold on strong signals and applies hysteresis", () => {
    const r = new RulesEngine();
    expect(r.ingest([{ t: 1, robot: 1, kind: "R5", peer: 2 }])).toHaveLength(0); // 3 < 4
    const p = r.ingest([{ t: 2, robot: 1, kind: "R1" }]); // 3 decayed + 2 >= 4
    expect(p).toHaveLength(1);
    expect(p[0]!.hits).toMatchObject({ R5: 1, R1: 1 });
    expect(r.ingest([{ t: 3, robot: 1, kind: "R6" }])).toHaveLength(0); // not re-armed
  });
  it("re-arms after the score decays below rearm", () => {
    const r = new RulesEngine();
    r.ingest([{ t: 0, robot: 1, kind: "R6" }, { t: 0, robot: 1, kind: "R5", peer: 0 }]);
    const later = 20 * 60; // 60 s later at 20 Hz
    expect(r.ingest([{ t: later, robot: 1, kind: "R6" }, { t: later, robot: 1, kind: "R5", peer: 0 }])).toHaveLength(1);
  });
  it("isolated noise does not trigger", () => {
    const r = new RulesEngine();
    const ev = Array.from({ length: 5 }, (_, k) => ({ t: k * 20 * 30, robot: 9, kind: "R7" as const }));
    expect(r.ingest(ev)).toHaveLength(0);
  });
  it("R4 flags a rate spike only after warmup, and spikes do not poison the baseline", () => {
    const r = new RulesEngine({ ...DEFAULT_RULES, threshold: 1 });
    const base = Array.from({ length: 8 }, (_, k) => ({ t: k * 20, robot: 3, kind: "rate" as const, value: 2 + (k % 2) }));
    expect(r.ingest(base)).toHaveLength(0);
    expect(r.ingest([{ t: 200, robot: 3, kind: "rate", value: 14 }])).toHaveLength(1);
  });
});

describe("Authority", () => {
  it("batches and never exceeds the cap per window", () => {
    const a = new Authority({ cap: 3, windowSec: 60, batchSec: 2 });
    for (let i = 0; i < 5; i++) a.propose(i);
    expect(a.flush(0)?.ids).toEqual([0, 1, 2]);
    expect(a.flush(1)).toBeNull(); // batch interval
    expect(a.flush(3)).toBeNull(); // cap exhausted
    expect([...a.overCap]).toEqual([3, 4]);
    expect(a.remaining(3)).toBe(0);
    expect(a.flush(61)?.ids).toEqual([3, 4]); // window rolled
  });
  it("owner escalation drains the waiting queue without using sentinel budget", () => {
    const a = new Authority({ cap: 1, windowSec: 60, batchSec: 0 });
    a.propose(1); a.propose(2); a.propose(3);
    a.flush(0);
    expect(a.overCapWaitSec(5)).toBe(5);
    expect(a.drainForOwner()).toEqual([2, 3]);
    expect(a.overCapWaitSec(5)).toBe(-1);
    expect(a.remaining(5)).toBe(0);
  });
  it("de-duplicates proposals", () => {
    const a = new Authority({ cap: 10, windowSec: 60, batchSec: 0 });
    a.propose(1); a.propose(1);
    expect(a.flush(0)?.ids).toEqual([1]);
  });
});

describe("A/B: immune vs unprotected (same seeds)", () => {
  function run(seed: number, immune: boolean) {
    const w = new World({ seed }, { immune });
    const s = immune ? new OfflineSentinel(w) : null;
    for (let t = 0; t < 60 * 20; t++) {
      if (t === 40) w.compromise(0);
      w.step();
      if (s) s.tick(); else w.drainTelemetry();
    }
    return w;
  }
  const seeds = Array.from({ length: 12 }, (_, i) => i + 1);
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

  it("immune world loses far fewer robots and contains most outbreaks small", () => {
    const im = seeds.map((s) => run(s, true));
    const un = seeds.map((s) => run(s, false));
    expect(median(un.map((w) => w.counts().lost))).toBeGreaterThan(50);
    expect(median(im.map((w) => w.counts().lost))).toBe(0);
    expect(median(im.map((w) => w.everInfected))).toBeLessThan(12);
  });
  it("default demo seed tells the story: visible spread, then containment", () => {
    const w = run(14, true);
    expect(w.everInfected).toBeGreaterThanOrEqual(3);
    expect(w.timeToContainment).not.toBeNull();
    expect(w.counts().lost).toBe(0);
  });
});
