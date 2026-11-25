/** Load team accounts from .env mnemonics. Secrets stay in memory; only addresses are ever printed. */
import "./env.ts";
import { deriveUnifiedAccount, type UnifiedAccount } from "@qorechain/sdk";

export type Role = "OWNER" | "SENTINEL" | "RELAYER";
export const ROLES: Role[] = ["OWNER", "SENTINEL", "RELAYER"];

export async function loadAccount(role: Role): Promise<UnifiedAccount> {
  const m = process.env[`${role}_MNEMONIC`];
  if (!m) throw new Error(`${role}_MNEMONIC missing in .env (run setup/gen-accounts.ts)`);
  return deriveUnifiedAccount(m.trim());
}
