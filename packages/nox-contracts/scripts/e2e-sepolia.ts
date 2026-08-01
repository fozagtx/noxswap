import { network } from "hardhat";
import { createWalletClient, formatUnits, http, parseAbi, parseEther, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { createViemHandleClient } from "@iexec-nox/handle";

// Full NoxSwap demo flow against Ethereum Sepolia + the hosted Nox stack.
// Run after deploy-sepolia.ts:
//   VAULT=0x... PRIVATE_KEY=0x... PRIVATE_KEY_B=0x... \
//     npx hardhat run scripts/e2e-sepolia.ts --network sepolia
//
// Two funded wallets are required: Alice sells WETH, Bob sells USDC — a real
// two-party dark-pool crossing. The script fails hard if either is missing.

const VAULT = process.env.VAULT as `0x${string}`;
const WETH9 = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14" as const;
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as const;
const SWAP_ROUTER_02 = "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E" as const;

// Small demo sizes: enough to be visible, cheap on faucet ETH.
const WETH_INTENT = parseEther("0.002");
const USDC_INTENT = parseUnits("1", 6);

const wethAbi = parseAbi([
  "function deposit() payable",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);
const routerAbi = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256)",
]);
const vaultAbi = parseAbi([
  "function deposit(address token, uint256 amount)",
  "function submitIntent(bytes32 amountHandle, bytes amountProof, bytes32 dirHandle, bytes dirProof)",
  "function requestWithdraw(address token, bytes32 amountHandle, bytes amountProof)",
  "function finalizeWithdraw(bytes decryptionProof)",
  "function closeEpoch()",
  "function settleEpoch(uint256 epochId, bytes proofIn0, bytes proofIn1)",
  "function currentEpochId() view returns (uint256)",
  "function balanceHandles(address user) view returns (bytes32, bytes32)",
  "function epochTotalsHandles(uint256 epochId) view returns (bytes32, bytes32)",
  "function epochInfo(uint256 epochId) view returns (uint256, bool, bool, uint256, uint256, uint256, uint256)",
  "event WithdrawalRequested(address indexed user, address indexed token, bytes32 amountHandle)",
]);

const retry = async <T>(label: string, fn: () => Promise<T>, tries = 30, delayMs = 4000): Promise<T> => {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i % 5 === 0) console.log(`  … waiting on ${label} (attempt ${i + 1})`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
};

async function main() {
  if (!VAULT) throw new Error("set VAULT=0x… (deployed NoxSwapVault)");
  const { viem } = await network.connect({ network: "sepolia" });
  const publicClient = await viem.getPublicClient();
  const wallets = await viem.getWalletClients();
  if (wallets.length < 2) {
    throw new Error("two funded wallets required — set PRIVATE_KEY and PRIVATE_KEY_B");
  }
  const alice = wallets[0];
  const bob = wallets[1];
  console.log("alice:", alice.account.address);
  console.log("bob:  ", bob.account.address);

  const wait = async (hash: `0x${string}`, label: string) => {
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✓ ${label}: https://sepolia.etherscan.io/tx/${hash}`);
  };

  // The handle SDK derives the proof's bound user from getAddresses()[0].
  // Hardhat wallet clients share one provider listing every account, which
  // binds all proofs to account[0]. Give the SDK standalone single-account
  // clients so each proof is bound to its actual submitter.
  const sdkWallet = (pk: string) =>
    createWalletClient({
      account: privateKeyToAccount(pk as `0x${string}`),
      chain: sepolia,
      transport: http(process.env.SEPOLIA_RPC_URL),
    });
  if (!process.env.PRIVATE_KEY || !process.env.PRIVATE_KEY_B) {
    throw new Error("PRIVATE_KEY and PRIVATE_KEY_B are required");
  }
  const noxAlice = await createViemHandleClient(sdkWallet(process.env.PRIVATE_KEY) as any);
  const noxBob = await createViemHandleClient(sdkWallet(process.env.PRIVATE_KEY_B) as any);

  // ------------------------------------------------- acquire demo tokens
  const wethBal = (await publicClient.readContract({
    address: WETH9, abi: wethAbi, functionName: "balanceOf", args: [alice.account.address],
  })) as bigint;
  if (wethBal < WETH_INTENT * 2n) {
    await wait(
      await alice.writeContract({
        address: WETH9, abi: wethAbi, functionName: "deposit",
        value: WETH_INTENT * 3n, chain: null, account: alice.account,
      }),
      "wrapped ETH -> WETH",
    );
  }
  const usdcHolder = bob;
  const usdcBal = (await publicClient.readContract({
    address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [usdcHolder.account.address],
  })) as bigint;
  if (usdcBal < USDC_INTENT) {
    // Buy USDC with WETH through Uniswap so the demo is self-funding.
    await wait(
      await alice.writeContract({
        address: WETH9, abi: wethAbi, functionName: "approve",
        args: [SWAP_ROUTER_02, WETH_INTENT], chain: null, account: alice.account,
      }),
      "approve router for WETH",
    );
    await wait(
      await alice.writeContract({
        address: SWAP_ROUTER_02, abi: routerAbi, functionName: "exactInputSingle",
        args: [{
          tokenIn: WETH9, tokenOut: USDC, fee: 3000,
          recipient: usdcHolder.account.address,
          amountIn: WETH_INTENT, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n,
        }],
        chain: null, account: alice.account,
      }),
      "swapped WETH -> USDC for demo funds",
    );
  }

  // ---------------------------------------------------------- deposits
  await wait(
    await alice.writeContract({
      address: WETH9, abi: wethAbi, functionName: "approve",
      args: [VAULT, WETH_INTENT], chain: null, account: alice.account,
    }),
    "alice approve vault (WETH)",
  );
  await wait(
    await alice.writeContract({
      address: VAULT, abi: vaultAbi, functionName: "deposit",
      args: [WETH9, WETH_INTENT], chain: null, account: alice.account,
    }),
    "alice deposit WETH",
  );
  await wait(
    await usdcHolder.writeContract({
      address: USDC, abi: erc20Abi, functionName: "approve",
      args: [VAULT, USDC_INTENT], chain: null, account: usdcHolder.account,
    }),
    "bob approve vault (USDC)",
  );
  await wait(
    await usdcHolder.writeContract({
      address: VAULT, abi: vaultAbi, functionName: "deposit",
      args: [USDC, USDC_INTENT], chain: null, account: usdcHolder.account,
    }),
    "bob deposit USDC",
  );

  // ------------------------------------------------- encrypted intents
  console.log("encrypting intents (amount + direction sealed) …");
  const aAmt = await noxAlice.encryptInput(WETH_INTENT, "uint256", VAULT);
  const aDir = await noxAlice.encryptInput(1n, "uint256", VAULT);
  await wait(
    await alice.writeContract({
      address: VAULT, abi: vaultAbi, functionName: "submitIntent",
      args: [aAmt.handle as `0x${string}`, aAmt.handleProof as `0x${string}`, aDir.handle as `0x${string}`, aDir.handleProof as `0x${string}`],
      chain: null, account: alice.account,
    }),
    "alice sealed intent (sell WETH)",
  );
  const bAmt = await noxBob.encryptInput(USDC_INTENT, "uint256", VAULT);
  const bDir = await noxBob.encryptInput(0n, "uint256", VAULT);
  await wait(
    await usdcHolder.writeContract({
      address: VAULT, abi: vaultAbi, functionName: "submitIntent",
      args: [bAmt.handle as `0x${string}`, bAmt.handleProof as `0x${string}`, bDir.handle as `0x${string}`, bDir.handleProof as `0x${string}`],
      chain: null, account: usdcHolder.account,
    }),
    "bob sealed intent (sell USDC)",
  );

  // -------------------------------------------------- close + settle
  const epochId = (await publicClient.readContract({
    address: VAULT, abi: vaultAbi, functionName: "currentEpochId",
  })) as bigint;
  await wait(
    await alice.writeContract({
      address: VAULT, abi: vaultAbi, functionName: "closeEpoch",
      chain: null, account: alice.account,
    }),
    `closed epoch #${epochId} (aggregates only revealed)`,
  );
  const [h0, h1] = (await publicClient.readContract({
    address: VAULT, abi: vaultAbi, functionName: "epochTotalsHandles", args: [epochId],
  })) as [`0x${string}`, `0x${string}`];
  const d0 = await retry("aggregate #0 proof", () => noxAlice.publicDecrypt(h0 as any));
  const d1 = await retry("aggregate #1 proof", () => noxAlice.publicDecrypt(h1 as any));
  console.log(
    `aggregates: ${formatUnits(d0.value as bigint, 18)} WETH vs ${formatUnits(d1.value as bigint, 6)} USDC`,
  );
  await wait(
    await alice.writeContract({
      address: VAULT, abi: vaultAbi, functionName: "settleEpoch",
      args: [epochId, d0.decryptionProof as `0x${string}`, d1.decryptionProof as `0x${string}`],
      chain: null, account: alice.account,
    }),
    "settled — netted internally, residual swapped on Uniswap",
  );
  const info = (await publicClient.readContract({
    address: VAULT, abi: vaultAbi, functionName: "epochInfo", args: [epochId],
  })) as readonly [bigint, boolean, boolean, bigint, bigint, bigint, bigint];
  console.log("epoch info:", {
    participants: info[0], settled: info[2],
    in0: formatUnits(info[3], 18), in1: formatUnits(info[4], 6),
    out1ForSide0: formatUnits(info[5], 6), out0ForSide1: formatUnits(info[6], 18),
  });

  // ------------------------------------------ decrypt final balances
  const [aH0, aH1] = (await publicClient.readContract({
    address: VAULT, abi: vaultAbi, functionName: "balanceHandles", args: [alice.account.address],
  })) as [`0x${string}`, `0x${string}`];
  const aBal1 = await retry("alice USDC balance", () => noxAlice.decrypt(aH1 as any));
  console.log(`alice confidential USDC after clearing: ${formatUnits(aBal1.value as bigint, 6)}`);
  const [bH0] = (await publicClient.readContract({
    address: VAULT, abi: vaultAbi, functionName: "balanceHandles", args: [usdcHolder.account.address],
  })) as [`0x${string}`, `0x${string}`];
  const bBal0 = await retry("bob WETH balance", () => noxBob.decrypt(bH0 as any));
  console.log(`bob confidential WETH after clearing: ${formatUnits(bBal0.value as bigint, 18)}`);

  console.log("\nDone. Save these tx links for the demo video.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
