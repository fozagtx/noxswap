"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Input,
  Tab,
  Tabs,
} from "@heroui/react";
import { Icon } from "@iconify/react";
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
import { NoxSwapMark } from "@/components/logo";

type LogLine = { at: string; msg: string; href?: string };

const short = (v: string) => `${v.slice(0, 6)}…${v.slice(-4)}`;

export default function App() {
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
  } | null>(null);
  const [lastClosedId, setLastClosedId] = useState<bigint | null>(null);

  const say = useCallback((msg: string, href?: string) => {
    setLog((l) => [{ at: new Date().toLocaleTimeString(), msg, href }, ...l].slice(0, 30));
  }, []);

  const refresh = useCallback(async () => {
    if (account) {
      const [h0, h1] = (await publicClient.readContract({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "balanceHandles",
        args: [account],
      })) as [string, string];
      setHandles([h0, h1]);
    }
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
    setEpochInfo({ participants: info[0], closed: info[1], settled: info[2] });
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
      say(`${label} failed: ${err?.shortMessage ?? err?.message ?? String(err)}`);
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
      say(`Wallet connected on ${CHAIN.name}`);
    });

  const writeVault = async (functionName: string, args: unknown[]) => {
    if (!wallet || !account) throw new Error("Connect a wallet first");
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
      if (!wallet || !account) throw new Error("Connect a wallet first");
      const token = depositToken === "t0" ? TOKEN0_ADDRESS : TOKEN1_ADDRESS;
      const decimals = depositToken === "t0" ? TOKEN0_DECIMALS : TOKEN1_DECIMALS;
      const symbol = depositToken === "t0" ? TOKEN0_SYMBOL : TOKEN1_SYMBOL;
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
      say(`Deposited ${depositAmount} ${symbol}. From here on, your balance is private.`, `${EXPLORER_URL}/tx/${hash}`);
      setDepositAmount("");
    });

  const onSubmitIntent = () =>
    run("place order", async () => {
      if (!wallet || !account) throw new Error("Connect a wallet first");
      const nox = await getHandleClient(wallet);
      const decimals = sellToken0 ? TOKEN0_DECIMALS : TOKEN1_DECIMALS;
      const amount = parseUnits(intentAmount, decimals);
      say("Sealing your order in the browser…");
      const encAmount = await nox.encryptInput(amount, "uint256", VAULT_ADDRESS);
      const encDir = await nox.encryptInput(sellToken0 ? 1n : 0n, "uint256", VAULT_ADDRESS);
      const hash = await writeVault("submitIntent", [
        encAmount.handle,
        encAmount.handleProof,
        encDir.handle,
        encDir.handleProof,
      ]);
      say("Order placed. The chain sees a sealed envelope, nothing else.", `${EXPLORER_URL}/tx/${hash}`);
      setIntentAmount("");
    });

  const onReveal = () =>
    run("reveal balances", async () => {
      if (!wallet || !handles) throw new Error("Connect and try again");
      const nox = await getHandleClient(wallet);
      if (handles[0] !== ZERO_HANDLE) {
        const d0 = await withHandleRetry(() => nox.decrypt(handles[0] as any));
        setBal0(formatUnits(d0.value as bigint, TOKEN0_DECIMALS));
      } else setBal0("0");
      if (handles[1] !== ZERO_HANDLE) {
        const d1 = await withHandleRetry(() => nox.decrypt(handles[1] as any));
        setBal1(formatUnits(d1.value as bigint, TOKEN1_DECIMALS));
      } else setBal1("0");
      say("Balances revealed on your screen only. They stay private on chain.");
    });

  const onCloseEpoch = () =>
    run("close batch", async () => {
      const hash = await writeVault("closeEpoch", []);
      say("Batch closed. Only the two batch totals become public.", `${EXPLORER_URL}/tx/${hash}`);
    });

  const onSettle = () =>
    run("settle batch", async () => {
      if (!wallet || lastClosedId === null) throw new Error("Nothing to settle yet");
      const nox = await getHandleClient(wallet);
      const [h0, h1] = (await publicClient.readContract({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "epochTotalsHandles",
        args: [lastClosedId],
      })) as [string, string];
      say("Fetching settlement proofs…");
      const d0 = await withHandleRetry(() => nox.publicDecrypt(h0 as any));
      const d1 = await withHandleRetry(() => nox.publicDecrypt(h1 as any));
      say(
        `Batch totals: ${formatUnits(d0.value as bigint, TOKEN0_DECIMALS)} ${TOKEN0_SYMBOL} and ${formatUnits(
          d1.value as bigint,
          TOKEN1_DECIMALS,
        )} ${TOKEN1_SYMBOL}`,
      );
      const hash = await writeVault("settleEpoch", [
        lastClosedId,
        d0.decryptionProof,
        d1.decryptionProof,
      ]);
      say("Batch settled. Matched orders paired privately, only the leftover traded on Uniswap.", `${EXPLORER_URL}/tx/${hash}`);
    });

  const onRequestWithdraw = () =>
    run("request withdrawal", async () => {
      if (!wallet || !account) throw new Error("Connect a wallet first");
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
      setPendingHandle(((last?.args as any)?.amountHandle as string) ?? null);
      say("Withdrawal requested. Claim it once it clears.", `${EXPLORER_URL}/tx/${hash}`);
    });

  const onFinalizeWithdraw = () =>
    run("claim withdrawal", async () => {
      if (!wallet || !pendingHandle) throw new Error("Request a withdrawal first");
      const nox = await getHandleClient(wallet);
      const dec = await withHandleRetry(() => nox.publicDecrypt(pendingHandle as any));
      const hash = await writeVault("finalizeWithdraw", [dec.decryptionProof]);
      setPendingHandle(null);
      setWithdrawAmount("");
      say("Withdrawal claimed. Funds are back in your wallet.", `${EXPLORER_URL}/tx/${hash}`);
    });

  const connected = Boolean(account);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      {/* Top bar */}
      <div className="mb-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-large bg-content1 shadow-small">
            <NoxSwapMark size={26} />
          </div>
          <p className="text-large font-semibold">NoxSwap</p>
        </Link>
        {connected ? (
          <Chip
            color="success"
            variant="flat"
            startContent={<Icon icon="solar:wallet-money-linear" width={16} />}
          >
            <span className="font-mono">{short(account!)}</span>
          </Chip>
        ) : (
          <Button
            color="primary"
            radius="full"
            isLoading={busy === "connect"}
            startContent={busy !== "connect" ? <Icon icon="solar:wallet-money-bold" width={18} /> : undefined}
            onPress={onConnect}
          >
            Connect wallet
          </Button>
        )}
      </div>

      {/* Status chips */}
      <div className="mb-6 flex flex-wrap gap-2">
        <Chip size="sm" variant="flat" color="secondary">
          Sepolia testnet
        </Chip>
        <Chip size="sm" variant="flat">
          Batch #{epochId?.toString() ?? "0"}
        </Chip>
        <Chip size="sm" variant="flat">
          {epochInfo ? `${epochInfo.participants.toString()} sealed orders` : "loading"}
        </Chip>
      </div>

      {/* Gate card: connect or balances */}
      {!connected ? (
        <Card shadow="sm" className="mb-6 border-small border-default-200">
          <CardBody className="flex flex-col items-center gap-3 p-8 text-center">
            <NoxSwapMark size={40} />
            <p className="text-large font-medium">Ready when you are</p>
            <p className="max-w-sm text-small text-default-500">
              Connect a wallet on Sepolia to deposit funds and place your first sealed order.
            </p>
            <Button
              color="primary"
              radius="full"
              isLoading={busy === "connect"}
              startContent={busy !== "connect" ? <Icon icon="solar:wallet-money-bold" width={18} /> : undefined}
              onPress={onConnect}
            >
              Connect wallet
            </Button>
          </CardBody>
        </Card>
      ) : (
        <Card shadow="sm" className="mb-6 border-small border-default-200">
          <CardHeader className="flex items-center justify-between px-4 pb-0 pt-4">
            <div>
              <p className="text-large">Your private balance</p>
              <p className="text-small text-default-500">
                Only you can reveal it, and only on your screen.
              </p>
            </div>
            <Button
              variant="bordered"
              radius="full"
              size="sm"
              isLoading={busy === "reveal balances"}
              startContent={busy !== "reveal balances" ? <Icon icon="solar:eye-linear" width={16} /> : undefined}
              onPress={onReveal}
            >
              Reveal
            </Button>
          </CardHeader>
          <CardBody className="gap-2 p-4">
            <div className="flex items-center justify-between rounded-medium bg-content2 px-4 py-3">
              <p className="text-small text-default-500">{TOKEN0_SYMBOL}</p>
              <p className="font-mono text-medium">{bal0 ?? "•••••"}</p>
            </div>
            <div className="flex items-center justify-between rounded-medium bg-content2 px-4 py-3">
              <p className="text-small text-default-500">{TOKEN1_SYMBOL}</p>
              <p className="font-mono text-medium">{bal1 ?? "•••••"}</p>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Main form card */}
      <Card shadow="sm" className="mb-6 border-small border-default-200">
        <CardBody className="p-4">
          <Tabs aria-label="Actions" variant="underlined" color="primary">
            <Tab
              key="swap"
              title={
                <div className="flex items-center gap-2">
                  <Icon icon="solar:lock-keyhole-linear" width={16} />
                  <span>Sealed order</span>
                </div>
              }
            >
              <div className="flex flex-col gap-4 pt-2">
                <Tabs
                  aria-label="Direction"
                  selectedKey={sellToken0 ? "sell0" : "sell1"}
                  onSelectionChange={(k) => setSellToken0(k === "sell0")}
                  radius="full"
                  fullWidth
                  classNames={{
                    tabList: "bg-content2",
                    cursor: "!bg-primary",
                    tab: "data-[selected=true]:!bg-primary rounded-full",
                    tabContent: "group-data-[selected=true]:!text-white",
                  }}
                >
                  <Tab key="sell0" title={`Sell ${TOKEN0_SYMBOL} for ${TOKEN1_SYMBOL}`} />
                  <Tab key="sell1" title={`Sell ${TOKEN1_SYMBOL} for ${TOKEN0_SYMBOL}`} />
                </Tabs>
                <Input
                  label={`Amount in ${sellToken0 ? TOKEN0_SYMBOL : TOKEN1_SYMBOL}`}
                  placeholder="0.0"
                  variant="bordered"
                  value={intentAmount}
                  onValueChange={setIntentAmount}
                />
                <Button
                  color="primary"
                  radius="full"
                  isDisabled={!connected || !intentAmount}
                  isLoading={busy === "place order"}
                  startContent={busy !== "place order" ? <Icon icon="solar:lock-keyhole-bold" width={18} /> : undefined}
                  onPress={onSubmitIntent}
                >
                  Place sealed order
                </Button>
              </div>
            </Tab>
            <Tab
              key="deposit"
              title={
                <div className="flex items-center gap-2">
                  <Icon icon="solar:download-minimalistic-linear" width={16} />
                  <span>Deposit</span>
                </div>
              }
            >
              <div className="flex flex-col gap-4 pt-2">
                <Tabs
                  aria-label="Deposit token"
                  selectedKey={depositToken}
                  onSelectionChange={(k) => setDepositToken(k as "t0" | "t1")}
                  radius="full"
                  fullWidth
                  classNames={{
                    tabList: "bg-content2",
                    cursor: "!bg-primary",
                    tab: "data-[selected=true]:!bg-primary rounded-full",
                    tabContent: "group-data-[selected=true]:!text-white",
                  }}
                >
                  <Tab key="t0" title={TOKEN0_SYMBOL} />
                  <Tab key="t1" title={TOKEN1_SYMBOL} />
                </Tabs>
                <Input
                  label={`Amount in ${depositToken === "t0" ? TOKEN0_SYMBOL : TOKEN1_SYMBOL}`}
                  placeholder="0.0"
                  variant="bordered"
                  value={depositAmount}
                  onValueChange={setDepositAmount}
                />
                <Button
                  color="primary"
                  radius="full"
                  isDisabled={!connected || !depositAmount}
                  isLoading={busy === "deposit"}
                  startContent={busy !== "deposit" ? <Icon icon="solar:download-minimalistic-bold" width={18} /> : undefined}
                  onPress={onDeposit}
                >
                  Deposit
                </Button>
              </div>
            </Tab>
            <Tab
              key="withdraw"
              title={
                <div className="flex items-center gap-2">
                  <Icon icon="solar:upload-minimalistic-linear" width={16} />
                  <span>Withdraw</span>
                </div>
              }
            >
              <div className="flex flex-col gap-4 pt-2">
                <Tabs
                  aria-label="Withdraw token"
                  selectedKey={withdrawToken}
                  onSelectionChange={(k) => setWithdrawToken(k as "t0" | "t1")}
                  radius="full"
                  fullWidth
                  classNames={{
                    tabList: "bg-content2",
                    cursor: "!bg-primary",
                    tab: "data-[selected=true]:!bg-primary rounded-full",
                    tabContent: "group-data-[selected=true]:!text-white",
                  }}
                >
                  <Tab key="t0" title={TOKEN0_SYMBOL} />
                  <Tab key="t1" title={TOKEN1_SYMBOL} />
                </Tabs>
                <Input
                  label={`Amount in ${withdrawToken === "t0" ? TOKEN0_SYMBOL : TOKEN1_SYMBOL}`}
                  placeholder="0.0"
                  variant="bordered"
                  value={withdrawAmount}
                  onValueChange={setWithdrawAmount}
                />
                <div className="flex gap-3">
                  <Button
                    variant="bordered"
                    radius="full"
                    size="sm"
                    className="flex-1"
                    isDisabled={!connected || !withdrawAmount}
                    isLoading={busy === "request withdrawal"}
                    onPress={onRequestWithdraw}
                  >
                    Request
                  </Button>
                  <Button
                    color="primary"
                    radius="full"
                    className="flex-1"
                    isDisabled={!pendingHandle}
                    isLoading={busy === "claim withdrawal"}
                    onPress={onFinalizeWithdraw}
                  >
                    Claim
                  </Button>
                </div>
              </div>
            </Tab>
          </Tabs>
        </CardBody>
      </Card>

      {/* Batch card */}
      <Card shadow="sm" className="mb-6 border-small border-default-200">
        <CardHeader className="flex flex-col items-start px-4 pb-0 pt-4">
          <p className="text-large">Current batch</p>
          <p className="text-small text-default-500">
            Anyone can close and settle a batch. Matched orders pair privately, the rest
            trades on Uniswap.
          </p>
        </CardHeader>
        <CardBody className="gap-3 p-4">
          <div className="flex gap-3">
            <Button
              variant="bordered"
              radius="full"
              size="sm"
              className="flex-1"
              isDisabled={!connected || (epochInfo ? epochInfo.participants === 0n : true)}
              isLoading={busy === "close batch"}
              startContent={busy !== "close batch" ? <Icon icon="solar:box-linear" width={16} /> : undefined}
              onPress={onCloseEpoch}
            >
              Close batch
            </Button>
            <Button
              color="primary"
              radius="full"
              className="flex-1"
              isDisabled={!connected || lastClosedId === null}
              isLoading={busy === "settle batch"}
              startContent={busy !== "settle batch" ? <Icon icon="solar:check-circle-bold" width={18} /> : undefined}
              onPress={onSettle}
            >
              Settle batch #{lastClosedId?.toString() ?? "0"}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Activity */}
      <Card shadow="sm" className="border-small border-default-200">
        <CardHeader className="px-4 pb-0 pt-4">
          <p className="text-large">Activity</p>
        </CardHeader>
        <CardBody className="gap-1 p-4">
          {log.length === 0 && (
            <p className="text-small text-default-400">
              Nothing yet. Connect a wallet and make your first move.
            </p>
          )}
          {log.map((l, i) => (
            <div key={i} className="flex items-baseline gap-3 py-1">
              <span className="shrink-0 font-mono text-tiny text-default-400">{l.at}</span>
              {l.href ? (
                <a
                  className="text-small text-primary underline-offset-2 hover:underline"
                  href={l.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {l.msg}
                </a>
              ) : (
                <span className="text-small text-default-600">{l.msg}</span>
              )}
            </div>
          ))}
          {log.length > 0 && <Divider className="mt-2" />}
        </CardBody>
      </Card>
    </main>
  );
}
