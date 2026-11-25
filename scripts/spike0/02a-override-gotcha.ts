/**
 * Spike 0 GOTCHA record: eth_call with a stateOverride (code placed at a scratch address) sees the
 * PQC precompiles as INACTIVE (staticcall ok=true, ret=0x), so this prints FAIL. Real contract
 * context works: see 02b-ctor-probe.ts. Do not use state overrides to test precompile paths.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generatePqcKeypair, pqcSign } from "@qorechain/sdk";
import { createPublicClient, http, encodeFunctionData, decodeFunctionResult, toHex, type Hex, type Abi } from "viem";
import { chain } from "../lib/chain.ts";

const art = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../contracts/out/Spike0.sol/Spike0.json"), "utf8"));
const abi = art.abi as Abi;
const code = art.deployedBytecode.object as Hex;
const at = "0x00000000000000000000000000000000005b1ce0" as const;
const pub = createPublicClient({ transport: http(chain.evmRpc) });

async function call(fn: string, args: unknown[]) {
  const data = encodeFunctionData({ abi, functionName: fn, args });
  const r = await pub.call({ to: at, data, stateOverride: [{ address: at, code }] });
  const gas = await pub.estimateGas({ to: at, data, stateOverride: [{ address: at, code }] } as any).catch(() => undefined);
  return { v: decodeFunctionResult({ abi, functionName: fn, data: r.data! }), gas };
}

const kp = generatePqcKeypair();
const msg = new TextEncoder().encode("FLEET_RELEASE_V1|spike0|readonly");
const sig = pqcSign(kp.secretKey, msg);
const bad = new TextEncoder().encode("FLEET_RELEASE_V1|spike0|readonlX");

const r1 = await call("check", [toHex(kp.publicKey), toHex(sig), toHex(msg)]);
const r2 = await call("check", [toHex(kp.publicKey), toHex(sig), toHex(bad)]);
const r3 = await call("trustedKeyLen", ["0x000000000000000000000000000000000000dEaD"]);
console.log("Solidity check(valid)    =", r1.v, "gas", r1.gas);
console.log("Solidity check(tampered) =", r2.v, "gas", r2.gas);
console.log("trustedKeyLen(0xdead)    =", r3.v, "(expect 0)");
const pass = r1.v === true && r2.v === false && r3.v === 0n;
console.log(pass ? "PASS: pqcVerify from Solidity on qorechain-diana accepts SDK pqcSign over raw bytes" : "FAIL");
process.exit(pass ? 0 : 1);
