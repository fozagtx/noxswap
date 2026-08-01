"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
type View = "trade" | "balances" | "batches" | "activity";

const short = (v: string) => `${v.slice(0, 6)}…${v.slice(-4)}`;

const NAV: { key: View; label: string; icon: string }[] = [
  { key: "trade", label: "Trade", icon: "solar:lock-keyhole-linear" },
  { key: "balances", label: "Balances", icon: "solar:wallet-money-linear" },
  { key: "batches", label: "Batches", icon: "solar:box-linear" },
  { key: "activity", label: "Activity", icon: "solar:history-linear" },
];

const segmentedTabClassNames = {
  tabList: "bg-content2",
  cursor: "!bg-primary",
  tab: "data-[selected=true]:!bg-primary rounded-full",
  tabContent: "group-data-[selected=true]:!text-white",
};

export default function App() {
  const router = useRouter();
  const publicClient = useMemo(() => getPublicClient(), []);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [view, setView] = useState<View>("trade");
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


  // Guard: only connected wallets belong here. Adopt an existing MetaMask
  // authorization silently; otherwise send the visitor back to the landing.
  useEffect(() => {
    const ethereum = (window as any).ethereum;
    if (!ethereum) {
      router.replace("/");
      return;
    }
    ethereum
      .request({ method: "eth_accounts" })
      .then(async (accounts: string[]) => {
        if (accounts.length === 0) {
          router.replace("/");
          return;
        }
        const { wallet: w, account: a } = await connectWallet();
        setWallet(w);
        setAccount(a);
      })
      .catch(() => router.replace("/"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    run("show balance", async () => {
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
      say("Decoded on your screen only. On chain they stay scrambled.");
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

  const walletBlock = connected ? (
    <Chip
      color="success"
      variant="flat"
      startContent={<Icon icon="solar:wallet-money-linear" width={16} />}
    >
      <span className="font-mono">{short(account!)}</span>
    </Chip>
  ) : null;

  const tradeView = (
    <div className="flex flex-col gap-6">
      <Card shadow="sm" className="border-small border-default-200">
        <CardHeader className="flex flex-col items-start px-4 pb-0 pt-4">
          <p className="text-large">Sealed order</p>
          <p className="text-small text-default-500">
            Amount and direction are sealed before anything leaves your browser.
          </p>
        </CardHeader>
        <CardBody className="flex flex-col gap-4 p-4">
          <Tabs
            aria-label="Direction"
            selectedKey={sellToken0 ? "sell0" : "sell1"}
            onSelectionChange={(k) => setSellToken0(k === "sell0")}
            radius="full"
            fullWidth
            classNames={segmentedTabClassNames}
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
        </CardBody>
      </Card>
    </div>
  );

  const balancesView = (
    <div className="flex flex-col gap-6">
      <Card shadow="sm" className="border-small border-default-200">
        <CardHeader className="flex items-center justify-between px-4 pb-0 pt-4">
          <div>
            <p className="text-large">Your private balance</p>
            <p className="text-small text-default-500">
              Visible to you alone. Everyone else sees scrambled data.
            </p>
          </div>
          <Button
            variant="bordered"
            radius="full"
            size="sm"
            isDisabled={!connected}
            isLoading={busy === "show balance"}
            startContent={busy !== "show balance" ? <Icon icon="solar:eye-linear" width={16} /> : undefined}
            onPress={onReveal}
          >
            Show my balance
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

      <Card shadow="sm" className="border-small border-default-200">
        <CardBody className="p-4">
          <Tabs aria-label="Move funds" variant="underlined" color="primary">
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
                  classNames={segmentedTabClassNames}
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
                  classNames={segmentedTabClassNames}
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
    </div>
  );

  const batchesView = (
    <div className="flex flex-col gap-6">
      <Card shadow="sm" className="border-small border-default-200">
        <CardHeader className="flex flex-col items-start px-4 pb-0 pt-4">
          <p className="text-large">Current batch</p>
          <p className="text-small text-default-500">
            Anyone can close and settle a batch. Matched orders pair privately, the rest
            trades on Uniswap.
          </p>
        </CardHeader>
        <CardBody className="gap-3 p-4">
          <div className="flex items-center gap-2">
            <Chip size="sm" variant="flat">
              Batch #{epochId?.toString() ?? "0"}
            </Chip>
            <Chip size="sm" variant="flat">
              {epochInfo?.participants.toString() ?? "0"} sealed orders
            </Chip>
          </div>
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
    </div>
  );

  const activityView = (
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
  );

  const views: Record<View, React.ReactNode> = {
    trade: tradeView,
    balances: balancesView,
    batches: batchesView,
    activity: activityView,
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar (desktop) */}
      <aside
        className={`fixed inset-y-0 left-0 z-20 hidden flex-col border-r-small border-divider transition-all duration-200 lg:flex ${sidebarOpen ? "w-72 p-6" : "w-[4.25rem] items-center px-2 py-6"}`}
      >
        <div className={`flex items-center ${sidebarOpen ? "justify-between px-2" : "flex-col gap-3"}`}>
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-content1 shadow-small">
              <NoxSwapMark size={24} />
            </div>
            {sidebarOpen && (
              <span className="text-small font-bold uppercase tracking-wide">NoxSwap</span>
            )}
          </Link>
          <Button
            isIconOnly
            size="sm"
            variant="light"
            aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            className="text-default-500"
            onPress={() => setSidebarOpen((v) => !v)}
          >
            <Icon
              icon={sidebarOpen ? "solar:square-double-alt-arrow-left-linear" : "solar:square-double-alt-arrow-right-linear"}
              width={20}
            />
          </Button>
        </div>

        {sidebarOpen && <div className="mt-8 px-2">{walletBlock}</div>}

        <nav className={`mt-6 flex flex-col gap-1 ${sidebarOpen ? "" : "items-center"}`}>
          {NAV.map((item) =>
            sidebarOpen ? (
              <Button
                key={item.key}
                fullWidth
                variant={view === item.key ? "flat" : "light"}
                color={view === item.key ? "primary" : "default"}
                className={`justify-start ${view === item.key ? "" : "text-default-500 data-[hover=true]:text-foreground"}`}
                startContent={<Icon icon={item.icon} width={22} />}
                onPress={() => setView(item.key)}
              >
                {item.label}
              </Button>
            ) : (
              <Button
                key={item.key}
                isIconOnly
                aria-label={item.label}
                variant={view === item.key ? "flat" : "light"}
                color={view === item.key ? "primary" : "default"}
                className={view === item.key ? "" : "text-default-500 data-[hover=true]:text-foreground"}
                onPress={() => setView(item.key)}
              >
                <Icon icon={item.icon} width={22} />
              </Button>
            ),
          )}
        </nav>

        <div className={`mt-auto flex flex-col gap-3 ${sidebarOpen ? "" : "items-center"}`}>
          {sidebarOpen ? (
            <Button
              as={Link}
              href="/"
              fullWidth
              variant="light"
              className="justify-start text-default-500 data-[hover=true]:text-foreground"
              startContent={<Icon icon="solar:home-2-linear" width={22} />}
            >
              Back to home
            </Button>
          ) : (
            <Button
              as={Link}
              href="/"
              isIconOnly
              aria-label="Back to home"
              variant="light"
              className="text-default-500 data-[hover=true]:text-foreground"
            >
              <Icon icon="solar:home-2-linear" width={22} />
            </Button>
          )}
        </div>
      </aside>

      {/* Content */}
      <div className={`w-full transition-all duration-200 ${sidebarOpen ? "lg:pl-72" : "lg:pl-[4.25rem]"}`}>
        {/* Mobile top bar */}
        <header className="sticky top-0 z-10 flex flex-col gap-3 border-b-small border-divider p-4 lg:hidden">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-large bg-content1 shadow-small">
                <NoxSwapMark size={24} />
              </div>
              <span className="text-medium font-semibold">NoxSwap</span>
            </Link>
            {walletBlock}
          </div>
          <Tabs
            aria-label="Sections"
            selectedKey={view}
            onSelectionChange={(k) => setView(k as View)}
            size="sm"
            radius="full"
            fullWidth
            classNames={segmentedTabClassNames}
          >
            {NAV.map((item) => (
              <Tab key={item.key} title={item.label} />
            ))}
          </Tabs>
        </header>

        <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:py-10">
          <div className="mb-6 hidden items-center justify-between lg:flex">
            <h1 className="text-2xl font-semibold capitalize">{view}</h1>
            <div className="flex gap-2">
              <Chip size="sm" variant="flat">
                Batch #{epochId?.toString() ?? "0"}
              </Chip>
              <Chip size="sm" variant="flat">
                {epochInfo?.participants.toString() ?? "0"} sealed orders
              </Chip>
            </div>
          </div>
          {views[view]}
        </main>
      </div>
    </div>
  );
}
