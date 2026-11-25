/**
 * Create OWNER / SENTINEL / RELAYER mnemonics in the repo-root .env if absent.
 * Prints ONLY public addresses. Never commit .env.
 */
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateMnemonic, deriveUnifiedAccount } from "@qorechain/sdk";
import { ROLES } from "../lib/accounts.ts";

const envPath = resolve(import.meta.dirname, "../../.env");
const cur = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
for (const role of ROLES) {
  const key = `${role}_MNEMONIC`;
  let m = cur.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim();
  if (!m) {
    m = generateMnemonic();
    appendFileSync(envPath, `${cur.endsWith("\n") || cur === "" ? "" : "\n"}${key}=${m}\n`);
  }
  const a = await deriveUnifiedAccount(m);
  console.log(`${role.padEnd(8)} ${a.cosmos}  ${a.evm}`);
}
