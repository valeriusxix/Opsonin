/**
 * Spike 0 / criteria 2, 3 (in-window) and 4. Needs OWNER funded + registered (01-register.ts).
 *
 *  a) open UNSCOPED window (hybrid-signed Cosmos tx  -> criterion 4 hash)
 *  b) read nonce -> deploy Spike0 with viem on chain 9800
 *  c) open SCOPED window allowed_targets=[Spike0]
 *  d) call ping(); call checkAndRecord(owner, sig, msg) valid + tampered   (criterion 3 inside window)
 *  e) send to a NON-listed target -> expect refusal; log classifyEvmWindowRejection
 *  f) print the window as the chain reports it
 *
 * Writes public results (hashes, addresses) to docs/spike0/results.json. Never prints secrets.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pqcSign } from "@qorechain/sdk";
import { encodeFunctionData, toHex, parseEventLogs, type Hex, type Abi } from "viem";
import { loadAccount } from "../lib/accounts.ts";
import { pub, wallet, openWindow, windowOf, feeParams, windowCostUqor, freshNonce, describeRejection } from "../lib/evm.ts";
import { pqcStatus } from "../lib/native.ts";

const out: Record<string, unknown> = { network: "qorechain-diana", startedAt: new Date().toISOString() };
const outDir = resolve(import.meta.dirname, "../../docs/spike0");
const save = () => { mkdirSync(outDir, { recursive: true }); writeFileSync(resolve(outDir, "results.json"), JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)); };
const big = (o: unknown) => JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v));

const art = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../contracts/out/Spike0.sol/Spike0.json"), "utf8"));
const abi = art.abi as Abi;

const owner = await loadAccount("OWNER");
const relayer = await loadAccount("RELAYER");
out.owner = { cosmos: owner.cosmos, evm: owner.evm };
if (!(await pqcStatus(owner) as any).registered) throw new Error("OWNER not registered: run 01-register.ts first");
const w = wallet(owner);
const fp = await feeParams();
console.log("fee params", big(fp));

// a) unscoped window sized for one deploy + slack
const deployData = art.bytecode.object as Hex;
const deployGas = ((await pub.estimateGas({ account: owner.evm as Hex, data: deployData }).catch(() => 1_500_000n)) * 13n) / 10n;
const unscopedBudget = windowCostUqor(deployGas, fp.maxFeePerGas) * 2n + 100_000n;
const wa = await openWindow(owner, { blocks: 600, maxTxs: 2, maxValueUqor: unscopedBudget });
out.hybridTx_openUnscopedWindow = wa.transactionHash;
console.log(`a) unscoped window opened (HYBRID tx) ${wa.transactionHash} height=${wa.height} budget=${unscopedBudget} uqor`);
save();

// b) nonce AFTER opening, then deploy
await new Promise((r) => setTimeout(r, 2500));
const nonce = await freshNonce(owner);
const deployHash = await w.sendTransaction({ data: deployData, gas: deployGas, nonce, ...fp });
const rcpt = await pub.waitForTransactionReceipt({ hash: deployHash });
out.deploy = { tx: deployHash, contract: rcpt.contractAddress, status: rcpt.status, gasUsed: rcpt.gasUsed };
console.log(`b) Spike0 deployed ${rcpt.contractAddress} tx=${deployHash} status=${rcpt.status} gas=${rcpt.gasUsed}`);
save();
const spike = rcpt.contractAddress as Hex;

// c) scoped window: only Spike0
const scopedBudget = 3_000_000n; // 3 QOR of value+max-fee across <= 6 txs
const wc = await openWindow(owner, { blocks: 600, maxTxs: 6, maxValueUqor: scopedBudget, allowedTargets: [spike] });
out.hybridTx_openScopedWindow = wc.transactionHash;
console.log(`c) scoped window opened ${wc.transactionHash}; window=`, big(await windowOf(owner)));
save();
await new Promise((r) => setTimeout(r, 2500));

async function send(to: Hex, data: Hex, label: string) {
  const gas = ((await pub.estimateGas({ account: owner.evm as Hex, to, data }).catch(() => 1_000_000n)) * 13n) / 10n;
  const nonce = await freshNonce(owner);
  const hash = await w.sendTransaction({ to, data, gas, nonce, ...fp });
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`   ${label}: tx=${hash} status=${r.status} gas=${r.gasUsed}`);
  return r;
}

// d) calls inside the scoped window
const r1 = await send(spike, encodeFunctionData({ abi, functionName: "ping" }), "ping");
const msg = new TextEncoder().encode(`FLEET_RELEASE_V1|spike0|${spike}|${Date.now()}`);
const sig = pqcSign(owner.pqc.secretKey, msg);
const r2 = await send(spike, encodeFunctionData({ abi, functionName: "checkAndRecord", args: [owner.evm, toHex(sig), toHex(msg)] }), "checkAndRecord(valid)");
const bad = new Uint8Array(msg); bad[0] ^= 1;
const r3 = await send(spike, encodeFunctionData({ abi, functionName: "checkAndRecord", args: [owner.evm, toHex(sig), toHex(bad)] }), "checkAndRecord(tampered)");
const ev = (r: typeof r2) => (parseEventLogs({ abi, logs: r.logs, eventName: "Checked" })[0] as any)?.args?.valid;
out.inWindow = { ping: r1.transactionHash, validTx: r2.transactionHash, validResult: ev(r2), tamperedTx: r3.transactionHash, tamperedResult: ev(r3), gasCheckAndRecord: r2.gasUsed };
console.log(`d) in-window pqcVerify: valid=${ev(r2)} tampered=${ev(r3)}`);
save();

// e) non-listed target must be refused
try {
  const nonce = await freshNonce(owner);
  const h = await w.sendTransaction({ to: relayer.evm as Hex, value: 0n, gas: 21_000n, nonce, ...fp });
  out.nonListed = { unexpectedlyAdmitted: h };
  console.log("e) UNEXPECTED: non-listed target admitted", h);
} catch (e) {
  out.nonListed = describeRejection(e);
  console.log("e) non-listed target refused:", big(out.nonListed));
}

// f) window as reported
out.windowAfter = await windowOf(owner);
console.log("f) window after:", big(out.windowAfter));
save();
const pass = rcpt.status === "success" && ev(r2) === true && ev(r3) === false && !(out.nonListed as any).unexpectedlyAdmitted;
console.log(pass ? "\nSPIKE 0 criteria 2-4: PASS" : "\nSPIKE 0 criteria 2-4: FAIL (see above)");
process.exit(pass ? 0 : 1);
