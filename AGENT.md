# AGENT.md — Opsonin: a Fleet Immune System on QoreChain

> Build brief for the coding agent. Read fully before writing code. Facts marked **[G]** came from a third-party summary of the official docs (pasted by the user, 25 Nov) and were **not independently checked by us**. Anything tagged **[VERIFY]** is unconfirmed. Confirm all of them in Spike 0 against docs.qorechain.io and fix this file if wrong. Never invent chain parameters, RPC URLs, or SDK signatures.
> Versions as of late Nov 2026 **[G]**: mainnet v3.2.8, testnet v3.2.9, SDK ≈ 0.14.0. The networks upgrade often, so re-check before each build day.

Product name: **Opsonin** (repo `opsonin`; packages `@opsonin/envelope`, `@opsonin/sentinel`, `@opsonin/sim`). Set in `package.json` and README.
Team: 2 devs. Today = Wed 25 Nov 2026. **Deadline: Wed 2 Dec 2026 23:59 UTC** (= 00:59 Lagos, Thu 3 Dec). Target submission: **Wed 2 Dec by 12:00 UTC**.
Track: **Post-Quantum AI Agents** (secondary fit: PQ dApps). Testnet: `qorechain-diana`.

---

## 1. What we are building (one paragraph)

An **immune system for robot fleets**. Commands to robots are wrapped in PQ-signed **envelopes** (scope, expiry, nonce). A **sentinel** (rules engine plus an LLM that only writes incident reports) watches fleet telemetry and **quarantines** compromised robots by sending a **restrict-only** transaction to an on-chain `FleetRegistry`. A classical or stolen key can only *stop* things. **Release from quarantine requires an ML-DSA-87 signature** from the fleet owner. A browser simulation (3D) shows a worm spreading through a robot fleet, side by side with and without the immune system. Quarantine decisions are real testnet transactions.

**The pitch in one line:** *"A stolen key can only stop robots. Only a post-quantum key can bring them back."*

### Why this design (do not change without reason)
- The chain is **not in the real-time control loop**. Robots and gateways **cache** the quarantine epoch and decide locally. Block time and finality are irrelevant to safety.
- The sentinel is **rules-based**. The LLM writes human-readable incident reports only and never decides.
- The sentinel has **limited authority**: it can quarantine, never release, and is rate-capped per epoch (§5). This is the "agent with a leash" story for the PQ AI Agents track.
- **Two leashes, stated precisely.** (1) *Chain level:* the sentinel account only works inside a **scoped EVM window** (`allowed_targets=[FleetRegistry]`, small `max_txs` / `max_value`, short `blocks`). Opening or extending a window needs a **hybrid (PQ) signature**, so a thief with only the sentinel's classical EVM key cannot widen its powers, and can at most call `quarantine` until the window runs out. (2) *Contract level:* `quarantine` is restrict-only and rate-capped, and `release` needs the owner's ML-DSA-87 signature. Note the sentinel account itself must have a registered PQ key to be admitted on the EVM lane at all **[G]**.

### Honest limits (put these in the README, do not hide them)
1. Robots are **simulated**. No physical hardware in the demo.
2. The worm is **author-modelled**, inspired by public reports (Unitree credential flaws, BLE injection, DDS/ROS 2 unauthenticated topics). It is not a real exploit and we ship no exploit code.
3. On-chain quarantine is **not real-time**. Safety comes from cached epochs and fail-safe defaults.
4. Testnet only. Not audited beyond QCAI. No production-safety claim.
5. "Agent leash" is a crowded category. Our difference is the **restrict-only / PQ-release asymmetry applied to physical fleets**.

---

## 2. Hard constraints and submission checklist

- [ ] Public repo, **MIT or Apache-2.0**, with README, a **featured image (16:9, ≥ 1200×675)**, a **≤3-minute video**, and the **testnet address(es)** **[G]**.
- [ ] **At least one hybrid-signed tx** on `qorechain-diana` (secp256k1 + ML-DSA-87) shown in the README and the video, with a tx hash.
- [ ] Contract deployed on testnet; address in README.
- [ ] QCAI audit run (dashboard.qorechain.io). The PQ dApp category lists a **two-stage QCAI audit** **[G]**; run both stages and keep the contract small so it passes cleanly.
- [ ] Live demo URL (static host: Vercel, Netlify or Cloudflare Pages). It must work on mobile and desktop.
- [ ] README states the honest limits (§1).
- [ ] Timeline **[G]**: checks run 3-5 Dec, then the jury scores against a per-category rubric. Finalists may get a **48-hour change request**, so keep the repo and demo live after submitting. Numeric rubrics are **not public**, so score ourselves against the category lines below.
- [ ] Special awards (People's Choice, Best AI-Native, Top-Quality ≥ 70/100, Q-Day Survivor, etc.) have their own rules. Re-read the event page **[VERIFY]**.

### Rubric lines we must visibly hit (Post-Quantum AI Agents, 1-4 people) **[G]**
| Requirement | Where we satisfy it |
|---|---|
| Scoped EVM window with tx / value / duration / target limits | Sentinel account window: `max_txs`, `max_value`, `blocks`, `allowed_targets=[FleetRegistry]`. Show the window query output in the README and the UI |
| Smart-account spending rules | Sentinel runs as a smart account with a **spending-rule cap** (account-abstraction docs; confirm the exact msg/API in Spike 0 **[VERIFY]**). If it cannot be done, say so in the README |
| Authenticated messaging | PQ-signed command **envelopes** (§5.2) |
Also cover the PQ dApp lines, since we use them anyway: `pqcVerify` in a contract, QCAI two-stage audit, Foundry/Hardhat tests.

---

## 3. QoreChain facts (verified from docs unless tagged)

| Item | Value |
|---|---|
| Testnet | `qorechain-diana` |
| Signatures | Hybrid: **secp256k1 + ML-DSA-87** (required on Cosmos lane). Also ML-KEM-1024, SHAKE-256 |
| VMs | EVM **live**. CosmWasm upload **disabled**. SVM tx lane **disabled**. → **Build on EVM (Solidity).** |
| `pqcVerify` precompile | `0x0000000000000000000000000000000000000a01` (25,000 gas + 8/byte) |
| `pqcKeyStatus` precompile | `0x0000000000000000000000000000000000000a02` (2,500 gas) |
| EVM lane requirement | A **registered ML-DSA key** and an **open EVM authorisation window** (can be scoped) |
| Scoped window | `allowed_targets` (≤ 16), `max_txs`, `max_value`. **Refuses contract creation.** **Opening one changes the nonce.** See the window section below |
| Signed bytes for **Cosmos-lane txs** | v2 hybrid sign-bytes (below). The SDK picks the right form when given the REST endpoint **[G]** |
| Signed bytes for **our own in-contract messages** (release approval) | Our own framing (§5.1). The Conclave example used `"qorechain-msg-v1|qorechain-diana|" + message`. Confirm in Spike 0 that `pqcSign` output passes the `pqcVerify` precompile |
| Cosmos chain ID / EVM chain ID | `qorechain-diana` / **9800 (0x2648)** **[G]** (mainnet: `qorechain-vladi` / 9801) |
| EVM JSON-RPC | `https://evm-testnet.qore.host` **[G]** |
| EVM WebSocket (testnet only) | `wss://evm-ws-testnet.qore.host` **[G]**. Use it to subscribe to `Quarantined` / `Released` events |
| Consensus RPC / REST (LCD) | `https://rpc-testnet.qore.host` / `https://api-testnet.qore.host` **[G]** |
| Explorer | `https://explore.qore.network` (toggle to Testnet) **[G]** |
| Faucet | `https://dashboard.qorechain.io/faucet`: sign-in required, ~100 QOR per address per 24 h, testnet only **[G]**. Claim early and from every team address |
| Native token | QOR. Base `uqor` (6 decimals) on Cosmos. EVM shows 18 decimals (`aqor`) **[G]** |
| Judging | Per-category jury rubric, numbers unpublished. See §2 |

### EVM authorization window **[G]**
- Since v3.2.0, an EVM-lane tx (MetaMask, viem, Hardhat, Foundry) is admitted only if the sender has (1) a registered ML-DSA-87 key and (2) an **open, unexhausted window**.
- **Open:** Cosmos message `/qorechain.pqc.v1.MsgOpenEVMWindow`, **hybrid-signed** by the account (classical alone cannot open one). It **replaces** any existing window and **advances the nonce** (Cosmos sequence = EVM nonce). **Order: open window → read nonce → sign the EVM tx.**
- **Bounds (all required):** `blocks` 1-17,280 (≈ **5-6 h on testnet**, ≈ 15 h mainnet) · `max_txs` 1-1,000 · `max_value` > 0 in `uqor`, counting transferred value **plus** the max fee (gas limit × fee cap) of every admitted tx.
- **Optional scoping:** `native_only`; `allowed_targets` (≤ 16 unique addresses, which also blocks contract creation); later lists `validators`, `staking_validators`, `ibc_receivers` (v3.2.8).
- Any bound reaching zero ends the window. **Failed txs still consume a slot and budget.** Close with `MsgCloseEVMWindow`. Query: `qorechaind query pqc evm-window <addr>` or `GET /qorechain/pqc/v1/evm_window/{address}`.
- Errors (codespace `pqc`): **26** no window / no usable PQ key · **27** exhausted · **28** invalid bounds. The SDK's `classifyEvmWindowRejection` maps them.
- Precompiles and EIP-7702 have **extra rules**, and windows cover classical EVM-lane txs only **[VERIFY how a contract's internal call to `0x…0a01` is treated and whether the precompile address must be in `allowed_targets`]**.
- **Consequences for this build**
  1. **Deploy under an *unscoped* window** (bounds only), because scoped windows refuse contract creation. Then open the **scoped** window for the sentinel (`allowed_targets=[FleetRegistry]`).
  2. Windows last ~5-6 h on testnet, so a hosted always-on sentinel will lose its ability to send. Implement `ensureWindow()` in the sentinel (query → re-open with the sentinel's PQ key when low), and size `max_value` for the *fee* budget of batched quarantines. For recording, open a fresh window right before. For the public demo, degrade to **offline replay** when the window is exhausted.
  3. The owner and any relayer that sends `release` also need a registered key and an open window.
  4. Never put the `max_value` budget near the account balance.

### Precompile interface (from docs)
```solidity
interface IQorePQC {
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external view returns (bool valid);
    function pqcKeyStatus(address account)
        external view returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven);
}
address constant PQC_VERIFY     = 0x0000000000000000000000000000000000000a01;
address constant PQC_KEY_STATUS = 0x0000000000000000000000000000000000000a02;
```
**Gotchas**
- An inactive precompile returns empty data (`0x`) **without reverting**. Use low-level `staticcall` and require `ret.length >= 96` (key status) or a decoded `true` (verify). A high-level call to a dead precompile can fail open, so never trust it blindly.
- Trust a key only if **`registered && possessionProven`**.
- ML-DSA-87 sizes (FIPS 204): public key 2592 B, signature 4627 B. Calldata is large, so budget gas and test with real sizes.

### Key registration (docs)
```bash
qorechaind tx pqc gen-key mypqc
qorechaind tx pqc register-key-v2 dilithium5 <pubkey-hex> hybrid \
  --pqc-key mypqc --from mykey --chain-id qorechain-diana \
  --gas 600000 --fees 60000uqor -y
```

### SDK (≈ 0.14.0) **[G]**, confirm signatures with `npm view` and the package typings
| Package | Use |
|---|---|
| `@qorechain/sdk` | Messages, hybrid signing, queries. `generatePqcKeypair`, `pqcSign`, `pqcVerify`, `ensurePqcRegistered`, `derivePqcCanonical`, `openEvmWindowMsg({ sender, blocks, maxTxs, maxValue, ... })`, `signAndBroadcastHybrid`, `fetchEvmWindow`, `classifyEvmWindowRejection`. **It never auto-opens a window**, so open it explicitly |
| `@qorechain/evm` + `viem` | viem adapter and chain defs `qorechainTestnet`. EVM client factory. `precompiles.pqcKeyStatus(client.publicClient, account)` (from docs) |
| `@qorechain/react` | React hooks / components (optional) |
| Other languages | Python `qorechain-sdk` (`import qorsdk`), Rust, Go, Java exist. We use TypeScript only |
Earlier docs also mentioned `@qorechain/wallet-adapter` (`generateQoreWallet()`, `signHybridEth`) and `migrateToHybrid`. **[VERIFY]** they still exist. Use viem, not ethers, for the EVM side.

### Hybrid sign-bytes for Cosmos-lane txs (v2, both networks) **[G]**
`"qorechain-pqc-hybrid-v2" ‖ BE64(len(chainID)) ‖ chainID ‖ BE32(len(B0)) ‖ B0 ‖ BE32(len(authInfo)) ‖ authInfo` (B0 = TxBody without the PQC extension, lengths big-endian, no final hashing). The ML-DSA-87 signature (4627 B) goes into the `/qorechain.pqc.v1.PQCHybridSignature` extension (`algorithm_id: 1`). The classical signature covers the standard SignDoc. **Do not hand-roll this**: use `signAndBroadcastHybrid`. This matters only to know why the hybrid tx is the one to show the judges.

---

## 4. Spike 0 — Thursday 26 Nov (decides the whole build)

**Goal:** prove the loop end to end before building anything else. **Pass criteria (all):**
1. Create a funded account (faucet), `generatePqcKeypair`, `ensurePqcRegistered` (`pqcKeyStatus` → `registered && possessionProven`).
2. `openEvmWindowMsg` **unscoped** → read nonce → **deploy a trivial contract** with viem or Foundry on chain 9800. Then open a **scoped** window (`allowed_targets=[contract]`) and call it. Confirm a call to a non-listed target is rejected (error 26/27 path) and log what the SDK returns.
3. From Solidity, call `pqcVerify` on a signature produced off-chain by the SDK. It returns `true` for a valid and `false` for a tampered message. **Also confirm this works while the caller is inside a scoped window** (the precompile rules in §3).
4. Send one **hybrid-signed tx** and record the hash.

**If 1-3 fail by Thu night → fallback (decide immediately, no debate):**
- If only `pqcVerify` from Solidity fails: move PQ verification **off-chain**. The owner's release is verified by a relayer and the contract checks `pqcKeyStatus` only. State this honestly in the README.
- If contract deployment fails entirely: pivot to the **Lien registry** idea (same envelope library, simpler state) and tell the user. Do not sink more than the rest of Thursday into debugging chain issues. Ask the QoreChain Discord for help in parallel.

Record every confirmed fact in `docs/CHAIN_NOTES.md` and update §3 of this file.

---

## 5. Architecture

```
/contracts   FleetRegistry.sol (+ Foundry or Hardhat tests)
/packages
  /envelope  TS lib: build, sign (ML-DSA-87), verify, nonce store
  /sentinel  Node service: rules engine, tx sender, LLM report writer
  /sim       Deterministic fleet + worm simulation (runs in a Web Worker)
/apps/web    React + R3F front end (static deploy)
/scripts     deploy, seed-fleet, register-key, replay (re-create state after testnet reset)
/docs        CHAIN_NOTES.md, THREAT_MODEL.md, ROADMAP.md, DEMO_SCRIPT.md
```
Monorepo: pnpm workspaces, TypeScript strict, Vite for web, vitest for TS tests.

### 5.1 `FleetRegistry.sol` (keep it under ~250 lines)

State:
- `address public sentinel;` classical EVM address. **Can only quarantine.**
- `address public owner;` PQ-registered account. Controls enroll, release, `setSentinel`, and cap changes.
- `mapping(bytes32 => Robot) robots;` where `Robot { bool enrolled; bool quarantined; uint64 sinceEpoch; bytes32 reasonHash; }`
- `uint64 public epoch;` increments on **every** state change.
- `uint32 public maxQuarantinePerEpochWindow;` sentinel rate cap: `N` quarantines per `W` blocks. Beyond it, the sentinel call reverts and an owner PQ approval is needed. This stops a hijacked sentinel from DoSing the whole fleet.
- `uint256 public ownerNonce;` for replay protection on PQ-signed owner actions.

Functions:
- `enroll(bytes32[] ids)`: owner only (classical `msg.sender == owner` is fine for enrol).
- `quarantine(bytes32[] ids, bytes32 reasonHash)`: `onlySentinel`, restrict-only, batched to save txs, rate-capped.
- `release(bytes32[] ids, bytes calldata pqSig)`: **anyone may relay**. Authorised only if `pqcVerify(ownerPubkey, pqSig, msg)` is true, where `ownerPubkey` comes from `pqcKeyStatus(owner)` and requires `registered && possessionProven`.
  - `msg = keccak/SHAKE-style hash of: domain "FLEET_RELEASE_V1" ‖ chainId ‖ address(this) ‖ ids ‖ ownerNonce ‖ epoch`. Bind chain, contract and nonce to prevent replay. If the SDK signs a prefixed message (`qorechain-msg-v1|qorechain-diana|…`), reproduce that exact framing **[VERIFY in Spike 0]**.
  - Increment `ownerNonce`. Emit `Released`.
- `setSentinel(address, bytes pqSig)`: PQ-gated rotation (so a stolen sentinel key can be replaced only by the PQ key).
- Views: `isQuarantined(id)`, `fleetState(bytes32[] ids)`, `epoch()`.
- Events: `Enrolled`, `Quarantined(id, epoch, reasonHash)`, `Released(id, epoch)`, `SentinelRotated`.

Invariants to test (property tests): (a) `quarantine` never un-quarantines; (b) `release` fails with a wrong signature, wrong nonce, replay, wrong chain/contract; (c) the sentinel cannot exceed its cap; (d) a dead precompile (empty return) **fails closed**; (e) epoch strictly increases on every change.

### 5.2 Envelope library (`packages/envelope`)
Canonical JSON (sorted keys, no whitespace) → hash → sign.
```ts
type Envelope = {
  v: 1; fleetId: string; robotId: string;
  cmd: string; params: Record<string, unknown>;
  scope: string[];            // command classes this issuer may send, e.g. ["nav","stop"]
  notBefore: number; expiry: number;   // unix seconds, short TTL (≤ 30 s for motion)
  nonce: string;              // 128-bit random, single use
  issuer: string;             // key id
  sig: string;                // ML-DSA-87 (hybrid optional)
}
```
`verify(env, ctx)` rules, **in order, fail closed**: signature valid → issuer key trusted → `cmd ∈ scope` → time window → nonce unseen (store with TTL) → robot not quarantined in **cached epoch** → cache not stale. If the cache is stale beyond `maxStaleSec`: allow only the `stop`/`safe_hold` class and refuse motion.
Safe default: **`stop` is always allowed**, even from quarantined/stale states, because stopping is never the dangerous action.

### 5.3 Sentinel (`packages/sentinel`)
Node service. Holds the sentinel testnet key in an env var (server side only, never in the browser bundle). Consumes the telemetry stream from the sim (WebSocket or in-process for the hosted demo). Rules, each producing a score contribution with a reason code:
- **R1** unsigned or invalid command on a controlled channel
- **R2** nonce replay or expired envelope
- **R3** scope violation (command outside issuer scope)
- **R4** command-rate anomaly (z-score against the robot baseline)
- **R5** lateral contact: peer-to-peer handshake outside the allowed topology (the **worm signature**)
- **R6** firmware hash mismatch vs enrolled hash
- **R7** physical/telemetry inconsistency (reported position vs odometry), modelling the ROS 2 trust gap

Decision: weighted score, threshold with hysteresis, **batch** quarantines every ~2 s into one tx. LLM (Anthropic API, **server side**) turns the reason codes and a short telemetry window into a plain-English incident report. It has no tool access to the chain. If the LLM fails, the report falls back to a template. Never block quarantine on the LLM.
Cap enforced client-side too (mirror the contract's rate cap) and surfaced in the UI as "authority budget", together with the **live window state** (txs left, value left, blocks left, from `fetchEvmWindow`). On error 26/27 the sentinel stops, flags `window exhausted` in the UI, and falls back to offline replay rather than failing silently.
The sentinel account is a smart account with a **spending-rule cap** (rubric line, §2). Its PQ key lives server-side next to its classical key, since opening a window needs a hybrid signature.

### 5.4 Simulation (`packages/sim`)
- Deterministic (seeded PRNG), runs in a **Web Worker**, ~60 robots by default (slider to 300 on desktop).
- Warehouse floor graph; robots do patrol or pick tasks.
- Worm model: infection probability `p` per proximity or peer-link contact per tick, with a configurable dwell time, entry via one "patient zero" robot (button: *Compromise a robot*).
- **A/B mode:** same seed, two worlds side by side (or toggle): *Unprotected* vs *Immune*. Stats: infected count over time, time-to-containment, robots lost, % fleet operational.
- Quarantine in the Immune world is applied when the **real testnet tx confirms** or, for smoothness, the optimistic local state flips on submit and reconciles on confirm. Show both states (pending → confirmed) in the UI. If the chain is unreachable, run in **offline mode** with recorded fixtures and show a visible "offline replay" badge. Never fake a tx hash.
- "Release" flow in the UI: owner signs with the ML-DSA key. In the demo this uses a locally held testnet key; label that clearly. The wallet flow is a roadmap item.

---

## 6. UI / UX

**Visual direction:** biological meets cold industrial. Dark scene, bioluminescent accents. Healthy robots = cool cyan nodes. Infected = hot magenta/amber with a spreading pulse. Quarantined = enclosed in a translucent **membrane shell** (fresnel shader) with a slow breathing glow. "Antibody" particles stream from the sentinel to a threatened robot before the shell closes. Keep the palette to 3-4 colours plus neutrals; avoid purple-gradient/glow slop. Self-host fonts (one display, one mono). The 3D must **explain the idea**: a viewer should grasp "infection spreads, immune response contains it" in 10 seconds with no text.

**Stack (pin exact versions at install with `npm view`, commit the lockfile)**
- `three` (current r18x) with the **WebGLRenderer by default**. It works everywhere, including mobile Safari. WebGPU is supported in all major browsers now, but **do not make it a dependency**: add it only behind a flag after Day 5 if time remains.
- `@react-three/fiber` **v9** (v10 is alpha, so avoid it), `@react-three/drei`, `@react-three/postprocessing` (Bloom + Vignette only), `zustand`, `framer-motion` (UI), Tailwind. `leva` and `r3f-perf` in dev only.
- Robots rendered with **`InstancedMesh`** (one draw call per state class), per-instance colour/attribute updates in a typed array from the worker. No per-robot React components.
- Custom `ShaderMaterial` for the membrane shell and infection pulse. Keep shaders small.
- Models: procedural low-poly, or CC0 glTF (Kenney / Quaternius) compressed with `gltfpack` (meshopt). **Total assets < 2 MB.**

**Performance and mobile rules (acceptance tests, not suggestions)**
- `dpr={[1, 1.5]}` on mobile and `[1, 2]` on desktop. Drei `PerformanceMonitor` to step DPR and bloom down automatically. Target **≥ 50 fps on a mid-range phone, 60 on laptop**.
- `frameloop="demand"` when the sim is paused. Pause rendering when the tab is hidden.
- Auto **low-power mode** (no bloom, no shadows, fewer particles, 100-robot cap) if `hardwareConcurrency ≤ 4`, fps < 40 for 2 s, or `prefers-reduced-motion`. Manual toggle in the HUD.
- No shadows or real-time reflections. Bake the floor look into a texture.
- **Layout:** desktop = 3D canvas full-bleed plus a side HUD panel. Mobile = canvas full-bleed plus a **bottom sheet** (peek / half / full) with the same HUD content. Primary actions (Compromise, Quarantine now, Release, A/B toggle) reachable by one thumb. Touch targets ≥ 44 px, safe-area insets respected, no hover-only affordances. Tap a robot to inspect (ID, state, rule hits, tx hash). One-finger orbit, two-finger pinch zoom, double-tap to reset camera.
- Orientation: works in portrait (default) and landscape. Test at 360×640, 390×844, 768×1024, 1440×900.
- Accessibility: state is never colour-only (also shape/icon/label), the HUD is real DOM (not canvas text), reduced-motion honoured, contrast ≥ 4.5:1.
- WebGL context loss handled (`webglcontextlost` → recoverable overlay). Show a static fallback image with a message if WebGL is unavailable.
- Initial load < 3 s on 4G for the shell, lazy-load the 3D chunk, show a skeleton.

**HUD content:** fleet health ring, infected-over-time sparkline (A/B), sentinel authority budget, live incident feed (LLM report, 2 lines each), tx log with explorer links and pending/confirmed badges, epoch counter, "Chain: online / offline replay" badge.

---

## 7. Plan (dates; Lagos is UTC+1)

| Day | Goal | Exit check |
|---|---|---|
| **Wed 25 Nov** | Repo, monorepo, CI, `.env.example`, wallet + faucet + PQ key registration | Key shows `registered && possessionProven` |
| **Thu 26 Nov** | **Spike 0** (§4) + `CHAIN_NOTES.md`. Start the sim core in parallel (2nd dev) | Pass criteria 1-4 or fallback decision |
| **Fri 27 Nov** | `FleetRegistry` + tests + testnet deploy. Envelope lib + tests | Contract deployed, address in README. Envelope verify tests green |
| **Sat 28 Nov** | Sentinel rules + tx batching. Sim wired to sentinel. First end-to-end: infect → quarantine tx → release tx | One full loop on testnet |
| **Sun 29 Nov** | 3D scene, HUD, mobile bottom sheet, A/B mode, low-power mode | Runs at target fps on a real phone |
| **Mon 30 Nov** | **FEATURE FREEZE.** QCAI audit + fixes. README, threat model, featured image. Offline-replay fixtures recorded | Audit run, no open high findings |
| **Tue 1 Dec** | Record video (≤ 3 min), deploy the demo URL, device testing, bug fixes only | Video exported, URL works on phone + laptop |
| **Wed 2 Dec** | Submit by 12:00 UTC. Buffer for portal or video problems | Submission confirmed |

**Cut order if behind (cut from the top):** LLM reports → 300-robot mode → WebGPU → R7 rule → A/B side-by-side (keep a toggle) → membrane shader (use a plain ring). **Never cut:** the contract, the PQ-gated release, the hybrid-signed tx, the working demo URL, the video.

### Video script (≤ 3:00)
0:00 Hook: one robot is compromised, the worm spreads (Unprotected world). 0:25 Same seed with the immune system: containment in seconds. 0:50 Show the quarantine tx hash. 1:10 The attacker's stolen classical key tries to release and fails. 1:30 Owner releases with an ML-DSA-87 signature and the robot resumes. 1:55 Why it matters: fleet-wide credential and ROS 2/DDS trust problems are documented. 2:20 The honest limits and the roadmap. 2:45 Repo + URL.

---

## 8. Testing and QA
- Foundry or Hardhat: unit and property tests for the invariants in §5.1, including **dead-precompile fails closed** and real-size ML-DSA-87 signatures.
- vitest: envelope verify ordering, replay, expiry, scope, stale-cache behaviour, canonicalisation determinism.
- Sim determinism test: same seed → identical infection curve.
- E2E (Playwright): load on a mobile viewport, compromise → quarantine → release.
- Secrets: no keys in the repo or bundle. `gitleaks` in CI. LLM and sentinel keys server-side only.
- Do not commit exploit code. The worm is a probabilistic model, nothing more.

---

## 9. Continuity plan — keep building after the demo

**Immediately after submission (Dec 3-10)**
- Tag `v0.1.0-demo`. Freeze that branch and keep it deployable.
- **Testnet-reset resilience:** `scripts/replay` must re-deploy, re-enrol, and re-seed from scratch in one command. The UI keeps working in **offline replay** from recorded fixtures if the testnet is reset or retired.
- Open issues from judge/community feedback. Publish `ROADMAP.md`. Add `CONTRIBUTING.md` and a "good first issue" set.

**v0.2 (Dec-Jan): make it real for robotics people**
- **ROS 2 adapter:** an `rclpy`/`rclcpp` node that verifies envelopes on a command topic or action goal and enforces quarantine from the cached epoch. Pair with SROS2 (it secures transport, we add issuer-scoped, revocable, PQ-anchored authority). Demo on a simulator (Gazebo or Webots) before any hardware.
- Signed **firmware attestation** hash check feeding R6.
- Replace the rule thresholds with a **learned baseline per robot** (still rules-gated; the model proposes, the contract caps).

**v0.3 (Q1 2027): hardware pilot**
- One cheap real robot or rover with a gateway on a Raspberry Pi: run the envelope verifier locally, with a real "stop on quarantine" path and a measured **revocation-latency** figure (publish the number honestly).
- Seek one design partner (robotics club, warehouse-automation startup, university lab).

**Funding / ecosystem**
- Apply to any follow-on grants or programmes announced for fest builders (the event material mentions a **January 2027** window **[VERIFY terms]**).
- **Mainnet path:** when the PQ precompiles are active on mainnet, re-deploy via `scripts/deploy` with a chain config. Keep chain parameters in config only, never in code.
- Write up the **threat model and the restrict-only / PQ-release pattern** as a short public spec so others can adopt it. A standard pattern is a stronger long-term asset than the demo.

**Repo hygiene for long-term work:** conventional commits, CI (lint, types, tests, contract tests), Dependabot, `CHANGELOG.md`, versioned envelope format (`v: 1`), a documented upgrade policy for the contract (keep `FleetRegistry` non-upgradeable for v0.1; if upgradeability is added, it must be PQ-gated).

---

## 10. Agent working rules
1. Do Spike 0 first. Do not build UI before the chain loop is proven.
2. When a fact is tagged **[VERIFY]**, verify it from QoreChain docs or by running it, then update this file. Do not guess.
3. Keep the contract small and boring. Complexity belongs in TypeScript.
4. Fail closed for security checks. Fail safe (stop) for physical behaviour.
5. Every tx hash shown in the UI or README must be real and from `qorechain-diana`.
6. Commit small, commit often. Keep `main` deployable from Friday on.
7. If a decision is blocked or a fallback in §4 triggers, state it in the PR/commit and in `docs/CHAIN_NOTES.md`, then proceed with the fallback.