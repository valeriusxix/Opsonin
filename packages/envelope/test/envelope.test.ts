import { describe, it, expect, beforeAll } from "vitest";
import {
  build, sign, verify, keygen, canonicalize, signingBytes, MemoryNonceStore, commandClass,
  type Envelope, type VerifyContext, type QuarantineCache,
} from "../src/index.ts";

const NOW = 1_800_000_000;
let op: ReturnType<typeof keygen>;
let other: ReturnType<typeof keygen>;

beforeAll(() => {
  op = keygen(new Uint8Array(32).fill(7));
  other = keygen(new Uint8Array(32).fill(9));
});

function ctx(over: Partial<VerifyContext> = {}, cache: Partial<QuarantineCache> = {}): VerifyContext {
  return {
    trustedIssuers: new Map([["operator", op.publicKey]]),
    issuerScopes: new Map([["operator", ["nav", "stop", "arm"]]]),
    nonces: new MemoryNonceStore(),
    cache: { epoch: 1, fetchedAt: NOW, quarantined: new Set<string>(), ...cache },
    fleetId: "fleet-1",
    robotId: "r-007",
    now: NOW,
    ...over,
  };
}

function env(over: Partial<Parameters<typeof build>[0]> = {}, key = op.secretKey): Envelope {
  return sign(build({ fleetId: "fleet-1", robotId: "r-007", cmd: "nav.goto", params: { x: 1, y: 2 }, scope: ["nav", "stop"], issuer: "operator", now: NOW, ttl: 10, ...over }), key);
}

describe("canonicalize", () => {
  it("sorts keys and strips whitespace deterministically", () => {
    expect(canonicalize({ b: 1, a: { d: [1, 2], c: "x" } })).toBe('{"a":{"c":"x","d":[1,2]},"b":1}');
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });
  it("rejects values it cannot represent canonically", () => {
    expect(() => canonicalize({ a: undefined })).toThrow();
    expect(() => canonicalize({ a: NaN })).toThrow();
    expect(() => canonicalize({ a: Infinity })).toThrow();
    expect(() => canonicalize({ a: new Date(0) })).toThrow();
    expect(() => canonicalize({ a: 1n })).toThrow();
  });
  it("normalises -0", () => expect(canonicalize({ a: -0 })).toBe('{"a":0}'));
  it("signing bytes ignore field order and the sig field", () => {
    const e = env();
    const reordered = Object.fromEntries(Object.entries(e).reverse()) as Envelope;
    expect(signingBytes(reordered)).toEqual(signingBytes(e));
    expect(signingBytes({ ...e, sig: "00" })).toEqual(signingBytes(e));
  });
});

describe("verify: happy path", () => {
  it("accepts a valid motion envelope", () => {
    expect(verify(env(), ctx())).toEqual({ ok: true, cls: "nav", viaStopRule: false });
  });
  it("command class mapping", () => {
    expect(commandClass("nav.goto")).toBe("nav");
    expect(commandClass("safe_hold")).toBe("stop");
    expect(commandClass("stop")).toBe("stop");
  });
});

describe("verify: fail closed, in order", () => {
  it("malformed", () => {
    expect(verify({ ...env(), v: 2 }, ctx())).toMatchObject({ ok: false, reason: "malformed" });
    expect(verify(null, ctx())).toMatchObject({ ok: false, reason: "malformed" });
    expect(verify({ ...env(), nonce: "abc" }, ctx())).toMatchObject({ ok: false, reason: "malformed" });
  });
  it("untrusted issuer", () => {
    expect(verify(env({ issuer: "mallory" }), ctx())).toMatchObject({ ok: false, reason: "untrusted_issuer", rule: "R1" });
  });
  it("bad signature: wrong key, tampered field, truncated sig", () => {
    expect(verify(env({}, other.secretKey), ctx())).toMatchObject({ reason: "bad_signature", rule: "R1" });
    expect(verify({ ...env(), params: { x: 99, y: 2 } }, ctx())).toMatchObject({ reason: "bad_signature" });
    expect(verify({ ...env(), cmd: "arm.swing" }, ctx())).toMatchObject({ reason: "bad_signature" });
    const e = env();
    expect(verify({ ...e, sig: e.sig.slice(0, -2) }, ctx())).toMatchObject({ reason: "bad_signature" });
    expect(verify({ ...e, sig: "zz" }, ctx())).toMatchObject({ reason: "bad_signature" });
  });
  it("signature is checked before policy (a forged envelope never reaches the nonce store)", () => {
    const c = ctx();
    verify({ ...env(), params: { forged: true } }, c);
    expect((c.nonces as MemoryNonceStore).size).toBe(0);
  });
  it("wrong target robot or fleet", () => {
    expect(verify(env({ robotId: "r-008" }), ctx())).toMatchObject({ reason: "wrong_target" });
    expect(verify(env({ fleetId: "fleet-2" }), ctx())).toMatchObject({ reason: "wrong_target" });
  });
  it("scope: cmd outside claimed scope, claimed scope beyond issuer allowance", () => {
    expect(verify(env({ cmd: "arm.swing" }), ctx())).toMatchObject({ reason: "scope_violation", rule: "R3" });
    expect(verify(env({ cmd: "door.open", scope: ["door"] }), ctx())).toMatchObject({ reason: "scope_violation" });
  });
  it("time window", () => {
    expect(verify(env({ now: NOW + 100 }), ctx())).toMatchObject({ reason: "not_yet_valid", rule: "R2" });
    expect(verify(env({ now: NOW - 100 }), ctx())).toMatchObject({ reason: "expired", rule: "R2" });
    expect(verify(env({ ttl: 120 }), ctx())).toMatchObject({ reason: "ttl_too_long" });
    expect(verify(env({ now: NOW - 11 }), ctx()).ok).toBe(true); // within 2 s skew of expiry
  });
  it("replay", () => {
    const c = ctx();
    const e = env();
    expect(verify(e, c).ok).toBe(true);
    expect(verify(e, c)).toMatchObject({ ok: false, reason: "replay", rule: "R2" });
  });
  it("quarantined robot refuses motion", () => {
    expect(verify(env(), ctx({}, { quarantined: new Set(["r-007"]) }))).toMatchObject({ reason: "quarantined" });
  });
  it("stale cache refuses motion", () => {
    expect(verify(env(), ctx({}, { fetchedAt: NOW - 31 }))).toMatchObject({ reason: "stale_cache" });
    expect(verify(env(), ctx({ maxStaleSec: 60 }, { fetchedAt: NOW - 31 })).ok).toBe(true);
  });
  it("full nonce store fails closed", () => {
    const c = ctx({ nonces: new MemoryNonceStore(0) });
    expect(verify(env(), c)).toMatchObject({ reason: "replay" });
  });
});

describe("verify: stop is always allowed (fail safe)", () => {
  const stopCases: Array<[string, Partial<VerifyContext>, Partial<QuarantineCache>]> = [
    ["quarantined", {}, { quarantined: new Set(["r-007"]) }],
    ["stale cache", {}, { fetchedAt: NOW - 3600 }],
    ["expired", { now: NOW + 3600 }, { fetchedAt: NOW + 3600 }],
  ];
  for (const [name, c, q] of stopCases) {
    it(`accepts stop when ${name}`, () => {
      expect(verify(env({ cmd: "stop" }), ctx(c, q))).toEqual({ ok: true, cls: "stop", viaStopRule: true });
      expect(verify(env({ cmd: "safe_hold" }), ctx(c, q)).ok).toBe(true);
    });
  }
  it("accepts a replayed stop", () => {
    const c = ctx();
    const e = env({ cmd: "stop" });
    expect(verify(e, c).ok).toBe(true);
    expect(verify(e, c).ok).toBe(true);
  });
  it("still refuses a forged or out-of-scope stop", () => {
    expect(verify(env({ cmd: "stop" }, other.secretKey), ctx())).toMatchObject({ reason: "bad_signature" });
    expect(verify(env({ cmd: "stop", scope: ["nav"] }), ctx())).toMatchObject({ reason: "scope_violation" });
    expect(verify(env({ cmd: "stop", issuer: "mallory" }), ctx())).toMatchObject({ reason: "untrusted_issuer" });
  });
});
