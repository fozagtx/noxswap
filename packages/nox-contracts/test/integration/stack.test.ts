import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HANDLE_GATEWAY_URL,
  NOX_COMPUTE_ADDRESS,
  nox,
} from "@iexec-nox/nox-hardhat-plugin";

describe("Nox stack", () => {
  it("handle gateway is up", async () => {
    const response = await fetch(HANDLE_GATEWAY_URL);
    assert.ok(
      response.ok,
      `Handle gateway health check failed with status ${response.status}`,
    );
  });

  it("NoxCompute contract is deployed", async () => {
    const { viem } = await nox.connect();
    const publicClient = await viem.getPublicClient();
    const code = await publicClient.getCode({
      address: NOX_COMPUTE_ADDRESS,
    });
    assert.ok(
      code !== undefined && code !== "0x",
      `No contract deployed at ${NOX_COMPUTE_ADDRESS}`,
    );
  });
});
