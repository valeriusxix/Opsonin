/**
 * Spike 0: pqcVerify from CONTRACT context on the real testnet with no state override,
 * by simulating a contract creation (eth_call without `to`). Read-only, no funds.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generatePqcKeypair, pqcSign } from "@qorechain/sdk";
import { createPublicClient, http, encodeDeployData, decodeAbiParameters, toHex, type Hex } from "viem";
import { chain } from "../lib/chain.ts";

const art = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../contracts/out/CtorProbe.sol/CtorProbe.json"), "utf8"));
const pub = createPublicClient({ transport: http(chain.evmRpc) });
const kp = generatePqcKeypair();
const msg = new TextEncoder().encode("FLEET_RELEASE_V1|spike0|ctor");
const sig = pqcSign(kp.secretKey, msg);
let pass = true;
for (const [name, m, expect] of [["valid", msg, true], ["tampered", new TextEncoder().encode("FLEET_RELEASE_V1|spike0|ctoR"), false]] as const) {
  const data = encodeDeployData({ abi: art.abi, bytecode: art.bytecode.object as Hex, args: [toHex(kp.publicKey), toHex(sig), toHex(m)] });
  const r = await pub.call({ data, account: "0x000000000000000000000000000000000000dEaD" });
  const [ok, ret] = decodeAbiParameters([{ type: "bool" }, { type: "bytes" }], r.data!);
  const val = ret.length === 66 ? BigInt(ret) === 1n : undefined;
  console.log(`${name}: call ok=${ok} ret=${ret.slice(0, 70)} => valid=${val}`);
  if (val !== expect) pass = false;
}
console.log(pass ? "PASS: pqcVerify works from contract context (no override)" : "FAIL");
process.exit(pass ? 0 : 1);
