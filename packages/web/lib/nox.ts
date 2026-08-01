"use client";

import { createViemHandleClient, type HandleClient } from "@iexec-nox/handle";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  CHAIN,
  NOX_COMPUTE_ADDRESS,
  NOX_GATEWAY_URL,
  NOX_SUBGRAPH_URL,
} from "./config";

export function getPublicClient(): PublicClient {
  return createPublicClient({ chain: CHAIN, transport: http() });
}

export async function connectWallet(): Promise<{
  wallet: WalletClient;
  account: `0x${string}`;
}> {
  const ethereum = (window as any).ethereum;
  if (!ethereum) throw new Error("No wallet found — install MetaMask");
  const wallet = createWalletClient({ chain: CHAIN, transport: custom(ethereum) });
  const [account] = await wallet.requestAddresses();
  try {
    await wallet.switchChain({ id: CHAIN.id });
  } catch {
    await wallet.addChain({ chain: CHAIN });
  }
  return { wallet, account };
}

let handleClient: HandleClient | null = null;

export async function getHandleClient(wallet: WalletClient): Promise<HandleClient> {
  if (handleClient) return handleClient;
  const overrides: Record<string, string> = {};
  if (NOX_GATEWAY_URL) overrides.gatewayUrl = NOX_GATEWAY_URL;
  if (NOX_SUBGRAPH_URL) overrides.subgraphUrl = NOX_SUBGRAPH_URL;
  if (NOX_COMPUTE_ADDRESS) overrides.smartContractAddress = NOX_COMPUTE_ADDRESS;
  handleClient = await createViemHandleClient(
    wallet as any,
    Object.keys(overrides).length ? (overrides as any) : undefined,
  );
  return handleClient;
}

/** Retry an SDK call until the TEE runner has produced the handle ciphertext. */
export async function withHandleRetry<T>(
  fn: () => Promise<T>,
  { attempts = 20, delayMs = 3000 }: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

export const ZERO_HANDLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
