import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { nox } from "@iexec-nox/nox-hardhat-plugin";
import { waitForHandleResolved } from "../utils/handle-gateway.js";

const NAME = "Confidential Token";
const SYMBOL = "CTKN";
const CONTRACT_URI = "https://example.com/ctkn.json";

async function deployToken() {
  const { viem } = await nox.connect();
  const token = await viem.deployContract("ConfidentialToken", [
    NAME,
    SYMBOL,
    CONTRACT_URI,
  ]);
  return { viem, token };
}

describe("ConfidentialToken end-to-end", () => {
  it(
    "lets the owner mint an encrypted balance they can decrypt",
    { timeout: 180_000 },
    async () => {
      const { viem, token } = await deployToken();
      const publicClient = await viem.getPublicClient();
      const [owner] = await viem.getWalletClients();

      // Mint 1000 (encrypted client-side, bound to the token contract).
      const mintInput = await nox.encryptInput(1000n, "uint256", token.address);
      const mintTx = await token.write.mint([
        owner.account.address,
        mintInput.handle,
        mintInput.handleProof,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: mintTx });

      // The owner reads and decrypts their own encrypted balance.
      const balanceHandle = (await token.read.confidentialBalanceOf([
        owner.account.address,
      ])) as `0x${string}`;
      await waitForHandleResolved(balanceHandle);

      const { value } = await nox.decrypt(balanceHandle);
      assert.equal(value, 1000n);
    },
  );

  it(
    "burns from the caller's own encrypted balance",
    { timeout: 180_000 },
    async () => {
      const { viem, token } = await deployToken();
      const publicClient = await viem.getPublicClient();
      const [owner] = await viem.getWalletClients();

      const mintInput = await nox.encryptInput(1000n, "uint256", token.address);
      const mintTx = await token.write.mint([
        owner.account.address,
        mintInput.handle,
        mintInput.handleProof,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: mintTx });

      // Burn 400, leaving 600.
      const burnInput = await nox.encryptInput(400n, "uint256", token.address);
      const burnTx = await token.write.burn([
        burnInput.handle,
        burnInput.handleProof,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: burnTx });

      const balanceHandle = (await token.read.confidentialBalanceOf([
        owner.account.address,
      ])) as `0x${string}`;
      await waitForHandleResolved(balanceHandle);

      const { value } = await nox.decrypt(balanceHandle);
      assert.equal(value, 600n);
    },
  );

  it(
    "supports repeated mints that accumulate on the same balance",
    { timeout: 180_000 },
    async () => {
      const { viem, token } = await deployToken();
      const publicClient = await viem.getPublicClient();
      const [owner] = await viem.getWalletClients();

      // Two successive mints exercise the total-supply ACL re-grant: the
      // second mint reads the supply produced by the first.
      for (const amount of [1000n, 250n]) {
        const input = await nox.encryptInput(amount, "uint256", token.address);
        const tx = await token.write.mint([
          owner.account.address,
          input.handle,
          input.handleProof,
        ]);
        await publicClient.waitForTransactionReceipt({ hash: tx });
      }

      const balanceHandle = (await token.read.confidentialBalanceOf([
        owner.account.address,
      ])) as `0x${string}`;
      await waitForHandleResolved(balanceHandle);

      const { value } = await nox.decrypt(balanceHandle);
      assert.equal(value, 1250n);
    },
  );

  it(
    "moves an encrypted amount on transfer without revealing it",
    { timeout: 180_000 },
    async () => {
      const { viem, token } = await deployToken();
      const publicClient = await viem.getPublicClient();
      const [owner, recipient] = await viem.getWalletClients();

      const mintInput = await nox.encryptInput(1000n, "uint256", token.address);
      const mintTx = await token.write.mint([
        owner.account.address,
        mintInput.handle,
        mintInput.handleProof,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: mintTx });

      // Owner transfers 300 to the recipient.
      const transferInput = await nox.encryptInput(
        300n,
        "uint256",
        token.address,
      );
      const transferTx = await token.write.confidentialTransfer([
        recipient.account.address,
        transferInput.handle,
        transferInput.handleProof,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: transferTx });

      // The owner can decrypt their own remaining balance: 1000 - 300 = 700.
      const balanceHandle = (await token.read.confidentialBalanceOf([
        owner.account.address,
      ])) as `0x${string}`;
      await waitForHandleResolved(balanceHandle);

      const { value } = await nox.decrypt(balanceHandle);
      assert.equal(value, 700n);
    },
  );

  it(
    "lets an approved operator transfer on the holder's behalf",
    { timeout: 180_000 },
    async () => {
      const { viem, token } = await deployToken();
      const publicClient = await viem.getPublicClient();
      // account[0] acts as the operator/spender; account[1] is the holder.
      const [operator, holder] = await viem.getWalletClients();

      // Mint 1000 to the holder.
      const mintInput = await nox.encryptInput(1000n, "uint256", token.address);
      const mintTx = await token.write.mint([
        holder.account.address,
        mintInput.handle,
        mintInput.handleProof,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: mintTx });

      // The holder approves the operator (no expiry until year ~2096).
      const holderToken = await viem.getContractAt(
        "ConfidentialToken",
        token.address,
        { client: { wallet: holder } },
      );
      const setOpTx = await holderToken.write.setOperator([
        operator.account.address,
        4_000_000_000,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: setOpTx });

      assert.equal(
        await token.read.isOperator([
          holder.account.address,
          operator.account.address,
        ]),
        true,
      );

      // The operator pulls 300 from the holder to itself.
      const pullInput = await nox.encryptInput(300n, "uint256", token.address);
      const pullTx = await token.write.confidentialTransferFrom([
        holder.account.address,
        operator.account.address,
        pullInput.handle,
        pullInput.handleProof,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: pullTx });

      // The operator received the tokens and can decrypt its own balance.
      const balanceHandle = (await token.read.confidentialBalanceOf([
        operator.account.address,
      ])) as `0x${string}`;
      await waitForHandleResolved(balanceHandle);

      const { value } = await nox.decrypt(balanceHandle);
      assert.equal(value, 300n);
    },
  );

  it("rejects confidentialTransferFrom from a non-operator", async () => {
    const { viem, token } = await deployToken();
    const publicClient = await viem.getPublicClient();
    const [owner, holder, stranger] = await viem.getWalletClients();

    const mintInput = await nox.encryptInput(1000n, "uint256", token.address);
    const mintTx = await token.write.mint([
      holder.account.address,
      mintInput.handle,
      mintInput.handleProof,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: mintTx });

    // `stranger` was never approved by `holder`, so the pull must revert.
    const strangerToken = await viem.getContractAt(
      "ConfidentialToken",
      token.address,
      { client: { wallet: stranger } },
    );
    const pullInput = await nox.encryptInput(300n, "uint256", token.address);

    await assert.rejects(
      strangerToken.write.confidentialTransferFrom([
        holder.account.address,
        owner.account.address,
        pullInput.handle,
        pullInput.handleProof,
      ]),
    );
  });

  it("rejects minting from a non-owner account", async () => {
    const { viem, token } = await deployToken();
    const [, stranger] = await viem.getWalletClients();

    const strangerToken = await viem.getContractAt(
      "ConfidentialToken",
      token.address,
      { client: { wallet: stranger } },
    );

    const mintInput = await nox.encryptInput(1000n, "uint256", token.address);

    await assert.rejects(
      strangerToken.write.mint([
        stranger.account.address,
        mintInput.handle,
        mintInput.handleProof,
      ]),
    );
  });

  it("exposes the configured metadata and deployer as owner", async () => {
    const { viem, token } = await deployToken();
    const [owner] = await viem.getWalletClients();

    assert.equal(await token.read.name(), NAME);
    assert.equal(await token.read.symbol(), SYMBOL);
    assert.equal(await token.read.decimals(), 18);
    assert.equal(await token.read.contractURI(), CONTRACT_URI);

    const onChainOwner = (await token.read.owner()) as `0x${string}`;
    assert.equal(
      onChainOwner.toLowerCase(),
      owner.account.address.toLowerCase(),
    );
  });
});
