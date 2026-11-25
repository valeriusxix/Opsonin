import { describe, it, expect } from "vitest";
import { World, S, Rng } from "../src/index.ts";

function runSteps(w: World, ticks: number, compromiseAt = 40) {
  for (let t = 0; t < ticks; t++) {
    if (t === compromiseAt) w.compromise(0);
    w.step();
    w.drainTelemetry();
  }
}

describe("Rng", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const a = new Rng(7), b = new Rng(7), c = new Rng(8);
    const xa = Array.from({ length: 5 }, () => a.u32());
    expect(Array.from({ length: 5 }, () => b.u32())).toEqual(xa);
    expect(Array.from({ length: 5 }, () => c.u32())).not.toEqual(xa);
  });
  it("next() stays in [0,1)", () => {
    const r = new Rng(1);
    for (let i = 0; i < 10_000; i++) {
      const x = r.next();
      expect(x >= 0 && x < 1).toBe(true);
    }
  });
});

describe("World determinism", () => {
  it("same seed -> identical infection curve, states and positions", () => {
    const a = new World({ seed: 99 }, { immune: false });
    const b = new World({ seed: 99 }, { immune: false });
    runSteps(a, 600);
    runSteps(b, 600);
    expect(a.series).toEqual(b.series);
    expect(Array.from(a.state)).toEqual(Array.from(b.state));
    expect(Array.from(a.pos)).toEqual(Array.from(b.pos));
  });
  it("different seed -> different curve", () => {
    const a = new World({ seed: 1 }, { immune: false });
    const b = new World({ seed: 2 }, { immune: false });
    runSteps(a, 600);
    runSteps(b, 600);
    expect(a.series).not.toEqual(b.series);
  });
});

describe("World mechanics", () => {
  it("unprotected worm spreads and robots are lost", () => {
    const w = new World({ seed: 3 }, { immune: false });
    runSteps(w, 60 * 20);
    expect(w.everInfected).toBeGreaterThan(30);
    expect(w.counts().lost).toBeGreaterThan(30);
  });
  it("compromise only infects a healthy robot", () => {
    const w = new World({ seed: 3 });
    expect(w.compromise(5)).toBe(true);
    expect(w.compromise(5)).toBe(false);
    expect(w.state[5]).toBe(S.Incubating);
  });
  it("quarantined robots do not move, cannot be infected, cannot spread", () => {
    const w = new World({ seed: 5, pProx: 1, pNet: 1, dwellSec: 0 });
    w.compromise(0);
    w.quarantine([0, 1]);
    const p1 = [w.pos[2], w.pos[3]];
    for (let t = 0; t < 200; t++) { w.step(); w.drainTelemetry(); }
    expect([w.pos[2], w.pos[3]]).toEqual(p1);
    expect(w.state[1]).toBe(S.Quarantined);
    expect(w.everInfected).toBe(1); // patient zero isolated before spreading
  });
  it("pending restores the previous state if the tx fails", () => {
    const w = new World({ seed: 5 });
    w.compromise(2);
    w.markPending([2, 3]);
    expect(w.state[2]).toBe(S.Pending);
    w.revertPending([2, 3]);
    expect(w.state[2]).toBe(S.Incubating);
    expect(w.state[3]).toBe(S.Healthy);
  });
  it("release returns a quarantined robot to healthy", () => {
    const w = new World({ seed: 5 });
    w.compromise(4);
    w.quarantine([4]);
    w.release([4]);
    expect(w.state[4]).toBe(S.Healthy);
    expect(w.gen[4]).toBe(-1);
  });
  it("unprotected world ignores quarantine", () => {
    const w = new World({ seed: 5 }, { immune: false });
    w.quarantine([1]);
    expect(w.state[1]).toBe(S.Healthy);
  });
  it("emits rate telemetry once per second for active robots and R5 on observed lateral spread", () => {
    const w = new World({ seed: 8, pProx: 0.5, dwellSec: 0.5 });
    w.compromise(0);
    const kinds = new Set<string>();
    let rates = 0;
    for (let t = 0; t < 20 * 10; t++) {
      w.step();
      for (const e of w.drainTelemetry()) { kinds.add(e.kind); if (e.kind === "rate") rates++; }
    }
    expect(kinds.has("R5")).toBe(true);
    expect(kinds.has("R6")).toBe(true);
    expect(rates).toBeGreaterThan(0);
  });
  it("300 robots step fast enough for a worker (< 4 ms/tick avg)", () => {
    const w = new World({ seed: 1, robots: 300, cols: 20, rows: 14 });
    w.compromise(0);
    const t0 = performance.now();
    for (let t = 0; t < 200; t++) { w.step(); w.drainTelemetry(); }
    expect((performance.now() - t0) / 200).toBeLessThan(4);
  });
});
