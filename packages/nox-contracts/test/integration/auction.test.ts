import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { nox } from "@iexec-nox/nox-hardhat-plugin";
import { waitForHandleResolved } from "../utils/handle-gateway.js";

describe("ConfidentialAuction end-to-end", () => {
  it(
    "keeps the highest sealed bid encrypted, regardless of submission order",
    { timeout: 180_000 },
    async () => {
      const { viem } = await nox.connect();
      const publicClient = await viem.getPublicClient();

      const auction = await viem.deployContract("ConfidentialAuction", []);

      // Three sealed bids submitted out of order; 250 should win.
      for (const bidValue of [120n, 250n, 90n]) {
        const enc = await nox.encryptInput(bidValue, "uint256", auction.address);
        const tx = await auction.write.bid([enc.handle, enc.handleProof]);
        await publicClient.waitForTransactionReceipt({ hash: tx });
      }

      // The auctioneer reads and decrypts the winning bid.
      const highestHandle = (await auction.read.highestBid()) as `0x${string}`;
      await waitForHandleResolved(highestHandle);

      const { value } = await nox.decrypt(highestHandle);
      assert.equal(value, 250n);
    },
  );

  it(
    "reveals the winning bid to everyone once the auction is closed",
    { timeout: 180_000 },
    async () => {
      const { viem } = await nox.connect();
      const publicClient = await viem.getPublicClient();

      const auction = await viem.deployContract("ConfidentialAuction", []);

      for (const bidValue of [120n, 250n, 90n]) {
        const enc = await nox.encryptInput(bidValue, "uint256", auction.address);
        const tx = await auction.write.bid([enc.handle, enc.handleProof]);
        await publicClient.waitForTransactionReceipt({ hash: tx });
      }

      // The owner closes the auction, marking the winning bid publicly decryptable.
      const closeTx = await auction.write.closeAndReveal();
      await publicClient.waitForTransactionReceipt({ hash: closeTx });

      const highestHandle = (await auction.read.highestBid()) as `0x${string}`;
      await waitForHandleResolved(highestHandle);

      // publicDecrypt resolves without any per-account authorization.
      const { value } = await nox.publicDecrypt(highestHandle);
      assert.equal(value, 250n);
      assert.equal(await auction.read.closed(), true);
    },
  );

  it(
    "rejects bids submitted after the auction is closed",
    { timeout: 180_000 },
    async () => {
      const { viem } = await nox.connect();
      const publicClient = await viem.getPublicClient();

      const auction = await viem.deployContract("ConfidentialAuction", []);

      // A first bid lands while the auction is open.
      const first = await nox.encryptInput(100n, "uint256", auction.address);
      const firstTx = await auction.write.bid([first.handle, first.handleProof]);
      await publicClient.waitForTransactionReceipt({ hash: firstTx });

      const closeTx = await auction.write.closeAndReveal();
      await publicClient.waitForTransactionReceipt({ hash: closeTx });

      // A bid after closing must revert.
      const late = await nox.encryptInput(200n, "uint256", auction.address);
      await assert.rejects(auction.write.bid([late.handle, late.handleProof]));
    },
  );

  it("records the deployer as the owner", async () => {
    const { viem } = await nox.connect();
    const [walletClient] = await viem.getWalletClients();

    const auction = await viem.deployContract("ConfidentialAuction", []);
    const owner = (await auction.read.owner()) as `0x${string}`;

    assert.equal(
      owner.toLowerCase(),
      walletClient.account.address.toLowerCase(),
    );
  });
});
