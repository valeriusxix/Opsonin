/** Load the repo-root .env regardless of cwd. Import this before reading process.env. */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(import.meta.dirname, "../../.env"), quiet: true });
