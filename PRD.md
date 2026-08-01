# PRD — NoxSwap: Confidential Batch Swap Router over Uniswap

**Hackathon:** iExec WTF!! Hackathon Summer Edition (DoraHacks)
**Track fit:** "DeFi — Aave, Uniswap, Curve: route swaps or lending through Nox confidential contracts"
**Chain:** Ethereum Sepolia
**Deadline:** 2026-08-01 21:59 (≈17h) — scope is cut accordingly. Every section marked **[CUT]** is out of MVP.

---

## 1. One-liner

NoxSwap is a dark pool for Uniswap: users submit **encrypted swap intents** into a Nox confidential contract; a TEE **nets opposing intents peer-to-peer** (zero slippage, zero MEV) and executes only the **residual** as one aggregate swap through the public Uniswap router. Observers see the pool trade — never who swapped, which direction, or how much.

## 2. Problem

Public DeFi leaks intent. Every pending swap exposes trader, token pair, direction, and size:

- **MEV extraction** — sandwich bots profit directly from visible intents (a hidden tax on every swap).
- **Strategy leakage** — funds and DAOs can't rebalance without broadcasting their book; copy-traders and adversaries front-run accumulation.
- **Institutional blocker** — discretion-sensitive capital won't touch venues where every position change is public (the hackathon's "Institutional" tag).

Uniswap is public **by design** and must not be modified. The brief's own words: *"Route a swap through Nox without breaking composability, that's where the real value lies."*

## 3. Solution

A privacy **layer over unmodified Uniswap**, built from three Nox primitives:

1. **Shielded balances** — deposits are held as confidential balances (Nox handles / ERC-7984-style hidden amounts). Only the vault's aggregate TVL is public.
2. **Encrypted intents** — swap orders (direction, amount, min-out) are encrypted client-side with the Nox JS SDK; contracts reference them only via 32-byte handles. Nothing about the order is ever plaintext on-chain.
3. **TEE batch execution** — inside the Intel TDX enclave, the batch executor decrypts intents, **crosses opposing flow internally at the mid-price** (A→B matched against B→A: no pool interaction, no slippage, no MEV), and routes only the **net residual** through Uniswap's public `SwapRouter`. Proceeds are credited back to each user's hidden balance pro-rata.

**Privacy guarantees per party:**

| Observer sees | Hidden |
| --- | --- |
| Vault deposits/withdrawals happen (addresses interact with NoxSwap) | Individual balances after deposit |
| One aggregate swap per batch from the vault contract | Who participated in the batch, each user's direction and size |
| Batch count and residual size | Netted (internally crossed) volume — never touches the chain |

**Selective disclosure (institutional kicker):** via Nox ACLs, a user can grant a designated auditor address view-permission on their handles — compliance without public exposure.

## 4. Goals / Non-goals

**Goals (MVP, must all work end-to-end on Sepolia, no mock data):**
- G1. Deposit ERC-20 (one pair: WETH/USDC) into shielded vault; balance becomes confidential.
- G2. Submit an encrypted swap intent (direction + amount encrypted via Nox JS SDK).
- G3. Execute a batch: TEE nets intents, swaps residual on Uniswap Sepolia, credits hidden balances.
- G4. Withdraw back to public ERC-20.
- G5. Demonstrable netting: two opposite intents in one batch → on-chain Uniswap swap is only the difference.
- G6. Deployed frontend + contracts on Sepolia; 4-min video; public repo; `feedback.md`; X post tagging @iEx_ec.

**Non-goals [CUT]:**
- Multi-pair / routing across pools; limit orders / partial fills (batch executes at execution-time price with encrypted min-out as the only protection); automated keeper (batch execution is a permissionless button); auditor-view UI (mention in video, show ACL grant in code); gas optimization; audits.

## 5. Users & stories

- **Trader (retail, MEV-averse):** "I deposit once, then swap without bots seeing my orders." — deposit → intent → wait for batch → hidden balance updates.
- **Fund / DAO treasury (institutional):** "I rebalance without broadcasting the book; my auditor can still verify." — same flow + ACL grant to auditor address.
- **Batch executor (anyone):** "I press Execute Batch (or run the script) and the epoch settles." — permissionless crank; no privileged operator in the trust story beyond the TEE itself.

## 6. Product flow

```
┌─────────┐  1. approve+deposit   ┌──────────────────┐
│  User A │ ────────────────────► │  ShieldedVault    │  public: deposit event
│ (wallet)│  2. encrypted intent  │  (Nox contract)   │  hidden: balances (handles)
└─────────┘ ────────────────────► │  IntentBook       │  hidden: direction/amount
                                  └────────┬─────────┘
                                           │ 3. executeBatch() (anyone)
                                  ┌────────▼─────────┐
                                  │  TEE (Intel TDX)  │  decrypt intents
                                  │  BatchExecutor    │  net A→B vs B→A
                                  └────────┬─────────┘  compute residual
                                           │ 4. one public swap (residual only)
                                  ┌────────▼─────────┐
                                  │ Uniswap SwapRouter│  unmodified, Sepolia
                                  └──────────────────┘
                                           │ 5. credit hidden balances pro-rata
```

Withdraw at any time: burn confidential balance → receive public ERC-20.

## 7. Architecture & components

> **Spike results (hour-0, confirmed against real packages/docs):**
> - Solidity API (`@iexec-nox/nox-protocol-contracts` → `sdk/Nox.sol`): types `euint256/eint256/ebool/externalEuint256`; ops `add/sub/mul/div` (+ `safe*` variants), `eq/ne/gt/ge/lt/le`, `select`, `toEuint256`; ACL `allowThis/allow/allowTransient/addViewer/allowPublicDecryption`.
> - **`Nox.publicDecrypt(handle, decryptionProof)` is an on-chain view** validated by NoxCompute → settlement is trustless: anyone submits gateway proofs, the contract verifies and swaps. No trusted executor role needed.
> - **Ethereum Sepolia (11155111) natively supported** — NoxCompute address hardcoded in the library; Arbitrum Sepolia and Hardhat local too.
> - JS flow (`nox-hardhat-plugin` / `@iexec-nox/handle`): `nox.encryptInput(value, "uint256", contractAddr)` → `{handle, handleProof}`; `nox.decrypt(handle)` (ACL-gated); `nox.publicDecrypt(handle)`; poll handle gateway until resolved. Local stack runs in Docker (Node 22+ required).
> - Toolchain clash confirmed: Nox needs Hardhat 3 / Solidity ^0.8.28 / OZ 5.6; SE-2 kit is Hardhat 2 / OZ 4.8. **Decision:** contracts live in `packages/nox-contracts` (standalone npm workspace copied from `nox-hardhat-starter`); SE-2's `packages/nextjs` is frontend-only and reads deployed addresses/ABIs from a shared JSON.
> - Differentiation note: iExec's docs describe a "Confidential Vault: Encrypted Strategy" concept (aggregate net orders per epoch). NoxSwap is distinct — permissionless user-facing dark-pool swaps with P2P crossing at spot and an MEV-protection story, not a manager-strategy vault; state this in README.
> - Implementation lives at `packages/nox-contracts/contracts/NoxSwapVault.sol` (epochs, encrypted direction+amount intents, aggregate-only reveal, spot-price crossing, residual swap, encrypted pro-rata distribution, `grantAuditorView`).

### 7.1 Contracts (`packages/hardhat`) — Solidity + Nox privacy primitives

- **`NoxSwapVault.sol`** — core confidential contract.
  - `deposit(token, amount)` — pulls ERC-20, mints confidential balance (handle-based; use Nox confidential-token wrapper for WETH/USDC if the toolkit provides one — check `cdefi-wizard` output first).
  - `submitIntent(bytes32 amountHandle, bytes32 directionHandle, bytes32 minOutHandle)` — stores encrypted intent for the current epoch; ACL grants the vault contract compute-permission on the handles.
  - `executeBatch()` — permissionless; triggers the TEE computation: net intents → approve + call `SwapRouter.exactInputSingle` for the residual → distribute outputs to participants' hidden balances pro-rata at the uniform clearing price.
  - `withdraw(token, encryptedAmount)` — burns confidential balance, transfers public ERC-20.
  - `grantAuditorView(address auditor)` — ACL selective disclosure on caller's handles.
- **External (unmodified):** Uniswap V3 `SwapRouter02` + WETH/USDC pool on Sepolia. **Hour-1 spike:** verify a usable Sepolia pool exists with real liquidity; if depth is unusable, deploy our own V3 pool for canonical Sepolia WETH + a self-deployed USDC-style token and seed liquidity — still real contracts on a public testnet, satisfying "no mock data."

### 7.2 Client encryption (`packages/nextjs`) — Nox JS SDK

- Encrypt intent fields client-side → get handles → pass to `submitIntent`.
- Decrypt own balance for display (SDK decryption flow; only the owner's key / ACL-permitted parties can).

### 7.3 Frontend — Scaffold-ETH 2 (this repo)

Pages (replace `example-ui`):
1. **Pool** — vault TVL (public), your confidential balances (decrypted locally), deposit/withdraw.
2. **Swap** — direction toggle, amount, min-out; "Submit encrypted intent" (shows the handle as proof nothing leaks); pending-epoch indicator.
3. **Batches** — epoch list: residual swap tx link (Etherscan), batch size, "Execute Batch" button. This page is the demo money-shot: it juxtaposes *what the chain sees* vs *what you know about your own position*.

SE-2 gives wagmi hooks, contract hot-reload, RainbowKit, block explorer — keep all of it. **Note:** kit pins Node 18 / OZ 4.8 / yarn 3; if the `nox-hardhat-plugin` requires newer toolchain, upgrade the hardhat workspace or swap it for `nox-hardhat-starter` and keep only the Next.js workspace from SE-2. Decide in hour 1, don't fight it later.

### 7.4 Trust model (state honestly in README/video)

Privacy rests on Intel TDX TEE guarantees (operators can't see plaintext) + Nox ACLs. The Uniswap residual swap is public by design — that's the composability trade-off the brief asks for. Batch anonymity set = participants per epoch; small sets leak less than you'd think (direction/size still hidden) but we state it plainly.

## 8. Judging-criteria mapping

| Criterion (weight) | How we score it |
| --- | --- |
| ⭐⭐⭐ Creativity | Internal netting/dark-pool crossing — not a plain swap-forwarder; MEV-protection narrative |
| ⭐⭐⭐ Works e2e, no mocks | Real Uniswap Sepolia swap in the demo, live frontend, real Nox encryption |
| ⭐⭐ Deployed on ETH Sepolia | All contracts + hosted frontend (Vercel) |
| ⭐⭐ `feedback.md` | Written while building: SDK DX, plugin friction, wizard gaps, doc holes |
| ⭐⭐ ≤4-min video | Scripted demo (§10) |
| ⭐ Nox leverage | Handles + ACL + TEE compute + confidential balances — all four primitives used |
| ⭐ UX | SE-2 polish; standard wallet, no new UX asks (Nox's own selling point) |

## 9. 17-hour plan (with cutlines)

| Hours | Work | Cutline if behind |
| --- | --- | --- |
| 0–1 | Spike: run `nox-hardhat-starter` + `cdefi-wizard`, confirm real API names for encrypt/handle/ACL/compute; verify Uniswap Sepolia pool; decide toolchain (§7.3 note) | — |
| 1–6 | `NoxSwapVault.sol`: deposit/withdraw + confidential balances, then intents, then batch execution w/ Uniswap call | Drop netting → batch = aggregate swap only (still hides individuals) |
| 6–9 | Frontend: Pool + Swap pages wired to Sepolia deploy | Drop Batches page → CLI script for batch, show Etherscan in demo |
| 9–11 | End-to-end on Sepolia with 2 wallets; fix reality | — (non-negotiable) |
| 11–12.5 | README (install/deploy/use) + `feedback.md` | — (scored) |
| 12.5–14.5 | Record + cut 4-min video; deploy frontend to Vercel | Loom one-take |
| 14.5–15 | X post w/ description, video, repo link, tag @iEx_ec; DoraHacks BUIDL submission | — (this IS the submission) |
| 15–17 | Buffer (something will break) | — |

## 10. Demo video script (4 min)

1. (0:00) Problem: show a public Uniswap swap on Etherscan — everything visible; one line on sandwich bots.
2. (0:40) Deposit from Wallet A and Wallet B; show balances are handles on-chain, decrypted only in-app.
3. (1:30) Wallet A submits WETH→USDC intent, Wallet B submits USDC→WETH intent; Etherscan shows only opaque handles.
4. (2:20) Execute batch → show the single residual swap on Etherscan: *smaller than either intent* — netting proof.
5. (3:10) Balances updated privately; flash the ACL auditor-grant call; close: "Uniswap unchanged. Privacy added. Composability kept."

## 11. Deliverables checklist (from brief)

- [ ] Public GitHub repo (re-point this clone's `origin` to a fresh repo under our account before first push)
- [ ] README: install, deploy, usage
- [ ] `feedback.md` on iExec/Nox tooling
- [ ] Functional hosted frontend (Vercel), contracts on Sepolia
- [ ] ≤4-min demo video
- [ ] X post: description + video + repo link, tagging **@iEx_ec**
- [ ] DoraHacks BUIDL submission before **2026-08-01 21:59**
- [ ] Originality note in README: scaffold = Scaffold-ETH 2 (generic template, no prior Sablier/iExec code); all Nox integration + vault + netting built during the hackathon

## 12. Risks

| Risk | Mitigation |
| --- | --- |
| Nox API differs from PRD sketch (handles/ACL/compute call shapes) | Hour-0 spike against starter + wizard before writing vault code; PRD names are placeholders, starter's names win |
| No usable Uniswap Sepolia liquidity | Deploy own V3 pool + seed it (real contracts, real chain — allowed) |
| TEE batch latency awkward in live demo | Pre-record execution segment; keep one pre-warmed batch ready |
| SE-2 toolchain (Node 18/yarn 3) clashes with Nox packages | Fallback: `nox-hardhat-starter` for contracts, SE-2 for frontend only |
| Netting logic overruns | Cutline in §9 — aggregate-only batching still beats a swap-forwarder |

## 13. Winner-DNA provenance (why this shape wins)

Patterns from prior winning hackathon projects informing this design: **TradeXchange** (iExec '24 winner — encrypted trading data via DataProtector), **Theseus Alpha** (Spectral '24 1st — trading personalization), **Rebalancer** (Encode '23 Avalanche 1st — "never surrender secrets" as the core product insight), **FarFarAway Swap** (Encode x NEAR — routing between execution models by liquidity conditions), and the Flashbots/MEV workshop insight that *public intent is the root cause of sandwich MEV* — NoxSwap removes the intent from public view instead of racing it.
