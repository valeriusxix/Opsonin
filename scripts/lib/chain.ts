/** Chain config: read from the SDK preset, overridable by env. Never hard-code chain params elsewhere. */
import "./env.ts";
import { NETWORKS } from "@qorechain/sdk";

const t = NETWORKS.testnet;
export const chain = {
  chainId: process.env.QORE_CHAIN_ID || t.chainId,
  evmChainId: Number(process.env.QORE_EVM_CHAIN_ID || t.evmChainId),
  rest: process.env.QORE_REST || t.endpoints.rest,
  rpc: process.env.QORE_COSMOS_RPC || t.endpoints.rpc,
  evmRpc: process.env.QORE_EVM_RPC || t.endpoints.evmRpc,
  evmWs: process.env.QORE_EVM_WS || t.endpoints.evmWs,
  denom: t.coin.base,
} as const;
