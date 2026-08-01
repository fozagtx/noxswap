import { network } from "hardhat";

// Deploys NoxSwapVault to Ethereum Sepolia against the real Uniswap V3
// contracts. NoxCompute is resolved automatically by the Nox library
// (Sepolia chain id 11155111 is natively supported).
//
// !! Verify these addresses on https://sepolia.etherscan.io before funding:
// they are the canonical Uniswap V3 Sepolia deployment + Circle USDC, but a
// wrong address here means lost testnet funds.
const SWAP_ROUTER_02 = "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E";
const UNISWAP_V3_FACTORY = "0x0227628f3F023bb0B980b67D528571c95c6DaC1c";
const WETH9 = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const POOL_FEE = 3000;

const FACTORY_ABI = [
  {
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    name: "getPool",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

async function main() {
  const { viem } = await network.connect({ network: "sepolia" });
  const publicClient = await viem.getPublicClient();
  const [deployer] = await viem.getWalletClients();
  console.log("deployer:", deployer.account.address);

  const pool = await publicClient.readContract({
    address: UNISWAP_V3_FACTORY,
    abi: FACTORY_ABI,
    functionName: "getPool",
    args: [WETH9, USDC, POOL_FEE],
  });
  if (pool === "0x0000000000000000000000000000000000000000") {
    throw new Error(
      `No WETH/USDC ${POOL_FEE} pool on Sepolia — create/seed one first or pick another fee tier`,
    );
  }
  console.log("uniswap pool:", pool);

  const vault = await viem.deployContract("NoxSwapVault", [
    WETH9,
    USDC,
    SWAP_ROUTER_02,
    pool,
    POOL_FEE,
  ]);
  console.log("NoxSwapVault deployed:", vault.address);
  console.log(
    JSON.stringify(
      { vault: vault.address, weth: WETH9, usdc: USDC, router: SWAP_ROUTER_02, pool, fee: POOL_FEE },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
