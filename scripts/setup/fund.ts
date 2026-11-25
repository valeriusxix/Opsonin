/**
 * Distribute QOR from OWNER to SENTINEL and RELAYER (hybrid-signed bank sends).
 * OWNER must already be registered: on testnet a new account's FIRST tx must be its key registration.
 *
 *   npx tsx setup/fund.ts [sentinelQOR=30] [relayerQOR=10]
 */
import { loadAccount } from "../lib/accounts.ts";
import { balanceUqor, pqcStatus, sendNative } from "../lib/native.ts";
import { chain } from "../lib/chain.ts";

const [s = "30", r = "10"] = process.argv.slice(2);
const owner = await loadAccount("OWNER");
if (!(await pqcStatus(owner) as any).registered) throw new Error("register OWNER first (spike0/01-register.ts)");
for (const [role, qor] of [["SENTINEL", s], ["RELAYER", r]] as const) {
  const to = await loadAccount(role);
  const amount = String(BigInt(Math.round(Number(qor) * 1e6)));
  const res = await sendNative(owner, [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: owner.cosmos, toAddress: to.cosmos, amount: [{ denom: chain.denom, amount }] } }], 200_000);
  console.log(`${role}: sent ${qor} QOR tx=${res.transactionHash} code=${res.code}`);
}
console.log("OWNER balance now", Number(await balanceUqor(owner.cosmos)) / 1e6, "QOR");
process.exit(0);
