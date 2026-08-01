"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits, type WalletClient } from "viem";
import { erc20Abi, vaultAbi } from "@/lib/abi";
import {
  CHAIN,
  EXPLORER_URL,
  TOKEN0_ADDRESS,
  TOKEN0_DECIMALS,
  TOKEN0_SYMBOL,
  TOKEN1_ADDRESS,
  TOKEN1_DECIMALS,
  TOKEN1_SYMBOL,
  VAULT_ADDRESS,
} from "@/lib/config";
import {
  ZERO_HANDLE,
  connectWallet,
  getHandleClient,
  getPublicClient,
  withHandleRetry,
} from "@/lib/nox";

type LogLine = { at: string; msg: string; href?: string };

const short = (v: string) => `${v.slice(0, 8)}…${v.slice(-6)}`;

export default function Home() {
  const publicClient = useMemo(() => getPublicClient(), []);
  const [wallet, setWallet] = useState<WalletClient | null>(null);
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);

  const [bal0, setBal0] = useState<string | null>(null);
  const [bal1, setBal1] = useState<string | null>(null);
  const [handles, setHandles] = useState<[string, string] | null>(null);

  const [depositToken, setDepositToken] = useState<"t0" | "t1">("t0");
  const [depositAmount, setDepositAmount] = useState("");

  const [sellToken0, setSellToken0] = useState(true);
  const [intentAmount, setIntentAmount] = useState("");

  const [withdrawToken, setWithdrawToken] = useState<"t0" | "t1">("t1");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [pendingHandle, setPendingHandle] = useState<string | null>(null);

  const [epochId, setEpochId] = useState<bigint | null>(null);
  const [epochInfo, setEpochInfo] = useState<{
    participants: bigint;
    closed: boolean;
    settled: boolean;
    in0: bigint;
    in1: bigint;
  } | null>(null);
  const [lastClosedId, setLastClosedId] = useState<bigint | null>(null);

  const say = useCallback((msg: string, href?: string) => {
    setLog((l) => [{ at: new Date().toLocaleTimeString(), msg, href }, ...l].slice(0, 30));
  }, []);

  const refresh = useCallback(async () => {
    if (!account) return;
    const [h0, h1] = (await publicClient.readContract({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: "balanceHandles",
      args: [account],
    })) as [string, string];
    setHandles([h0, h1]);
    const id = (await publicClient.readContract({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: "currentEpochId",
    })) as bigint;
    setEpochId(id);
    if (id > 0n) setLastClosedId(id - 1n);
    const info = (await publicClient.readContract({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: "epochInfo",
      args: [id],
    })) as readonly [bigint, boolean, boolean, bigint, bigint, bigint, bigint];
    setEpochInfo({
      participants: info[0],
      closed: info[1],
      settled: info[2],
      in0: info[3],
      in1: info[4],
    });
  }, [account, publicClient]);

  useEffect(() => {
    refresh().catch(() => undefined);
    const t = setInterval(() => refresh().catch(() => undefined), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (err: any) {
      say(`✗ ${label} failed: ${err?.shortMessage ?? err?.message ?? String(err)}`);
    } finally {
      setBusy(null);
      refresh().catch(() => undefined);
    }
  };

  const onConnect = () =>
    run("connect", async () => {
      const { wallet: w, account: a } = await connectWallet();
      setWallet(w);
      setAccount(a);
      say(`connected ${short(a)} on ${CHAIN.name}`);
    });

  const writeVault = async (functionName: string, args: unknown[]) => {
    if (!wallet || !account) throw new Error("connect a wallet first");
    const hash = await wallet.writeContract({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: functionName as any,
      args: args as any,
      account,
      chain: CHAIN,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  };

  const onDeposit = () =>
    run("deposit", async () => {
      if (!wallet || !account) throw new Error("connect a wallet first");
      const token = depositToken === "t0" ? TOKEN0_ADDRESS : TOKEN1_ADDRESS;
      const decimals = depositToken === "t0" ? TOKEN0_DECIMALS : TOKEN1_DECIMALS;
      const amount = parseUnits(depositAmount, decimals);
      const approveHash = await wallet.writeContract({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [VAULT_ADDRESS, amount],
        account,
        chain: CHAIN,
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
      const hash = await writeVault("deposit", [token, amount]);
      say(`✓ deposited ${depositAmount} ${depositToken === "t0" ? TOKEN0_SYMBOL : TOKEN1_SYMBOL}`, `${EXPLORER_URL}/tx/${hash}`);
    });

  const onSubmitIntent = () =>
    run("submit intent", async () => {
      if (!wallet || !account) throw new Error("connect a wallet first");
      const nox = await getHandleClient(wallet);
      const decimals = sellToken0 ? TOKEN0_DECIMALS : TOKEN1_DECIMALS;
      const amount = parseUnits(intentAmount, decimals);
      say("encrypting intent (amount + direction) …");
      const encAmount = await nox.encryptInput(amount, "uint256", VAULT_ADDRESS);
      const encDir = await nox.encryptInput(sellToken0 ? 1n : 0n, "uint256", VAULT_ADDRESS);
      const hash = await writeVault("submitIntent", [
        encAmount.handle,
        encAmount.handleProof,
        encDir.handle,
        encDir.handleProof,
      ]);
      say(
        `✓ sealed intent submitted — on-chain only handle ${short(encAmount.handle as string)}`,
        `${EXPLORER_URL}/tx/${hash}`,
      );
    });

  const onDecryptBalances = () =>
    run("decrypt balances", async () => {
      if (!wallet || !handles) throw new Error("connect and refresh first");
      const nox = await getHandleClient(wallet);
      if (handles[0] !== ZERO_HANDLE) {
        const d0 = await withHandleRetry(() => nox.decrypt(handles[0] as any));
        setBal0(formatUnits(d0.value as bigint, TOKEN0_DECIMALS));
      } else setBal0("0");
      if (handles[1] !== ZERO_HANDLE) {
        const d1 = await withHandleRetry(() => nox.decrypt(handles[1] as any));
        setBal1(formatUnits(d1.value as bigint, TOKEN1_DECIMALS));
      } else setBal1("0");
      say("✓ balances decrypted locally (ACL-gated — only you can)");
    });

  const onCloseEpoch = () =>
    run("close epoch", async () => {
      const hash = await writeVault("closeEpoch", []);
      say("✓ epoch closed — only the two aggregate sums became decryptable", `${EXPLORER_URL}/tx/${hash}`);
    });

  const onSettle = () =>
    run("settle epoch", async () => {
      if (!wallet || lastClosedId === null) throw new Error("nothing to settle");
      const nox = await getHandleClient(wallet);
      const [h0, h1] = (await publicClient.readContract({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "epochTotalsHandles",
        args: [lastClosedId],
      })) as [string, string];
      say("fetching public decryption proofs from the Nox gateway …");
      const d0 = await withHandleRetry(() => nox.publicDecrypt(h0 as any));
      const d1 = await withHandleRetry(() => nox.publicDecrypt(h1 as any));
      say(
        `aggregates revealed: ${formatUnits(d0.value as bigint, TOKEN0_DECIMALS)} ${TOKEN0_SYMBOL} vs ${formatUnits(
          d1.value as bigint,
          TOKEN1_DECIMALS,
        )} ${TOKEN1_SYMBOL}`,
      );
      const hash = await writeVault("settleEpoch", [
        lastClosedId,
        d0.decryptionProof,
        d1.decryptionProof,
      ]);
      say("✓ settled — netted internally, residual swapped on Uniswap", `${EXPLORER_URL}/tx/${hash}`);
    });

  const onRequestWithdraw = () =>
    run("request withdrawal", async () => {
      if (!wallet || !account) throw new Error("connect a wallet first");
      const nox = await getHandleClient(wallet);
      const token = withdrawToken === "t0" ? TOKEN0_ADDRESS : TOKEN1_ADDRESS;
      const decimals = withdrawToken === "t0" ? TOKEN0_DECIMALS : TOKEN1_DECIMALS;
      const amount = parseUnits(withdrawAmount, decimals);
      const enc = await nox.encryptInput(amount, "uint256", VAULT_ADDRESS);
      const hash = await writeVault("requestWithdraw", [token, enc.handle, enc.handleProof]);
      const logs = await publicClient.getContractEvents({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        eventName: "WithdrawalRequested",
        args: { user: account },
        fromBlock: "earliest",
      });
      const last = logs[logs.length - 1];
      const handle = (last?.args as any)?.amountHandle as string;
      setPendingHandle(handle);
      say(`✓ withdrawal requested — pending handle ${short(handle)}`, `${EXPLORER_URL}/tx/${hash}`);
    });

  const onFinalizeWithdraw = () =>
    run("finalize withdrawal", async () => {
      if (!wallet || !pendingHandle) throw new Error("request a withdrawal first");
      const nox = await getHandleClient(wallet);
      const dec = await withHandleRetry(() => nox.publicDecrypt(pendingHandle as any));
      const hash = await writeVault("finalizeWithdraw", [dec.decryptionProof]);
      setPendingHandle(null);
      say("✓ withdrawal finalized — proof verified on-chain", `${EXPLORER_URL}/tx/${hash}`);
    });

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Nox<span className="text-glow">Swap</span>
          </h1>
          <p className="text-sm text-zinc-500">
            A dark pool over Uniswap — encrypted intents, TEE netting, residual-only execution.
          </p>
        </div>
        {account ? (
          <span className="rounded-xl border border-edge bg-panel px-3 py-2 font-mono text-xs text-mint">
            {short(account)}
          </span>
        ) : (
          <button className="btn" onClick={onConnect} disabled={busy !== null}>
            Connect wallet
          </button>
        )}
      </header>

      <div className="grid gap-5 md:grid-cols-3">
        {/* ---------------------------------------------------- balances */}
        <section className="card space-y-4">
          <h2 className="font-semibold text-white">Confidential balances</h2>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-zinc-400">{TOKEN0_SYMBOL}</span>
              <span className="text-lg font-semibold text-white">{bal0 ?? "•••••"}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-zinc-400">{TOKEN1_SYMBOL}</span>
              <span className="text-lg font-semibold text-white">{bal1 ?? "•••••"}</span>
            </div>
          </div>
          {handles && (
            <p className="mono break-all">
              on-chain: {handles[0] === ZERO_HANDLE ? "—" : short(handles[0])} /{" "}
              {handles[1] === ZERO_HANDLE ? "—" : short(handles[1])}
            </p>
          )}
          <button className="btn-ghost w-full" onClick={onDecryptBalances} disabled={!account || busy !== null}>
            {busy === "decrypt balances" ? "decrypting…" : "Decrypt (owner-only)"}
          </button>

          <hr className="border-edge" />
          <h3 className="text-sm font-semibold text-white">Deposit</h3>
          <div className="flex gap-2">
            <select className="input w-28" value={depositToken} onChange={(e) => setDepositToken(e.target.value as any)}>
              <option value="t0">{TOKEN0_SYMBOL}</option>
              <option value="t1">{TOKEN1_SYMBOL}</option>
            </select>
            <input className="input" placeholder="0.0" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} />
          </div>
          <button className="btn w-full" onClick={onDeposit} disabled={!account || !depositAmount || busy !== null}>
            {busy === "deposit" ? "depositing…" : "Deposit"}
          </button>

          <hr className="border-edge" />
          <h3 className="text-sm font-semibold text-white">Withdraw (two-phase)</h3>
          <div className="flex gap-2">
            <select className="input w-28" value={withdrawToken} onChange={(e) => setWithdrawToken(e.target.value as any)}>
              <option value="t0">{TOKEN0_SYMBOL}</option>
              <option value="t1">{TOKEN1_SYMBOL}</option>
            </select>
            <input className="input" placeholder="0.0" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={onRequestWithdraw} disabled={!account || !withdrawAmount || busy !== null}>
              1 · Request
            </button>
            <button className="btn flex-1" onClick={onFinalizeWithdraw} disabled={!pendingHandle || busy !== null}>
              2 · Finalize
            </button>
          </div>
        </section>

        {/* ------------------------------------------------------- intent */}
        <section className="card space-y-4">
          <h2 className="font-semibold text-white">Sealed swap intent</h2>
          <p className="text-sm text-zinc-500">
            Amount <em>and</em> direction are encrypted client-side. The chain stores an opaque
            handle; bots see nothing to sandwich.
          </p>
          <div className="flex overflow-hidden rounded-xl border border-edge">
            <button
              className={`flex-1 px-3 py-2 text-sm font-semibold ${sellToken0 ? "bg-glow text-white" : "text-zinc-400"}`}
              onClick={() => setSellToken0(true)}
            >
              Sell {TOKEN0_SYMBOL} → {TOKEN1_SYMBOL}
            </button>
            <button
              className={`flex-1 px-3 py-2 text-sm font-semibold ${!sellToken0 ? "bg-glow text-white" : "text-zinc-400"}`}
              onClick={() => setSellToken0(false)}
            >
              Sell {TOKEN1_SYMBOL} → {TOKEN0_SYMBOL}
            </button>
          </div>
          <div>
            <span className="label">Amount ({sellToken0 ? TOKEN0_SYMBOL : TOKEN1_SYMBOL})</span>
            <input className="input" placeholder="0.0" value={intentAmount} onChange={(e) => setIntentAmount(e.target.value)} />
          </div>
          <button className="btn w-full" onClick={onSubmitIntent} disabled={!account || !intentAmount || busy !== null}>
            {busy === "submit intent" ? "encrypting & submitting…" : "Encrypt & submit intent"}
          </button>
          <p className="text-xs text-zinc-600">
            Insufficient balance? The intent silently becomes enc(0) — reverting would leak the
            comparison.
          </p>
        </section>

        {/* -------------------------------------------------------- epoch */}
        <section className="card space-y-4">
          <h2 className="font-semibold text-white">Batch epoch</h2>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">current epoch</span>
              <span className="font-mono text-white">#{epochId?.toString() ?? "…"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">participants</span>
              <span className="font-mono text-white">{epochInfo?.participants.toString() ?? "…"}</span>
            </div>
          </div>
          <button
            className="btn-ghost w-full"
            onClick={onCloseEpoch}
            disabled={!account || busy !== null || (epochInfo ? epochInfo.participants === 0n : true)}
          >
            {busy === "close epoch" ? "closing…" : "Close epoch (reveal aggregates only)"}
          </button>
          <button
            className="btn w-full"
            onClick={onSettle}
            disabled={!account || busy !== null || lastClosedId === null}
          >
            {busy === "settle epoch" ? "settling…" : `Settle epoch #${lastClosedId?.toString() ?? "—"}`}
          </button>
          <p className="text-xs text-zinc-600">
            Settlement is permissionless: proofs are verified on-chain by NoxCompute, opposing flow
            crosses at spot, only the residual touches Uniswap.
          </p>
        </section>
      </div>

      {/* ------------------------------------------------------------ log */}
      <section className="card mt-5">
        <h2 className="mb-3 font-semibold text-white">Activity</h2>
        <ul className="space-y-1">
          {log.length === 0 && <li className="text-sm text-zinc-600">nothing yet — connect and make a move</li>}
          {log.map((l, i) => (
            <li key={i} className="text-sm">
              <span className="mono mr-2">{l.at}</span>
              {l.href ? (
                <a className="text-glow underline-offset-2 hover:underline" href={l.href} target="_blank" rel="noreferrer">
                  {l.msg}
                </a>
              ) : (
                <span className="text-zinc-300">{l.msg}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <footer className="mt-8 text-center text-xs text-zinc-600">
        Built on iExec Nox (Intel TDX TEEs) · Uniswap stays unmodified · Sepolia testnet
      </footer>
    </main>
  );
}
