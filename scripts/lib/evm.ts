/** EVM lane helpers: windows, nonce ordering, fee-bounded sends. */
import { createPublicClient, createWalletClient, defineChain, http, type Hex, type Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { openEvmWindowMsg, fetchEvmWindow, classifyEvmWindowRejection, type UnifiedAccount } from "@qorechain/sdk";
import { evmWindowCost } from "@qorechain/evm/window";
import { chain } from "./chain.ts";
import { sendNative, type TxOut } from "./native.ts";

export const evmChain = defineChain({
  id: chain.evmChainId,
  name: "QoreChain Testnet",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [chain.evmRpc], ...(chain.evmWs ? { webSocket: [chain.evmWs] } : {}) } },
  testnet: true,
});

export const pub = createPublicClient({ chain: evmChain, transport: http(chain.evmRpc) });
export const wallet = (a: UnifiedAccount) =>
  createWalletClient({ chain: evmChain, account: privateKeyToAccount(a.privateKey as Hex), transport: http(chain.evmRpc) });

/** Hybrid-signed MsgOpenEVMWindow. Replaces any existing window and ADVANCES the nonce. */
export async function openWindow(a: UnifiedAccount, p: { blocks: number; maxTxs: number; maxValueUqor: bigint; allowedTargets?: string[] }): Promise<TxOut> {
  const m = openEvmWindowMsg({
    sender: a.cosmos,
    blocks: p.blocks,
    maxTxs: p.maxTxs,
    maxValue: p.maxValueUqor.toString(),
    ...(p.allowedTargets ? { allowedTargets: p.allowedTargets } : {}),
  });
  const res = await sendNative(a, [m], 300_000, "hybrid");
  if (res.code !== 0) throw new Error(`open window failed code=${res.code} ${res.rawLog}`);
  return res;
}

export const windowOf = (a: UnifiedAccount) => fetchEvmWindow({ rest: chain.rest, address: a.cosmos });

/** Fee params we always set explicitly, so the window cost is predictable. */
export async function feeParams() {
  const gp = await pub.getGasPrice();
  return { maxFeePerGas: gp * 2n, maxPriorityFeePerGas: gp / 10n };
}

export function windowCostUqor(gas: bigint, maxFeePerGas: bigint, value = 0n) {
  return evmWindowCost({ gas, maxFeePerGas, value });
}

/** Wait until the account's EVM nonce equals its Cosmos sequence (open window -> read nonce -> sign). */
export async function freshNonce(a: UnifiedAccount) {
  return pub.getTransactionCount({ address: a.evm as Hex, blockTag: "pending" });
}

export function describeRejection(e: unknown) {
  return { kind: classifyEvmWindowRejection(e) ?? "other", message: (e as Error)?.message?.split("\n").slice(0, 3).join(" | ") };
}

export type { Abi };
