/** Spike 0: raw JSON-RPC error for a tx to a target outside the scoped window (viem hides it). */
import { loadAccount } from "../lib/accounts.ts";
import { pub, wallet, feeParams, freshNonce } from "../lib/evm.ts";
import { chain } from "../lib/chain.ts";
import { classifyEvmWindowRejection } from "@qorechain/sdk";
const owner = await loadAccount("OWNER");
const relayer = await loadAccount("RELAYER");
const w = wallet(owner);
const req = await w.prepareTransactionRequest({ to: relayer.evm as `0x${string}`, value: 0n, gas: 21_000n, nonce: await freshNonce(owner), ...(await feeParams()) });
const raw = await w.signTransaction(req as any);
const r = await fetch(chain.evmRpc, { method: "POST", headers: { "content-type": "application/json", "user-agent": "opsonin-scripts/0.1" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [raw] }) });
const j = (await r.json()) as { error?: { message?: string } };
console.log("raw response:", JSON.stringify(j));
console.log("classifyEvmWindowRejection(raw error):", classifyEvmWindowRejection(j.error?.message ?? j));
void pub;
process.exit(0);
