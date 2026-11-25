/**
 * Native (Cosmos) lane helpers for eth-native unified accounts.
 * Registration is classical (bootstrap-exempt); everything else is hybrid (secp256k1 + ML-DSA-87).
 */
import { StargateClient } from "@cosmjs/stargate";
import {
  EthNativeSigner,
  buildRegisterPqcKeyMsg,
  signProofOfPossession,
  fetchPqcStatus,
  type UnifiedAccount,
  type EncodeObject,
  type StdFee,
} from "@qorechain/sdk";
import { hexToBytes } from "viem";
import { chain } from "./chain.ts";

const UA = { "user-agent": "opsonin-scripts/0.1" };

export async function getJson<T = any>(path: string): Promise<T> {
  const r = await fetch(chain.rest + path, { headers: UA });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text().catch(() => "")}`);
  return (await r.json()) as T;
}

export async function balanceUqor(addr: string): Promise<bigint> {
  const j = await getJson<{ balance?: { amount: string } }>(`/cosmos/bank/v1beta1/balances/${addr}/by_denom?denom=${chain.denom}`);
  return BigInt(j.balance?.amount ?? "0");
}

/** account_number + sequence. Returns undefined if the account does not exist on chain yet. */
export async function accountSeq(addr: string): Promise<{ accountNumber: bigint; sequence: bigint } | undefined> {
  try {
    const j = await getJson<any>(`/cosmos/auth/v1beta1/accounts/${addr}`);
    const a = j.account?.base_account ?? j.account;
    return { accountNumber: BigInt(a.account_number ?? 0), sequence: BigInt(a.sequence ?? 0) };
  } catch (e) {
    if (String(e).includes("404") || String(e).includes("not found")) return undefined;
    throw e;
  }
}

export function fee(gas: number): StdFee {
  // 0.15 uqor/gas is the SDK DEFAULT_GAS_PRICE; round up.
  return { amount: [{ denom: chain.denom, amount: String(Math.ceil(gas * 0.15)) }], gas: String(gas) };
}

let transport: StargateClient | undefined;
export async function getTransport() {
  return (transport ??= await StargateClient.connect(chain.rpc));
}

export type TxOut = { transactionHash: string; code: number; height?: number; gasUsed?: bigint; rawLog?: string };

export async function sendNative(acct: UnifiedAccount, messages: EncodeObject[], gas: number, mode: "hybrid" | "classical" = "hybrid"): Promise<TxOut> {
  const seq = await accountSeq(acct.cosmos);
  if (!seq) throw new Error(`account ${acct.cosmos} not found on chain (unfunded?)`);
  const signer = new EthNativeSigner(acct, { signMode: mode, rest: chain.rest });
  const res = await signer.signAndBroadcast(await getTransport(), {
    chainId: chain.chainId,
    accountNumber: seq.accountNumber,
    sequence: seq.sequence,
    messages,
    fee: fee(gas),
  });
  return res;
}

export async function pqcStatus(acct: UnifiedAccount) {
  return fetchPqcStatus({ rest: chain.rest, address: acct.cosmos });
}

/** Register the account's ML-DSA-87 key WITH proof of possession (possessionProven must be true; it cannot be added later). */
export async function registerPqc(acct: UnifiedAccount): Promise<TxOut> {
  const proofOfPossession = signProofOfPossession({ chainId: chain.chainId, account: acct.cosmos, algorithmId: 1, keypair: acct.pqc });
  const m = buildRegisterPqcKeyMsg(acct.cosmos, {
    pqcKeypair: acct.pqc,
    ecdsaPubkey: hexToBytes(acct.publicKey as `0x${string}`),
    keyType: "hybrid",
    proofOfPossession,
  });
  return sendNative(acct, [m], 600_000, "classical");
}

export function explorerTx(hash: string) {
  return `https://explore.qore.network/tx/${hash}`; // [VERIFY] explorer path format
}
