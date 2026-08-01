# iExec Nox - Confidential Contracts Starter

A ready-to-clone [Hardhat 3](https://hardhat.org) starter for building **confidential smart contracts** with the [iExec Nox](https://www.npmjs.com/package/@iexec-nox/nox-hardhat-plugin) toolchain. Balances, transfers and amounts are encrypted end-to-end and only computed inside a TEE, so no on-chain observer can see the values.

It ships three worked examples and their end-to-end tests so you can copy a pattern and start building:

| Contract | What it shows |
| --- | --- |
| `ConfidentialToken` | A confidential fungible token (ERC-7984): encrypted balances, transfers, total supply, owner-only mint, self-service burn |
| `ConfidentialPiggyBank` | An encrypted savings balance: anyone deposits, only the owner withdraws |
| `ConfidentialAuction` | A sealed-bid auction: encrypted bids; the owner closes it and reveals the winning *bid amount* to everyone via `publicDecrypt` |

> **These examples track encrypted numbers, not real funds.** `ConfidentialPiggyBank` and `ConfidentialAuction` move no ETH or tokens — `deposit`/`withdraw`/`bid` update an encrypted counter only, so they stay focused on the confidentiality patterns. `ConfidentialAuction.closeAndReveal` also reveals only the winning *amount*; the contract does not record which address submitted it, so identifying the winner on-chain is out of scope for this example.

## Prerequisites

- **Node.js 22+**
- **Docker**: the Nox Hardhat plugin boots a local offchain stack (handle gateway, runner, …) in containers when you run the tests. **Docker must be running**, otherwise the test task fails with `Cannot connect to the Docker daemon`.

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Make sure Docker is running (Docker Desktop, colima, …)
docker info

# 3. Compile
npx hardhat compile

# 4. Run the end-to-end tests (boots the local Nox stack automatically)
npm test
```

The first `npm test` pulls the Nox stack images, so it takes longer than later runs.

## Project layout

```
contracts/                  Solidity sources
  ConfidentialToken.sol
  ConfidentialPiggyBank.sol
  ConfidentialAuction.sol
test/
  integration/              End-to-end tests (encrypt → transact → decrypt)
  utils/handle-gateway.ts   Helper that polls the Nox handle gateway
hardhat.config.ts           Hardhat + Nox plugin configuration
```

## How confidentiality works

Encrypted values never appear in cleartext on-chain. The typical round-trip is:

1. **Encrypt off-chain**: the client encrypts an input bound to the target contract:
   ```ts
   const input = await nox.encryptInput(1000n, "uint256", token.address);
   ```
2. **Transact**: the contract receives an `externalEuint256` handle plus a proof and turns it into an in-contract `euint256` via `Nox.fromExternal(...)`. All arithmetic (`add`, `sub`, `gt`, `select`, …) runs on ciphertext.
3. **Authorize & decrypt**: the contract grants access with `Nox.allowThis(...)` / `Nox.allow(value, account)`, and an authorized account decrypts the resulting handle:
   ```ts
   const { value } = await nox.decrypt(balanceHandle);
   ```

A handle is only decryptable by accounts the contract explicitly allowed, and that is what keeps balances private. To reveal a value to *everyone* (for example the winning bid once an auction closes), the contract calls `Nox.allowPublicDecryption(handle)` and anyone can then read it with `nox.publicDecrypt(handle)`.

## Writing your own confidential contract

`ConfidentialToken` is the recommended starting point for fungible assets. It extends the ERC-7984 reference implementation from `@iexec-nox/nox-confidential-contracts` and adds only access-controlled mint/burn:

```solidity
contract ConfidentialToken is ERC7984, Ownable {
    function mint(address to, externalEuint256 encryptedAmount, bytes calldata inputProof)
        external onlyOwner returns (euint256 minted)
    {
        minted = _mint(to, Nox.fromExternal(encryptedAmount, inputProof));
    }
    // ...
}
```

> **Note on total-supply ACL.** The ERC-7984 optimized mint/burn primitives (v0.2.x) re-grant the contract's access to the updated *balances* but not to the new *total-supply* handle. Without that grant, a second mint or any burn reverts with `NotAllowed`. `ConfidentialToken` works around it by overriding `_update` to re-grant `Nox.allowThis(confidentialTotalSupply())` after every operation. Keep this in mind if you implement your own token from the same primitives.

## License

MIT
