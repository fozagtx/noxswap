import { setTimeout as sleep } from "node:timers/promises";
import { type Hex } from "viem";
import { HANDLE_GATEWAY_URL } from "@iexec-nox/nox-hardhat-plugin";

/**
 * Polls the Nox handle gateway until `handle` is reported as resolved (i.e.
 * its ciphertext has been produced by the runner and stored in S3), or throws
 * once `timeoutMs` elapses. Uses exponential backoff to keep the gateway quiet
 * on slow runs while staying responsive on fast ones.
 */
export async function waitForHandleResolved(
  handle: Hex,
  {
    timeoutMs = 60_000,
    initialPollMs = 500,
    maxPollMs = 5_000,
    backoffFactor = 1.5,
  }: {
    timeoutMs?: number;
    initialPollMs?: number;
    maxPollMs?: number;
    backoffFactor?: number;
  } = {},
): Promise<void> {
  const url = `${HANDLE_GATEWAY_URL}/v0/public/handles/status`;
  const deadline = Date.now() + timeoutMs;
  let pollMs = initialPollMs;

  while (Date.now() < deadline) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handles: [handle] }),
    });
    if (res.ok) {
      const body = (await res.json()) as {
        payload: {
          statuses: Array<{ handle: string; resolved: boolean }>;
        };
      };
      const resolved = body.payload.statuses.some(
        (s) =>
          s.handle.toLowerCase() === handle.toLowerCase() &&
          s.resolved === true,
      );
      if (resolved) return;
    }
    await sleep(pollMs);
    pollMs = Math.min(pollMs * backoffFactor, maxPollMs);
  }

  throw new Error(
    `Handle ${handle} was not resolved by the local Nox stack within ${timeoutMs}ms`,
  );
}
