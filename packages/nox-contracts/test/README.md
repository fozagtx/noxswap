# Tests & SDK coverage

These are **end-to-end integration tests**: each one encrypts an input, sends a real
transaction against a local Nox stack, and decrypts the result. They double as a
reference for the SDK patterns a builder is most likely to reuse.

> Requires **Docker running** (the Nox plugin boots the offchain stack in containers).
> See the root [`README.md`](../README.md) for setup.

```bash
npm test                                   # whole suite
npx hardhat test test/integration/token.test.ts   # a single file
```

## What each suite demonstrates

### `integration/token.test.ts` -> `ConfidentialToken` (ERC-7984)

| Test | SDK / standard surface exercised |
| --- | --- |
| owner mints an encrypted balance they can decrypt | `mint`, `fromExternal`, `confidentialBalanceOf`, `decrypt` |
| burns from the caller's own encrypted balance | `burn`, `fromExternal` |
| supports repeated mints that accumulate | total-supply ACL re-grant (`allowThis` on `confidentialTotalSupply`) |
| moves an encrypted amount on transfer | `confidentialTransfer`, `transfer` primitive, `select` |
| approved operator transfers on the holder's behalf | `setOperator`, `isOperator`, `confidentialTransferFrom`, `allowTransient` |
| rejects `confidentialTransferFrom` from a non-operator | `ERC7984UnauthorizedSpender` (negative path) |
| rejects minting from a non-owner | `Ownable` / `onlyOwner` (negative path) |
| exposes metadata and deployer as owner | `name`/`symbol`/`decimals`/`contractURI`/`owner` |

### `integration/auction.test.ts` -> `ConfidentialAuction`

| Test | SDK surface exercised |
| --- | --- |
| keeps the highest sealed bid encrypted | `gt`, `select`, `allow`, `allowThis` |
| reveals the winning bid to everyone once closed | `allowPublicDecryption`, `publicDecrypt` |
| rejects bids after the auction is closed | custom `AuctionClosed` (negative path) |
| records the deployer as the owner | `Ownable` |

### `integration/piggy-bank.test.ts` -> `ConfidentialPiggyBank`

| Test | SDK surface exercised |
| --- | --- |
| deposit, withdraw, decrypt an encrypted balance | `add`, `sub`, `fromExternal`, `decrypt` |
| records the deployer as the owner | `Ownable` |

### `integration/stack.test.ts`

Smoke checks that the local Nox stack is up (handle gateway reachable, `NoxCompute` deployed).
Not contract logic, just a fast failure if the environment is misconfigured.

### `utils/handle-gateway.ts`

Helper (`waitForHandleResolved`) that polls the handle gateway until a ciphertext is
produced. Used before every `decrypt` / `publicDecrypt`.

## SDK coverage matrix

### Plugin (JavaScript `nox.*`)

| Function | Covered | Where |
| --- | :---: | --- |
| `connect` | yes | all tests |
| `encryptInput` | yes | all write paths |
| `decrypt` | yes | token / piggy-bank |
| `publicDecrypt` | yes | auction reveal |

Full plugin API is covered.

### Solidity primitives (`Nox.*`)

**Covered**

| Area | Functions |
| --- | --- |
| Input | `fromExternal` |
| Conversion | `toEuint256` |
| Arithmetic | `add`, `sub` |
| Comparison | `gt` |
| Branchless select | `select` |
| Token primitives | `mint`, `burn`, `transfer` |
| ACL | `allow`, `allowThis`, `allowTransient`, `allowPublicDecryption`, `isInitialized` |

**Not covered (intentional)**

| Area | Functions | Why skipped |
| --- | --- | --- |
| Conversion | `toEbool`, `toEuint16`, `toEint16`, `toEint256` | Same pattern as `toEuint256`; signed / 16-bit types unused by the examples |
| Arithmetic | `mul`, `div`, `safeAdd`, `safeSub`, `safeMul`, `safeDiv` | Identical call shape to `add`/`sub`; the optimized token path uses `mint`/`burn`/`transfer` instead of the `safe*` raw helpers |
| Comparison | `eq`, `ne`, `lt`, `le`, `ge` | Same shape as `gt`, which is exercised |
| ACL | `disallowTransient`, `addViewer`, `isViewer`, `isAllowed`, `isPubliclyDecryptable` | Viewer registry and the `euint256` (non-`external`) transfer overloads aren't used by the examples |

The goal here is to cover the **patterns** a builder reuses (the encrypt -> compute ->
authorize -> decrypt round-trip, delegated transfers, public reveal), not to re-test the
SDK itself. The skipped functions follow call shapes already demonstrated above.

## Harness constraints worth knowing

- `nox.encryptInput` and `nox.decrypt` both act as **`walletClients[0]`** (the default
  account). You can only encrypt inputs as account 0 and only decrypt handles that the
  contract authorized for account 0. The operator test works around this by making
  account 0 the spender that pulls tokens to itself, so the resulting balance is decryptable.
- `allowPublicDecryption` reverts with `PublicHandleACLForbidden` on a handle that never
  went through a real computation (e.g. the constructor's `toEuint256(0)`); reveal only
  after at least one operation has produced the value.
