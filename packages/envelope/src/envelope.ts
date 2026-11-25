import { mldsa87 } from "@qorechain/pqc";
import { canonicalize } from "./canonical.ts";
import { toHex, fromHex, randomHex } from "./hex.ts";

/** Envelope format version. Bump on any change to the signed fields or framing. */
export const ENVELOPE_VERSION = 1 as const;
/** Domain tag prepended to the canonical JSON before signing. Binds signatures to this protocol. */
export const ENVELOPE_DOMAIN = "OPSONIN_ENVELOPE_V1|";

export const ML_DSA_87_PUBLIC_KEY_LENGTH = 2592;
export const ML_DSA_87_SIGNATURE_LENGTH = 4627;

export type Envelope = {
  v: typeof ENVELOPE_VERSION;
  fleetId: string;
  robotId: string;
  cmd: string;
  params: Record<string, unknown>;
  /** Command classes this issuer may send, e.g. ["nav","stop"]. */
  scope: string[];
  /** Unix seconds. */
  notBefore: number;
  /** Unix seconds. Short TTL (≤ 30 s for motion). */
  expiry: number;
  /** 128-bit random hex, single use. */
  nonce: string;
  /** Issuer key id. */
  issuer: string;
  /** ML-DSA-87 signature, hex (4627 bytes). */
  sig: string;
};

export type UnsignedEnvelope = Omit<Envelope, "sig">;

/** Command class = prefix before the first "." (e.g. "nav.goto" -> "nav"). "stop" and "safe_hold" are the stop class. */
export const STOP_CLASS = "stop";
export function commandClass(cmd: string): string {
  const c = cmd.split(".", 1)[0] ?? "";
  return c === "safe_hold" ? STOP_CLASS : c;
}
export const isStop = (cmd: string) => commandClass(cmd) === STOP_CLASS;

/** The exact bytes that are signed: domain tag + canonical JSON of every field except `sig`. */
export function signingBytes(env: UnsignedEnvelope | Envelope): Uint8Array {
  const { sig: _sig, ...rest } = env as Envelope;
  return new TextEncoder().encode(ENVELOPE_DOMAIN + canonicalize(rest));
}

export type BuildInput = {
  fleetId: string;
  robotId: string;
  cmd: string;
  params?: Record<string, unknown>;
  scope: string[];
  issuer: string;
  /** Unix seconds; defaults to now. */
  now?: number;
  /** Seconds; default 30. */
  ttl?: number;
  nonce?: string;
};

export function build(i: BuildInput): UnsignedEnvelope {
  const now = i.now ?? Math.floor(Date.now() / 1000);
  return {
    v: ENVELOPE_VERSION,
    fleetId: i.fleetId,
    robotId: i.robotId,
    cmd: i.cmd,
    params: i.params ?? {},
    scope: [...i.scope],
    notBefore: now,
    expiry: now + (i.ttl ?? 30),
    nonce: i.nonce ?? randomHex(16),
    issuer: i.issuer,
  };
}

export function sign(env: UnsignedEnvelope, secretKey: Uint8Array): Envelope {
  const sig = mldsa87.sign(secretKey, signingBytes(env));
  return { ...env, sig: toHex(sig) };
}

/** Pure signature check (no policy). Never throws. */
export function signatureValid(env: Envelope, publicKey: Uint8Array): boolean {
  try {
    if (publicKey.length !== ML_DSA_87_PUBLIC_KEY_LENGTH) return false;
    const sig = fromHex(env.sig);
    if (sig.length !== ML_DSA_87_SIGNATURE_LENGTH) return false;
    return mldsa87.verify(publicKey, signingBytes(env), sig);
  } catch {
    return false;
  }
}

export const keygen = (seed?: Uint8Array) => mldsa87.keygen(seed);
