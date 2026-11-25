/**
 * Spike 0 / criterion 1: funded account -> ML-DSA-87 key registered with proof of possession
 * -> pqcKeyStatus precompile reports registered && possessionProven.
 *
 *   npx tsx spike0/01-register.ts [OWNER|SENTINEL|RELAYER]   (default: all)
 *
 * Safe to re-run: registration happens only when the chain says the key is absent
 * (a second registration is refused AFTER charging the fee).
 */
import { createPublicClient, http, toFunctionSelector, type Hex } from "viem";
import { loadAccount, ROLES, type Role } from "../lib/accounts.ts";
import { balanceUqor, pqcStatus, registerPqc } from "../lib/native.ts";
import { chain } from "../lib/chain.ts";

const pub = createPublicClient({ transport: http(chain.evmRpc) });

/** Raw pqcKeyStatus: (bool registered, uint8 algId, bytes pubkey, bool possessionProven). Decoded by hand to see every word. */
export async function keyStatusRaw(evm: Hex) {
  const data = (toFunctionSelector("pqcKeyStatus(address)") + evm.slice(2).toLowerCase().padStart(64, "0")) as Hex;
  const r = (await pub.call({ to: "0x0000000000000000000000000000000000000a02", data })).data ?? "0x";
  const w = (i: number) => BigInt("0x" + (r.slice(2 + 64 * i, 2 + 64 * (i + 1)) || "0"));
  const off = Number(w(2));
  const len = Number(BigInt("0x" + r.slice(2 + off * 2, 2 + off * 2 + 64)));
  return { bytes: (r.length - 2) / 2, registered: w(0) === 1n, algorithmId: Number(w(1)), pubkeyLen: len, possessionProven: w(3) === 1n };
}

const roles = (process.argv[2] ? [process.argv[2].toUpperCase()] : ROLES) as Role[];
for (const role of roles) {
  const a = await loadAccount(role);
  const bal = await balanceUqor(a.cosmos);
  let st = await pqcStatus(a);
  console.log(`\n[${role}] ${a.cosmos} ${a.evm}\n  balance ${Number(bal) / 1e6} QOR | rest status registered=${(st as any).registered}`);
  if (!(st as any).registered) {
    if (bal === 0n) { console.log("  UNFUNDED: claim faucet first (dashboard.qorechain.io/faucet) or send QOR from OWNER"); continue; }
    const res = await registerPqc(a);
    console.log(`  register tx ${res.transactionHash} code=${res.code} height=${res.height} gasUsed=${res.gasUsed}`);
    if (res.code !== 0) { console.log("  rawLog:", res.rawLog); continue; }
    await new Promise((r) => setTimeout(r, 3000));
    st = await pqcStatus(a);
  }
  const ks = await keyStatusRaw(a.evm as Hex);
  const ok = ks.registered && ks.possessionProven && ks.pubkeyLen === 2592 && ks.algorithmId === 1;
  console.log(`  precompile: ${JSON.stringify(ks)}  => ${ok ? "PASS" : "FAIL"} (registered && possessionProven && 2592B && alg 1)`);
}
process.exit(0);
