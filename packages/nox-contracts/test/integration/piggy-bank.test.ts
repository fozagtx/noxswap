import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { nox } from "@iexec-nox/nox-hardhat-plugin";
import { waitForHandleResolved } from "../utils/handle-gateway.js";

describe("ConfidentialPiggyBank end-to-end", () => {
  it(
    "keeps an encrypted balance the owner can deposit into, withdraw from, and decrypt",
    { timeout: 180_000 },
    async () => {
      const { viem } = await nox.connect();
      const publicClient = await viem.getPublicClient();

      const piggyBank = await viem.deployContract("ConfidentialPiggyBank", []);

      // Deposit 100 (encrypted client-side, bound to the piggy bank contract).
      const dep = await nox.encryptInput(100n, "uint256", piggyBank.address);
      const depTx = await piggyBank.write.deposit([dep.handle, dep.handleProof]);
      await publicClient.waitForTransactionReceipt({ hash: depTx });

      // Withdraw 30.
      const wd = await nox.encryptInput(30n, "uint256", piggyBank.address);
      const wdTx = await piggyBank.write.withdraw([wd.handle, wd.handleProof]);
      await publicClient.waitForTransactionReceipt({ hash: wdTx });

      // The owner reads the encrypted balance handle and decrypts it: 100 - 30 = 70.
      const balanceHandle = (await piggyBank.read.balance()) as `0x${string}`;
      await waitForHandleResolved(balanceHandle);

      const { value } = await nox.decrypt(balanceHandle);
      assert.equal(value, 70n);
    },
  );

  it(
    "ignores a withdrawal larger than the balance instead of underflowing",
    { timeout: 180_000 },
    async () => {
      const { viem } = await nox.connect();
      const publicClient = await viem.getPublicClient();

      const piggyBank = await viem.deployContract("ConfidentialPiggyBank", []);

      // Deposit 50.
      const dep = await nox.encryptInput(50n, "uint256", piggyBank.address);
      const depTx = await piggyBank.write.deposit([dep.handle, dep.handleProof]);
      await publicClient.waitForTransactionReceipt({ hash: depTx });

      // Attempt to withdraw 200 (more than the balance). With safeSub + select
      // the balance stays at 50 rather than underflowing to a huge value.
      const wd = await nox.encryptInput(200n, "uint256", piggyBank.address);
      const wdTx = await piggyBank.write.withdraw([wd.handle, wd.handleProof]);
      await publicClient.waitForTransactionReceipt({ hash: wdTx });

      const balanceHandle = (await piggyBank.read.balance()) as `0x${string}`;
      await waitForHandleResolved(balanceHandle);

      const { value } = await nox.decrypt(balanceHandle);
      assert.equal(value, 50n);
    },
  );

  it("records the deployer as the owner", async () => {
    const { viem } = await nox.connect();
    const [walletClient] = await viem.getWalletClients();

    const piggyBank = await viem.deployContract("ConfidentialPiggyBank", []);
    const owner = (await piggyBank.read.owner()) as `0x${string}`;

    assert.equal(
      owner.toLowerCase(),
      walletClient.account.address.toLowerCase(),
    );
  });
});
