/**
 * Deterministic warehouse fleet + worm model.
 *
 * The worm is a PROBABILISTIC SIMULATION, author-modelled from public reports (fleet-wide
 * credential flaws, BLE injection, unauthenticated DDS/ROS 2 topics). There is no exploit code here:
 * "infection" is a state flag flipped with probability p per contact per tick.
 *
 * Layout for rendering: positions (x, z) in `pos`, heading in `yaw`, state codes in `state`.
 * The worker posts these typed arrays to the main thread, which writes them into InstancedMesh buffers.
 */
import { Rng } from "./rng.ts";

export const S = {
  Healthy: 0,
  Incubating: 1, // infected, dwell time, not yet spreading
  Active: 2, // infected and spreading / misbehaving
  Pending: 3, // quarantine tx submitted, not yet confirmed (isolated optimistically)
  Quarantined: 4,
  Lost: 5, // robot caused a safety incident / bricked
} as const;
export type S = (typeof S)[keyof typeof S];
export const STATE_NAMES = ["healthy", "incubating", "active", "pending", "quarantined", "lost"] as const;

export type Config = {
  seed: number;
  robots: number;
  /** Lattice size in nodes. */
  cols: number;
  rows: number;
  /** Metres between lattice nodes. */
  spacing: number;
  /** Ticks per simulated second. */
  hz: number;
  /** Robot speed, m/s. */
  speed: number;
  /** Zones (gateways). Allowed topology = robot <-> its zone gateway only. */
  zones: number;
  /** Worm: proximity (BLE-like) channel. */
  proxRadius: number;
  pProx: number;
  /** Worm: same-zone network (DDS-like) channel, per active robot per tick. */
  pNet: number;
  /** Seconds infected before spreading. */
  dwellSec: number;
  /** Unprotected: seconds active before the robot is lost. */
  lostAfterSec: number;
  /** Background false-positive telemetry rate per healthy robot per second. */
  noisePerSec: number;
  /** Incubating robots spread silently at this fraction of the active rate (no R5 observed). */
  stealthFactor: number;
  /** Firmware attestation period in seconds (R6 fires at the next attestation after infection). */
  attestSec: number;
};

export const DEFAULTS: Config = {
  seed: 14,
  robots: 60,
  cols: 12,
  rows: 8,
  spacing: 4,
  hz: 20,
  speed: 1.6,
  zones: 4,
  proxRadius: 3.2,
  pProx: 0.035,
  pNet: 0.012,
  dwellSec: 4,
  lostAfterSec: 9,
  noisePerSec: 0.003,
  stealthFactor: 0,
  attestSec: 3,
};

/** Telemetry the gateways/sentinel can observe. Rule codes match AGENT.md §5.3. */
export type Telemetry =
  | { t: number; robot: number; kind: "rate"; value: number }
  | { t: number; robot: number; kind: "R1" | "R2" | "R3" | "R6" | "R7" }
  | { t: number; robot: number; kind: "R5"; peer: number };

export type Sample = { t: number; healthy: number; infected: number; quarantined: number; lost: number; operational: number };

export class World {
  readonly cfg: Config;
  readonly n: number;
  readonly pos: Float32Array; // x, z interleaved
  readonly yaw: Float32Array;
  readonly state: Uint8Array;
  readonly zone: Uint8Array;
  /** Tick the robot entered its current state. */
  readonly since: Int32Array;
  /** State before entering Pending, restored if the quarantine tx fails. */
  private readonly prev: Uint8Array;
  /** Generation in which the robot was infected (0 = patient zero), -1 if never. */
  readonly gen: Int16Array;
  tick = 0;
  /** If false, no immune response is possible (the "Unprotected" world). */
  readonly immune: boolean;
  readonly series: Sample[] = [];
  everInfected = 0;
  firstInfectionTick = -1;
  containedTick = -1;

  private rng: Rng;
  private target: Int32Array; // target node index per robot
  private cmdCount: Uint16Array;
  private pending: Telemetry[] = [];

  constructor(cfg: Partial<Config> = {}, opts: { immune: boolean } = { immune: true }) {
    this.cfg = { ...DEFAULTS, ...cfg };
    this.immune = opts.immune;
    const n = (this.n = this.cfg.robots);
    this.rng = new Rng(this.cfg.seed);
    this.pos = new Float32Array(n * 2);
    this.yaw = new Float32Array(n);
    this.state = new Uint8Array(n);
    this.zone = new Uint8Array(n);
    this.since = new Int32Array(n);
    this.prev = new Uint8Array(n);
    this.gen = new Int16Array(n).fill(-1);
    this.target = new Int32Array(n);
    this.cmdCount = new Uint16Array(n);
    const { cols, rows } = this.cfg;
    for (let i = 0; i < n; i++) {
      const node = this.rng.int(cols * rows);
      const [x, z] = this.nodeXZ(node);
      this.pos[i * 2] = x;
      this.pos[i * 2 + 1] = z;
      this.target[i] = this.rng.int(cols * rows);
      this.zone[i] = this.zoneOf(x, z);
    }
    this.sample();
  }

  // ---------- geometry ----------
  get width() { return (this.cfg.cols - 1) * this.cfg.spacing; }
  get depth() { return (this.cfg.rows - 1) * this.cfg.spacing; }
  nodeXZ(node: number): [number, number] {
    const { cols, spacing } = this.cfg;
    return [(node % cols) * spacing - this.width / 2, Math.floor(node / cols) * spacing - this.depth / 2];
  }
  zoneOf(x: number, z: number): number {
    const half = Math.max(1, Math.round(Math.sqrt(this.cfg.zones)));
    const zx = Math.min(half - 1, Math.floor(((x + this.width / 2) / (this.width + 1e-6)) * half));
    const zz = Math.min(half - 1, Math.floor(((z + this.depth / 2) / (this.depth + 1e-6)) * half));
    return zz * half + zx;
  }
  isolated(i: number) {
    const s = this.state[i];
    return s === S.Pending || s === S.Quarantined || s === S.Lost;
  }
  infected(i: number) {
    const s = this.state[i];
    return s === S.Incubating || s === S.Active;
  }

  // ---------- external controls ----------
  /** "Compromise a robot": patient zero. Returns false if the robot cannot be infected. */
  compromise(i: number): boolean {
    if (this.state[i] !== S.Healthy) return false;
    this.infect(i, 0);
    return true;
  }
  /** Mark robots as quarantine-pending (optimistic isolation on tx submit). */
  markPending(ids: number[]) {
    if (!this.immune) return;
    for (const i of ids) if (!this.isolated(i)) { this.prev[i] = this.state[i]!; this.set(i, S.Pending); }
  }
  /** Apply confirmed quarantine. Quarantined robots stop, are network-isolated, cannot infect or be infected. */
  quarantine(ids: number[]) {
    if (!this.immune) return;
    for (const i of ids) if (this.state[i] !== S.Lost) this.set(i, S.Quarantined);
  }
  /** Revert a pending quarantine that failed to confirm (tx rejected). */
  revertPending(ids: number[]) {
    for (const i of ids) if (this.state[i] === S.Pending) this.set(i, this.prev[i] as S);
  }
  /** Owner release (after PQ-signed release confirms): robot is re-imaged and returns healthy. */
  release(ids: number[]) {
    for (const i of ids) if (this.state[i] === S.Quarantined) { this.set(i, S.Healthy); this.gen[i] = -1; }
  }

  /** Telemetry produced since the last drain. */
  drainTelemetry(): Telemetry[] {
    const t = this.pending;
    this.pending = [];
    return t;
  }

  // ---------- simulation ----------
  step() {
    const { hz } = this.cfg;
    this.tick++;
    const t = this.tick;
    this.move();
    this.spread();
    this.progress();
    this.noise();
    if (t % hz === 0) this.emitRates();
    if (t % (hz / 2) === 0) this.sample();
    this.checkContained();
  }

  private set(i: number, s: S) {
    this.state[i] = s;
    this.since[i] = this.tick;
  }

  private infect(i: number, gen: number) {
    this.set(i, S.Incubating);
    this.gen[i] = gen;
    this.everInfected++;
    if (this.firstInfectionTick < 0) this.firstInfectionTick = this.tick;
    this.containedTick = -1;
  }

  private move() {
    const { speed, hz, cols, rows } = this.cfg;
    const stepLen = speed / hz;
    for (let i = 0; i < this.n; i++) {
      const s = this.state[i];
      if (s === S.Pending || s === S.Quarantined || s === S.Lost) continue;
      const [tx, tz] = this.nodeXZ(this.target[i]!);
      const x = this.pos[i * 2]!, z = this.pos[i * 2 + 1]!;
      // Manhattan routing along aisles: x first, then z.
      let dx = tx - x, dz = tz - z;
      if (Math.abs(dx) > 1e-3) dz = 0; else dx = 0;
      const d = Math.abs(dx) + Math.abs(dz);
      const v = s === S.Active ? stepLen * 1.35 : stepLen; // active worm makes robots erratic and faster
      if (d <= v) {
        this.pos[i * 2] = dx !== 0 ? tx : x;
        this.pos[i * 2 + 1] = dz !== 0 ? tz : z;
        if (Math.abs(tx - this.pos[i * 2]!) < 1e-3 && Math.abs(tz - this.pos[i * 2 + 1]!) < 1e-3) this.target[i] = this.rng.int(cols * rows);
      } else {
        this.pos[i * 2] = x + Math.sign(dx) * v;
        this.pos[i * 2 + 1] = z + Math.sign(dz) * v;
      }
      if (d > 0) this.yaw[i] = Math.atan2(Math.sign(dx), Math.sign(dz));
      this.zone[i] = this.zoneOf(this.pos[i * 2]!, this.pos[i * 2 + 1]!);
      this.cmdCount[i] = this.cmdCount[i]! + (this.rng.chance(s === S.Active ? 0.6 : 0.1) ? 1 : 0);
    }
  }

  private spread() {
    const { proxRadius, pProx, pNet } = this.cfg;
    const r2 = proxRadius * proxRadius;
    const t = this.tick;
    const newly: Array<[number, number]> = [];
    for (let i = 0; i < this.n; i++) {
      const si = this.state[i];
      if (si !== S.Active && si !== S.Incubating) continue;
      const stealth = si === S.Incubating;
      const k = stealth ? this.cfg.stealthFactor : 1;
      const xi = this.pos[i * 2]!, zi = this.pos[i * 2 + 1]!;
      for (let j = 0; j < this.n; j++) {
        if (j === i || this.state[j] !== S.Healthy) continue;
        const dx = this.pos[j * 2]! - xi, dz = this.pos[j * 2 + 1]! - zi;
        const near = dx * dx + dz * dz <= r2;
        const sameZone = this.zone[j] === this.zone[i];
        let p = 0;
        if (near) p += pProx * k;
        if (sameZone) p += (pNet * k) / Math.max(1, this.n / this.cfg.zones);
        if (p === 0) continue;
        if (this.rng.chance(p)) {
          // The lateral handshake is outside the allowed hub-and-spoke topology: R5 (observed by gateway with p=0.7).
          if (!stealth && this.rng.chance(0.7)) this.pending.push({ t, robot: i, kind: "R5", peer: j });
          newly.push([j, this.gen[i]! + 1]);
        }
      }
    }
    for (const [j, g] of newly) if (this.state[j] === S.Healthy) this.infect(j, g);
  }

  private progress() {
    const { hz, dwellSec, lostAfterSec } = this.cfg;
    const t = this.tick;
    for (let i = 0; i < this.n; i++) {
      const s = this.state[i];
      const age = (t - this.since[i]!) / hz;
      if (s === S.Incubating && age >= dwellSec) {
        this.set(i, S.Active);
      }
      if (s === S.Active || s === S.Incubating) {
        // Periodic firmware attestation (staggered per robot) reports a hash mismatch once infected.
        const period = Math.round(this.cfg.attestSec * hz);
        if ((t + i * 7) % period === 0 && t - this.since[i]! > 0 && s === S.Active) this.pending.push({ t, robot: i, kind: "R6" });
      }
      if (s === S.Active) {
        // Misbehaviour signals while active (per second rates).
        if (this.rng.chance(0.25 / hz)) this.pending.push({ t, robot: i, kind: "R1" });
        if (this.rng.chance(0.15 / hz)) this.pending.push({ t, robot: i, kind: "R3" });
        if (this.rng.chance(0.10 / hz)) this.pending.push({ t, robot: i, kind: "R2" });
        if (this.rng.chance(0.30 / hz)) this.pending.push({ t, robot: i, kind: "R7" });
        if (age >= lostAfterSec && (!this.immune || this.rng.chance(0.5 / hz))) this.set(i, S.Lost);
      }
    }
  }

  private noise() {
    const p = this.cfg.noisePerSec / this.cfg.hz;
    const kinds = ["R1", "R2", "R3", "R7"] as const;
    for (let i = 0; i < this.n; i++) {
      if (this.state[i] !== S.Healthy) continue;
      if (this.rng.chance(p)) this.pending.push({ t: this.tick, robot: i, kind: kinds[this.rng.int(kinds.length)]! });
    }
  }

  private emitRates() {
    for (let i = 0; i < this.n; i++) {
      if (this.isolated(i)) { this.cmdCount[i] = 0; continue; }
      this.pending.push({ t: this.tick, robot: i, kind: "rate", value: this.cmdCount[i]! });
      this.cmdCount[i] = 0;
    }
  }

  private sample() {
    let healthy = 0, infected = 0, quarantined = 0, lost = 0;
    for (let i = 0; i < this.n; i++) {
      const s = this.state[i];
      if (s === S.Healthy) healthy++;
      else if (s === S.Incubating || s === S.Active) infected++;
      else if (s === S.Pending || s === S.Quarantined) quarantined++;
      else lost++;
    }
    this.series.push({ t: this.tick / this.cfg.hz, healthy, infected, quarantined, lost, operational: healthy / this.n });
  }

  private checkContained() {
    if (this.firstInfectionTick < 0 || this.containedTick >= 0) return;
    for (let i = 0; i < this.n; i++) if (this.infected(i)) return;
    this.containedTick = this.tick;
  }

  /** Seconds from first infection until no robot is infected (all isolated or lost), or null. */
  get timeToContainment(): number | null {
    return this.containedTick < 0 || this.firstInfectionTick < 0 ? null : (this.containedTick - this.firstInfectionTick) / this.cfg.hz;
  }

  counts() {
    return this.series[this.series.length - 1]!;
  }
}
