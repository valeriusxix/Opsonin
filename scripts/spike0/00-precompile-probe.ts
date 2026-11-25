/**
 * Spike 0 / probe: are the PQC precompiles live on qorechain-diana, and what do they return?
 * Read-only (eth_call). Needs no funded account and no secrets.
 *
 *   pnpm --filter @opsonin/scripts exec tsx spike0/00-precompile-probe.ts
 */
import { generatePqcKeypair, pqcSign, pqcVerify as sdkVerify, NETWORKS } from "@qorechain/sdk";
import { createPublicClient, http, encodeFunctionData, decodeAbiParameters, toHex, type Hex } from "viem";

const net = NETWORKS.testnet;
const client = createPublicClient({ transport: http(net.endpoints.evmRpc) });

const PQC_VERIFY = "0x0000000000000000000000000000000000000a01" as const;
const PQC_KEY_STATUS = "0x0000000000000000000000000000000000000a02" as const;

const abi = [
  { type: "function", name: "pqcVerify", stateMutability: "view",
    inputs: [{ name: "pubkey", type: "bytes" }, { name: "signature", type: "bytes" }, { name: "message", type: "bytes" }],
    outputs: [{ name: "valid", type: "bool" }] },
  { type: "function", name: "pqcKeyStatus", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [] },
] as const;

async function raw(to: Hex, data: Hex): Promise<{ ok: boolean; data?: Hex; err?: string }> {
  try {
    const r = await client.call({ to, data });
    return { ok: true, data: r.data ?? "0x" };
  } catch (e) {
    return { ok: false, err: (e as Error).message.split("\n").slice(0, 3).join(" | ") };
  }
}

async function main() {
  console.log("chainId", await client.getChainId(), "block", await client.getBlockNumber());

  // 1) pqcKeyStatus on an address that surely has no key
  const ks = await raw(PQC_KEY_STATUS, encodeFunctionData({ abi, functionName: "pqcKeyStatus", args: ["0x000000000000000000000000000000000000dEaD"] }));
  console.log("pqcKeyStatus(0xdead):", ks.ok ? `len=${(ks.data!.length - 2) / 2} data=${ks.data!.slice(0, 260)}` : ks.err);

  // 2) pqcVerify with a fresh SDK keypair: valid, tampered message, tampered sig
  const kp = generatePqcKeypair();
  const msg = new TextEncoder().encode("opsonin spike0 probe");
  const sig = pqcSign(kp.secretKey, msg);
  console.log("sizes pk/sig", kp.publicKey.length, sig.length, "sdk local verify:", sdkVerify(kp.publicKey, msg, sig));

  const cases: Array<[string, Uint8Array, Uint8Array]> = [
    ["valid", msg, sig],
    ["tampered-msg", new TextEncoder().encode("opsonin spike0 probX"), sig],
    ["tampered-sig", msg, Uint8Array.from(sig, (b, i) => (i === 10 ? b ^ 1 : b))],
  ];
  for (const [name, m, s] of cases) {
    const data = encodeFunctionData({ abi, functionName: "pqcVerify", args: [toHex(kp.publicKey), toHex(s), toHex(m)] });
    const r = await raw(PQC_VERIFY, data);
    let decoded = "n/a";
    if (r.ok && r.data && r.data.length >= 66) decoded = String(decodeAbiParameters([{ type: "bool" }], r.data)[0]);
    const gas = await client.estimateGas({ to: PQC_VERIFY, data }).catch((e: Error) => "estimate failed: " + e.message.split("\n")[0]);
    console.log(`pqcVerify ${name}:`, r.ok ? `raw=${r.data!.slice(0, 70)} decoded=${decoded}` : r.err, "gas:", String(gas));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
