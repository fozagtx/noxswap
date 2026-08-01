# Feedback on the iExec Nox toolchain

Written while building NoxSwap during the WTF!! Hackathon Summer Edition.
Everything below was actually hit during development, in roughly the order we
hit it.

## What worked well

1. **`llms.txt` on the docs site is excellent.** `docs.noxprotocol.io/llms.txt`
   plus per-page `.md` endpoints made it trivial to pull accurate API docs into
   tooling. More projects should do this.
2. **`nox-hardhat-starter` is a genuinely good on-ramp.** Three small, honest
   examples (token / piggy bank / auction) each demonstrate one pattern, and the
   integration tests show the full encrypt → transact → decrypt round-trip
   including the handle-gateway polling helper. We learned the entire
   programming model from this repo in under an hour.
3. **`Nox.publicDecrypt(handle, decryptionProof)` as an on-chain view is the
   killer primitive.** It let us make batch settlement fully permissionless:
   anyone fetches proofs from the gateway, the contract verifies them via
   NoxCompute and acts on the plaintext. No trusted operator role. The JS side
   returning `decryptionProof` from `nox.publicDecrypt()` composes perfectly
   with it.
4. **Native Sepolia support baked into `Nox.sol`** (chain-id switch for
   NoxCompute addresses) meant zero configuration to target the hackathon's
   required network.
5. **The clamp pattern documented in `ConfidentialPiggyBank`** (safeSub +
   select instead of revert, "same as ERC-7984 `_update`") is exactly the
   guidance developers need — reverting on encrypted comparisons leaks
   information, and the example says so explicitly.
6. **Compiles clean on Solidity 0.8.35** with no warnings from the Nox library
   itself.

## Friction points

1. **The Networks docs page data is not in the markdown.** The `.md` endpoint
   for `/getting-started/networks` contains the page shell but the actual
   chain cards (NoxCompute addresses, gateway URLs, faucets) render
   client-side. We had to grep `node_modules` for the Sepolia NoxCompute
   address. Please inline the addresses as a plain table in the markdown.
2. **Hardhat 3-only plugin meets a Hardhat 2 ecosystem.** Most public starter
   kits (Scaffold-ETH 2 included) still pin Hardhat 2 / viem 1 / wagmi 1, while
   `@iexec-nox/handle` peer-depends on viem 2 and the plugin needs Hardhat 3.
   We ended up splitting contracts (Nox toolchain) from the frontend (fresh
   viem-2 app). A short "integrating with existing dapp templates" doc section
   would save teams an hour of dependency archaeology.
3. **No boolean/utility ops in the Solidity SDK.** There is no `Nox.and`,
   `Nox.or`, `Nox.not`, `Nox.min`, `Nox.max`. Conditions like "direction is
   sell AND balance sufficient" become nested `select` calls, which are easy to
   get wrong. Even sugar implemented as nested selects internally would improve
   readability a lot.
4. **`encryptInput` has no `bool` convenience for flags.** We encrypted a
   direction flag as `uint256` 0/1 and normalised with `gt(x, 0)` on-chain.
   A first-class encrypted-bool input path would be cleaner.
5. **The examples track encrypted numbers, not real funds.** The starter says
   so honestly, but the first thing a DeFi builder needs is the bridge between
   a real ERC-20 `transferFrom` and an encrypted balance (and back). Our
   two-phase withdrawal (encrypt request → clamp → `allowPublicDecryption` of
   the *amount only* → finalize with proof) took real design effort; a
   documented reference pattern for "confidential accounting over real tokens"
   would be very valuable. (The ERC-20 ↔ ERC-7984 wrapper guide covers part of
   this, but not the plaintext-exit flow.)
6. **First local-stack boot is heavy and fragile on flaky networks.** Seven
   Docker images are pulled on first `hardhat test`; a single registry TLS
   timeout aborts the whole run with an uncaught exception rather than a
   retry. A retry-with-backoff on `docker compose pull` (or a friendlier error
   naming the fix: "pull failed, re-run the test") would smooth the first-run
   experience.
7. **Gas/latency profile of encrypted ops is undocumented.** Every `Nox.*` op
   is an external call to NoxCompute, and our settlement loops over
   participants doing mul/div/add per user. We'd like docs guidance on
   per-op costs and a recommended max batch size.
8. **`ViemBlockchainService` binds proofs to `getAddresses()[0]`, not the
   client's own account.** With a multi-account provider (Hardhat's viem
   wallet clients share one provider listing every configured account), a
   handle client created for account B still emits proofs bound to account A —
   and the resulting `submitIntent` reverts on-chain from the *other* wallet.
   Cost us a full Sepolia run to diagnose. Suggest preferring
   `walletClient.account` when present (it already is at the signing call
   site) and documenting the single-account expectation.
9. **Beta version skew.** `nox-hardhat-starter` pins
   `nox-hardhat-plugin@^0.1.0-beta.2` while npm already has `0.2.0`; the
   published `HANDLE_GATEWAY_URL` export also moved between versions. Expected
   at beta stage, but a CHANGELOG pointer in the starter README would help.

## Wishlist

- `Nox.min/max`, boolean ops, and scalar-overload variants
  (`mul(euint256, uint256)`) to cut handle churn in hot loops.
- A `waitForHandleResolved`-equivalent inside `@iexec-nox/handle` (we
  re-implemented retry/backoff around `decrypt`/`publicDecrypt` in the browser).
- An events-first pattern doc: how to surface fresh handles to frontends
  (we emit the handle in an event and read it back; is there a better way?).
- A hosted Sepolia faucet/quota note for the gateway: what rate limits should
  a demo expect during a live judging session?
