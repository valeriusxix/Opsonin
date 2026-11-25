# CHAIN_NOTES: verified QoreChain facts

Source tags: **[LIVE]** = run by us against `qorechain-diana` (date) · **[SDK]** = `@qorechain/sdk` / `@qorechain/evm` 0.14.0 typings and runtime constants · **[DOCS]** = docs.qorechain.io page (path given) · **[FEST]** = build.qorechain.io · **[OPEN]** = not yet confirmed.
D = `https://docs.qorechain.io`. Last updated: 25 Nov 2026.

## Network

| Fact | Value | Source |
|---|---|---|
| Cosmos chain ID | `qorechain-diana` | [LIVE] node_info.network · [SDK] `NETWORKS.testnet.chainId` |
| EVM chain ID | 9800 (`0x2648`) | [LIVE] `eth_chainId` · [SDK] |
| Mainnet | `qorechain-vladi` / 9801 | [SDK] · [DOCS] D/appendix/networks |
| EVM JSON-RPC | `https://evm-testnet.qore.host` | [LIVE] · [SDK] `PUBLIC_ENDPOINTS` |
| EVM WS | `wss://evm-ws-testnet.qore.host` (testnet only; mainnet has none) | [SDK] |
| Consensus RPC | `https://rpc-testnet.qore.host` (CometBFT 0.38.26) | [LIVE] `/status` |
| REST (LCD) | `https://api-testnet.qore.host` | [LIVE] |
| Explorer | `https://explore.qore.network` (toggle Testnet). Tx URL path format **[OPEN]**. No source verification | [DOCS] D/appendix/networks |
| Faucet | dashboard.qorechain.io/faucet, sign-in, **100 QOR / 24 h per account and per address**, accepts `qor1…` only. No programmatic faucet (SDK `faucetUrl` undefined) | [DOCS] D/dashboard/faucet · [SDK] |
| Token | QOR; `uqor` 6 decimals on Cosmos; EVM 18 decimals (`aqor`), 1 uqor = 10^12 wei | [SDK] coin · [DOCS] D/appendix/networks |
| Gas price (25 Nov) | `eth_gasPrice` = 112.5 gwei; SDK `DEFAULT_GAS_PRICE` 0.15uqor, floor 0.1 | [LIVE] · [SDK] |
| Block time | ~1.03 s testnet, ~3.1 s mainnet → 17,280 blocks ≈ 5 h testnet | [SDK] README |
| Versions | testnet v3.2.9 (h 10,424,000, 20 Nov), mainnet v3.2.8 | [DOCS] |
| Resets | none since 1 Jul 2026 | [DOCS] |
| Public endpoint limits | 1,200 req / 60 s / IP then 60 s block; `eth_getLogs` ≤ 10,000 blocks; no debug/trace. Send a User-Agent (some clients get 403 without) | [DOCS] |
| EVM limits | `tx_max_gas` 30,000,000; `precompile_input_max_bytes` 16,384 | [DOCS] · [SDK] `EVM_TX_MAX_GAS_DEFAULT` |
| VMs | EVM live. CosmWasm upload disabled (instantiate of governance codes only). SVM lane opened on testnet by prop 37 but public gateway refuses `sendTransaction`; off on mainnet. We use EVM only | [DOCS] |

## Accounts and keys

- Use **eth-native unified accounts** (`deriveUnifiedAccount(mnemonic)`, HD `m/44'/60'/0'/0/i`, `eth_secp256k1`). One 20-byte identity = `qor1…` = `0x…`; same balance. Coin-118 accounts cannot use an EVM window. [SDK] · [DOCS]
- The PQC key of a mnemonic account is derived as `shake256("qorechain:pqc:v1|" + qor1addr + "|" + mnemonic, 32)`. **The classical private key alone cannot produce it.** (This is what makes "stolen classical key" a real, weaker attacker.) [SDK]
- **First tx of a new account must be the key registration** (`MsgRegisterPQCKeyV2`, classical-signed, bootstrap-exempt). A second registration is refused **after charging the fee**. ~0.09 QOR. [DOCS] · [SDK]
- **Proof of possession must be sent at registration.** It is optional on chain, but `possessionProven` is true only if it was verified, and a key the account has used before cannot be registered again (code 232). We always register with `signProofOfPossession` (domain `qorechain-pqc-pop-v1|<chain>|<alg>|<addr>|<pubhex>`). [DOCS] · [SDK]
- ML-DSA-87 sizes: pk 2592, sk 4896, sig 4627. [SDK constants]
- Rotating/migrating/re-registering the PQC key **closes the EVM window** and deletes EIP-7702 consent. [SDK] · [DOCS]

## Precompiles

| | Address | Gas | Source |
|---|---|---|---|
| `pqcVerify(bytes pubkey, bytes signature, bytes message) → bool` | `0x…0a01` | 25,000 + 8/byte | [DOCS] D/developer-guide/evm-precompiles · [SDK] ABI |
| `pqcKeyStatus(address) → (bool registered, uint8 algorithmId, bytes pubkey, bool possessionProven)` | `0x…0a02` | 2,500 | [DOCS] · [LIVE] raw return = 4 head words + bytes |

- Active on testnet since prop 21 (27 Oct 2026). **Not active on mainnet.** [DOCS]
- **No algorithm argument**: ML-DSA-87 only. [DOCS] · [SDK]
- **`pqcVerify` verifies the RAW message bytes.** SDK `pqcSign(sk, msg)` adds no prefix (deterministic by default). [LIVE 25 Nov]: direct eth_call valid→`true`, tampered msg→`false`, tampered sig→`false`; ~311k gas per direct call with real sizes (mostly calldata). The `qorechain-msg-v1|<chain>|` prefix belongs to QoreX `signArbitrary`, not `pqcSign`. [DOCS] D/qoresign/spec/message-signing-v1
- **From contract context it works** [LIVE 25 Nov, `spike0/02b-ctor-probe.ts`: eth_call contract creation, valid→1, tampered→0].
- **GOTCHA [LIVE]: `eth_call` with a `stateOverride` sees the precompiles as inactive** (staticcall ok, `0x`). Never test precompile paths with overrides. `spike0/02a-override-gotcha.ts` reproduces it.
- Inactive precompile returns `0x` without reverting → low-level staticcall + length check (our `QorePQC.sol`). The `@qorechain/evm` ABI lists only 3 outputs for `pqcKeyStatus` (drops `possessionProven`); do not use that ABI for trust decisions.
- SDK `pqcVerify(publicKey, message, signature)` has a **different argument order** from the precompile `(pubkey, signature, message)`.
- Write precompile addresses lowercase in Solidity. [DOCS]

## EVM authorisation window

- Type URLs `/qorechain.pqc.v1.MsgOpenEVMWindow`, `/qorechain.pqc.v1.MsgCloseEVMWindow`. Hybrid-signed Cosmos tx. [SDK] · [DOCS] D/developer-guide/evm-window-reference
- **Opening advances the nonce** (Cosmos sequence = EVM nonce). Order: open → read nonce → sign. Replaces any existing window. [SDK] · [DOCS]
- Bounds: `blocks` 1–17,280; `maxTxs` 1–1,000; `maxValue` > 0 uqor = value **+ gasLimit × maxFeePerGas** of every admitted tx (wei→uqor rounds up; `evmWindowCost`). [SDK] · [DOCS]
- Scope: `nativeOnly`; `allowedTargets` ≤ 16, **refuses contract creation**; v3.2.8 adds `validators`, `stakingValidators`, `ibcReceivers` (each ≤ 16). Standard precompile methods are deny-by-default through a window. [SDK] · [DOCS]
- `allowedTargets` is checked against the **tx recipient only**; calls a contract makes to `0x…0a01/0a02` are not checked, so do not list them. [FEST] build.qorechain.io/faq · **[LIVE pending: spike0/03]**
- Failed/reverted txs still consume a slot and budget. Errors (codespace `pqc`): 26 no window / no PQC key, 27 exhausted, 28 invalid bounds, 62 delegated account. SDK `classifyEvmWindowRejection` → `"no-pqc-key" | "no-window" | "exhausted" | "invalid"`. [DOCS] · [SDK]
- Query: `GET /qorechain/pqc/v1/evm_window/{address}`; SDK `fetchEvmWindow({ rest, address })` → `{found, live, remainingBlocks, remainingTxs, remainingValue, allowedTargets, …}` (bigint). [SDK]
- SDK never auto-opens a window (by design). [SDK]

## Hybrid Cosmos-lane signing

- v2 sign-bytes: `"qorechain-pqc-hybrid-v2" ‖ BE64(len chainId) ‖ chainId ‖ BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A`; testnet is on v2 (since v3.1.98). Extension `/qorechain.pqc.v1.PQCHybridSignature {algorithm_id=1, pqc_signature, pqc_public_key}`. [SDK] README · [DOCS] D/qoresign/spec/hybrid-signing-v1
- We use `EthNativeSigner(account, { rest, signMode })` with a cosmjs `StargateClient` as transport; it resolves v1/v2 and retries once on `pqc` code 21. [SDK]
- **Every `MsgOpenEVMWindow` we send is a hybrid-signed tx** → satisfies the "hybrid-signed tx" requirement with a real hash.

## Account abstraction (smart-account spending rules)

- Testnet only (prop 18), disabled on mainnet. `MsgUpdateSpendingRules{daily_limit, per_tx_limit, allowed_denoms, allowed_evm_calls, denom_limits}`, `MsgRegisterAuthenticator` (possession proof from v3.2.8), `MsgExecuteEVM` / `MsgExecuteCosmos`. SDK: `abstractaccount`, `fetchSpendingRules`, `validateSpendingRules`. [DOCS] D/developer-guide/account-abstraction · [SDK]
- `MsgExecuteEVM` executions **do not need or consume an EVM window**; an agent cannot open/renew the owner's window. A refused `MsgExecuteEVM` returns code 0 with `success=false` and burns the nonce: check event `abstractaccount_execution_failed`. Linked keys expire ≤ 30 days. [DOCS] · [FEST]
- **[OPEN]** exact msg shapes for our sentinel; decide after Spike 0 whether the sentinel runs (a) as an EOA in a scoped window, (b) as an authenticator on an abstract account with `allowed_evm_calls=[FleetRegistry.quarantine]`, or both (preferred: both, to show both rubric lines).

## Event / rules ([FEST], build.qorechain.io/rules, /prizes, /start, /faq)

- Deadline 2 Dec 2026 23:59 UTC. MIT or Apache-2.0, README, video ≤ 3 min, ≥ 1 `qor1` testnet address. Cover image 16:9 ≥ 1200×675, JPG/PNG/WebP ≤ 5 MB (/start says optional, /rules says required → provide one).
- Hybrid-signed tx is formally required only for the **Quantum Pass**; we show one anyway.
- AI Agents track: scoped EVM window (tx/value/duration/target limits), smart-account spending rules, authenticated messaging. Top prize $1,500. PQ dApps track: scoped window, `pqcVerify`, two-stage QCAI audit, Foundry/Hardhat tests.
- Rubric weights: works as described 25 %, QoreChain tech 25 %, PQ correctness 20 %, originality 15 %, clarity/UX/docs 15 %.
- Checks 3–5 Dec; finalists may get a 48 h change request; judging + People's Choice 6–15 Dec; winners 16 Dec; payouts 17–22 Dec.
- Best AI-Native needs an **`AI_USAGE.md`**. Top-Quality ≥ 70/100, only for non-winners. People's Choice: QoreX vote on mainnet. **Q-Day Survivor is closed** (drill was 18 Nov).
- Audit evidence: QCAI reports in `docs/audit/` + `docs/AUDIT.md`.
- Follow-on grants paid in QOR against milestones from January 2027.

## Spike 0 status (25 Nov)

| Criterion | Status |
|---|---|
| 1 funded + registered + `registered && possessionProven` | script ready (`spike0/01-register.ts`); **blocked on faucet** |
| 2 unscoped window → deploy → scoped window → call; non-listed refused | script ready (`spike0/03-window-deploy.ts`); blocked on 1 |
| 3 `pqcVerify` from Solidity valid/tampered | **PASS read-only** (contract context, no override). In-window tx part in `03` |
| 4 hybrid-signed tx hash | comes from `03` (window open) |
