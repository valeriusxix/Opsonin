/**
 * Canonical JSON: object keys sorted by UTF-16 code unit order, no whitespace,
 * no undefined, no non-finite numbers, no non-plain objects. Deterministic across runs and platforms.
 * Anything outside that subset throws (fail closed: an envelope we cannot canonicalise is never signed or accepted).
 */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function canonicalize(value: unknown): string {
  return enc(value, 0);
}

function enc(v: unknown, depth: number): string {
  if (depth > 16) throw new Error("canonicalize: nesting too deep");
  if (v === null) return "null";
  switch (typeof v) {
    case "boolean":
      return v ? "true" : "false";
    case "number":
      if (!Number.isFinite(v)) throw new Error("canonicalize: non-finite number");
      if (Object.is(v, -0)) return "0";
      return JSON.stringify(v);
    case "string":
      return JSON.stringify(v);
    case "object": {
      if (Array.isArray(v)) return "[" + v.map((x) => enc(x, depth + 1)).join(",") + "]";
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new Error("canonicalize: only plain objects");
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o).sort();
      const parts: string[] = [];
      for (const k of keys) {
        if (o[k] === undefined) throw new Error(`canonicalize: undefined at key "${k}"`);
        parts.push(JSON.stringify(k) + ":" + enc(o[k], depth + 1));
      }
      return "{" + parts.join(",") + "}";
    }
    default:
      throw new Error(`canonicalize: unsupported type ${typeof v}`);
  }
}
