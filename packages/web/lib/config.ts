import { sepolia } from "viem/chains";

// Deployed addresses come from env so the same build serves local + Sepolia.
export const CHAIN = sepolia;

if (!process.env.NEXT_PUBLIC_VAULT_ADDRESS) {
  throw new Error(
    "NEXT_PUBLIC_VAULT_ADDRESS is not set — deploy NoxSwapVault and set it before building. No fallback.",
  );
}
export const VAULT_ADDRESS = process.env.NEXT_PUBLIC_VAULT_ADDRESS as `0x${string}`;
export const TOKEN0_ADDRESS = (process.env.NEXT_PUBLIC_TOKEN0 ??
  "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14") as `0x${string}`; // WETH (Sepolia)
export const TOKEN1_ADDRESS = (process.env.NEXT_PUBLIC_TOKEN1 ??
  "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238") as `0x${string}`; // USDC (Sepolia)

export const TOKEN0_SYMBOL = process.env.NEXT_PUBLIC_TOKEN0_SYMBOL ?? "WETH";
export const TOKEN1_SYMBOL = process.env.NEXT_PUBLIC_TOKEN1_SYMBOL ?? "USDC";
export const TOKEN0_DECIMALS = Number(process.env.NEXT_PUBLIC_TOKEN0_DECIMALS ?? 18);
export const TOKEN1_DECIMALS = Number(process.env.NEXT_PUBLIC_TOKEN1_DECIMALS ?? 6);

// Optional Nox client overrides (defaults resolved by the SDK per chain).
export const NOX_GATEWAY_URL = process.env.NEXT_PUBLIC_NOX_GATEWAY_URL;
export const NOX_SUBGRAPH_URL = process.env.NEXT_PUBLIC_NOX_SUBGRAPH_URL;
export const NOX_COMPUTE_ADDRESS = process.env.NEXT_PUBLIC_NOX_COMPUTE_ADDRESS;

export const EXPLORER_URL = "https://sepolia.etherscan.io";
