import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parseEther } from "viem";
import { nox } from "@iexec-nox/nox-hardhat-plugin";
import { waitForHandleResolved } from "../utils/handle-gateway.js";

// End-to-end dark-pool flow on the local Nox stack:
// two users deposit, submit OPPOSING encrypted intents, the epoch closes
// (only aggregates revealed), settlement crosses the overlap internally and
// swaps only the residual through the (mock) Uniswap router, and both users
// end up with the right confidential balances.

const SQRT_PRICE_1_1 = 1n << 96n; // pool price 1:1 for easy assertions

describe("NoxSwapVault end-to-end", () => {
  it(
    "nets opposing intents and swaps only the residual",
    { timeout: 600_000 },
    async () => {
      const { viem } = await nox.connect();
      const publicClient = await viem.getPublicClient();
      const [alice, bob] = await viem.getWalletClients();

      // --- deploy the world -------------------------------------------------
      const weth = await viem.deployContract("TestERC20", ["Wrapped Ether", "WETH"]);
      const usdc = await viem.deployContract("TestERC20", ["USD Coin", "USDC"]);
      const pool = await viem.deployContract("MockUniswapV3Pool", [
        SQRT_PRICE_1_1,
        weth.address,
        usdc.address,
      ]);
      const router = await viem.deployContract("MockSwapRouter", [pool.address, weth.address]);
      const vault = await viem.deployContract("NoxSwapVault", [
        weth.address,
        usdc.address,
        router.address,
        pool.address,
        3000,
      ]);

      const wait = (hash: `0x${string}`) =>
        publicClient.waitForTransactionReceipt({ hash });

      // Fund users and the mock router's reserves.
      await wait(await weth.write.mint([alice.account.address, parseEther("100")]));
      await wait(await usdc.write.mint([bob.account.address, parseEther("100")]));
      await wait(await weth.write.mint([router.address, parseEther("1000")]));
      await wait(await usdc.write.mint([router.address, parseEther("1000")]));

      // --- deposits ---------------------------------------------------------
      await wait(
        await weth.write.approve([vault.address, parseEther("100")], { account: alice.account }),
      );
      await wait(
        await vault.write.deposit([weth.address, parseEther("100")], { account: alice.account }),
      );
      await wait(
        await usdc.write.approve([vault.address, parseEther("40")], { account: bob.account }),
      );
      await wait(
        await vault.write.deposit([usdc.address, parseEther("40")], { account: bob.account }),
      );

      // --- encrypted intents ------------------------------------------------
      // Alice sells 100 WETH -> USDC (direction 1); Bob sells 40 USDC -> WETH
      // (direction 0). At price 1:1, 40 crosses internally, residual 60 WETH
      // goes through the router.
      const aliceAmt = await nox.encryptInput(parseEther("100"), "uint256", vault.address);
      const aliceDir = await nox.encryptInput(1n, "uint256", vault.address);
      await wait(
        await vault.write.submitIntent(
          [aliceAmt.handle, aliceAmt.handleProof, aliceDir.handle, aliceDir.handleProof],
          { account: alice.account },
        ),
      );

      const bobAmt = await nox.encryptInput(parseEther("40"), "uint256", vault.address);
      const bobDir = await nox.encryptInput(0n, "uint256", vault.address);
      await wait(
        await vault.write.submitIntent(
          [bobAmt.handle, bobAmt.handleProof, bobDir.handle, bobDir.handleProof],
          { account: bob.account },
        ),
      );

      // --- close epoch: only aggregates become publicly decryptable ---------
      const epochId = (await vault.read.currentEpochId()) as bigint;
      await wait(await vault.write.closeEpoch());

      const [h0, h1] = (await vault.read.epochTotalsHandles([epochId])) as [
        `0x${string}`,
        `0x${string}`,
      ];
      await waitForHandleResolved(h0);
      await waitForHandleResolved(h1);

      const dec0 = await nox.publicDecrypt(h0);
      const dec1 = await nox.publicDecrypt(h1);
      assert.equal(dec0.value, parseEther("100")); // aggregate WETH side
      assert.equal(dec1.value, parseEther("40")); // aggregate USDC side

      // --- settle: proofs verified on-chain, residual swapped ---------------
      await wait(
        await vault.write.settleEpoch([epochId, dec0.decryptionProof, dec1.decryptionProof]),
      );

      const info = (await vault.read.epochInfo([epochId])) as unknown as [
        bigint, boolean, boolean, bigint, bigint, bigint, bigint,
      ];
      assert.equal(info[2], true); // settled
      assert.equal(info[3], parseEther("100")); // revealedIn0
      assert.equal(info[4], parseEther("40")); // revealedIn1

      // Residual on-chain swap must be exactly 60 WETH: the router's WETH
      // reserve grew by 60, not by 100 — the netting proof.
      const routerWeth = (await weth.read.balanceOf([router.address])) as bigint;
      assert.equal(routerWeth, parseEther("1060"));

      // --- confidential balances after clearing -----------------------------
      // Alice: sold 100 WETH at 1:1 -> 100 USDC (40 crossed + 60 swapped).
      // Bob:   sold 40 USDC at 1:1 -> 40 WETH.
      const [aliceH0, aliceH1] = (await vault.read.balanceHandles([
        alice.account.address,
      ])) as [`0x${string}`, `0x${string}`];
      await waitForHandleResolved(aliceH1);
      const aliceUsdc = await nox.decrypt(aliceH1);
      assert.equal(aliceUsdc.value, parseEther("100"));
      await waitForHandleResolved(aliceH0);
      const aliceWeth = await nox.decrypt(aliceH0);
      assert.equal(aliceWeth.value, 0n);

      const [bobH0] = (await vault.read.balanceHandles([bob.account.address])) as [
        `0x${string}`,
        `0x${string}`,
      ];
      await waitForHandleResolved(bobH0);
      const bobWeth = await nox.decrypt(bobH0);
      assert.equal(bobWeth.value, parseEther("40"));

      // --- two-phase withdrawal reveals only the withdrawn amount -----------
      const withdrawAmt = await nox.encryptInput(parseEther("40"), "uint256", vault.address);
      await wait(
        await vault.write.requestWithdraw(
          [weth.address, withdrawAmt.handle, withdrawAmt.handleProof],
          { account: bob.account },
        ),
      );
      const reqEvents = await vault.getEvents.WithdrawalRequested();
      const pendingHandle = reqEvents[reqEvents.length - 1].args.amountHandle as `0x${string}`;
      await waitForHandleResolved(pendingHandle);
      const pendingDec = await nox.publicDecrypt(pendingHandle);
      assert.equal(pendingDec.value, parseEther("40"));

      await wait(
        await vault.write.finalizeWithdraw([pendingDec.decryptionProof], {
          account: bob.account,
        }),
      );
      const bobWallet = (await weth.read.balanceOf([bob.account.address])) as bigint;
      assert.equal(bobWallet, parseEther("40"));
    },
  );
});
