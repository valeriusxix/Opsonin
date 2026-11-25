import { type Envelope, ENVELOPE_VERSION, commandClass, isStop, signatureValid } from "./envelope.ts";
import type { NonceStore } from "./nonce-store.ts";

/** Locally cached on-chain quarantine state. Robots and gateways decide from this; the chain is not in the control loop. */
export type QuarantineCache = {
  epoch: number;
  /** Unix seconds when the cache was last refreshed from chain. */
  fetchedAt: number;
  quarantined: ReadonlySet<string>;
};

export type VerifyContext = {
  /** issuer key id -> ML-DSA-87 public key (2592 B). */
  trustedIssuers: ReadonlyMap<string, Uint8Array>;
  /** Scope each issuer is ALLOWED to claim. The envelope's own `scope` must be a subset. */
  issuerScopes: ReadonlyMap<string, readonly string[]>;
  nonces: NonceStore;
  cache: QuarantineCache;
  fleetId: string;
  /** The robot doing the verifying. */
  robotId: string;
  /** Unix seconds. */
  now: number;
  /** Beyond this cache age, only the stop class is accepted. Default 30 s. */
  maxStaleSec?: number;
  /** Clock skew tolerance in seconds. Default 2. */
  skewSec?: number;
  /** Hard cap on TTL for motion commands. Default 30 s. */
  maxMotionTtlSec?: number;
};

/** Reason codes map to sentinel rules: R1 signature/trust, R2 replay/expiry, R3 scope. */
export type Rejection =
  | "malformed"
  | "bad_signature"
  | "untrusted_issuer"
  | "scope_violation"
  | "not_yet_valid"
  | "expired"
  | "ttl_too_long"
  | "replay"
  | "wrong_target"
  | "quarantined"
  | "stale_cache";

export const RULE_OF: Record<Rejection, "R1" | "R2" | "R3" | "POLICY"> = {
  malformed: "R1",
  bad_signature: "R1",
  untrusted_issuer: "R1",
  scope_violation: "R3",
  not_yet_valid: "R2",
  expired: "R2",
  ttl_too_long: "R2",
  replay: "R2",
  wrong_target: "R1",
  quarantined: "POLICY",
  stale_cache: "POLICY",
};

export type Verdict = { ok: true; cls: string; viaStopRule: boolean } | { ok: false; reason: Rejection; rule: (typeof RULE_OF)[Rejection] };

const reject = (reason: Rejection): Verdict => ({ ok: false, reason, rule: RULE_OF[reason] });

function wellFormed(e: unknown): e is Envelope {
  const x = e as Envelope;
  return (
    !!x && typeof x === "object" && x.v === ENVELOPE_VERSION &&
    typeof x.fleetId === "string" && typeof x.robotId === "string" && typeof x.cmd === "string" && x.cmd.length > 0 &&
    typeof x.params === "object" && x.params !== null && !Array.isArray(x.params) &&
    Array.isArray(x.scope) && x.scope.every((s) => typeof s === "string") &&
    Number.isInteger(x.notBefore) && Number.isInteger(x.expiry) &&
    typeof x.nonce === "string" && /^[0-9a-f]{32}$/.test(x.nonce) &&
    typeof x.issuer === "string" && typeof x.sig === "string"
  );
}

/**
 * Verify an envelope. Rules run IN ORDER and fail closed:
 *   signature valid -> issuer trusted -> cmd in scope -> time window -> nonce unseen
 *   -> robot not quarantined (cached epoch) -> cache not stale.
 * Fail-safe exception: the STOP class ("stop", "safe_hold") is accepted from quarantined and
 * stale states and even when expired or replayed, as long as it is authentically signed by a
 * trusted issuer whose scope includes "stop". Stopping is never the dangerous action.
 */
export function verify(env: unknown, ctx: VerifyContext): Verdict {
  if (!wellFormed(env)) return reject("malformed");

  // 1. issuer key lookup + signature (authenticity before anything else)
  const pk = ctx.trustedIssuers.get(env.issuer);
  if (!pk) return reject("untrusted_issuer");
  if (!signatureValid(env, pk)) return reject("bad_signature");

  // 2. addressed to this fleet/robot
  if (env.fleetId !== ctx.fleetId || env.robotId !== ctx.robotId) return reject("wrong_target");

  // 3. scope: claimed scope must be within what this issuer is allowed, and cmd class within claimed scope
  const allowed = ctx.issuerScopes.get(env.issuer) ?? [];
  const cls = commandClass(env.cmd);
  if (!env.scope.every((s) => allowed.includes(s)) || !env.scope.includes(cls)) return reject("scope_violation");

  // Fail-safe: an authentic, in-scope stop is always honoured.
  if (isStop(env.cmd)) return { ok: true, cls, viaStopRule: true };

  // 4. time window
  const skew = ctx.skewSec ?? 2;
  if (ctx.now + skew < env.notBefore) return reject("not_yet_valid");
  if (ctx.now - skew > env.expiry) return reject("expired");
  if (env.expiry - env.notBefore > (ctx.maxMotionTtlSec ?? 30)) return reject("ttl_too_long");

  // 5. nonce single-use
  if (!ctx.nonces.checkAndInsert(env.issuer, env.nonce, env.expiry + skew, ctx.now)) return reject("replay");

  // 6. quarantine (cached epoch)
  if (ctx.cache.quarantined.has(ctx.robotId)) return reject("quarantined");

  // 7. cache freshness
  if (ctx.now - ctx.cache.fetchedAt > (ctx.maxStaleSec ?? 30)) return reject("stale_cache");

  return { ok: true, cls, viaStopRule: false };
}
