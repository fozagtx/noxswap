import { existsSync, readFileSync } from "node:fs";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";
import noxPlugin from "@iexec-nox/nox-hardhat-plugin";

// Minimal .env loader (no dotenv dependency): KEY=VALUE lines only.
if (existsSync(new URL("./.env", import.meta.url))) {
  for (const line of readFileSync(new URL("./.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin, noxPlugin],
  solidity: "0.8.35",
  networks: {
    default: {
      type: "edr-simulated",
      chainType: "op",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: [process.env.PRIVATE_KEY, process.env.PRIVATE_KEY_B].filter(
        (k): k is string => Boolean(k),
      ),
    },
  },
});
