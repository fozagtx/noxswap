"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, Divider } from "@heroui/react";
import { Icon } from "@iconify/react";
import { connectWallet } from "@/lib/nox";
import { NoxSwapMark } from "@/components/logo";
import { ParticleField } from "@/components/particles";

const FEATURES = [
  {
    icon: "solar:lock-keyhole-bold",
    tone: "border-primary-100 bg-primary-50 text-primary",
    title: "Sealed orders",
    text: "Nobody sees your size or direction. Not bots, not us.",
  },
  {
    icon: "solar:transfer-horizontal-bold",
    tone: "border-secondary-100 bg-secondary-50 text-secondary",
    title: "Private matching",
    text: "Opposite orders pair off at the market price with zero slippage.",
  },
  {
    icon: "solar:eye-closed-bold",
    tone: "border-default-100 bg-default-50 text-default-500",
    title: "Tiny public footprint",
    text: "Only the unmatched remainder is traded publicly on Uniswap.",
  },
  {
    icon: "solar:shield-check-bold",
    tone: "border-success-100 bg-success-50 text-success-600",
    title: "Balances stay yours",
    text: "Your balance decodes on your screen only. Everyone else sees scrambled data.",
  },
  {
    icon: "solar:bolt-circle-bold",
    tone: "border-warning-100 bg-warning-50 text-warning-600",
    title: "No sandwich tax",
    text: "There is nothing in the open for front runners to chase.",
  },
  {
    icon: "solar:users-group-rounded-bold",
    tone: "border-primary-100 bg-primary-50 text-primary",
    title: "Anyone can settle",
    text: "Settlement is open to everyone and checked on chain. No operator to trust.",
  },
];

const STEPS = [
  {
    n: "1",
    title: "Deposit",
    text: "Move WETH or USDC into the vault. From that moment your balance is scrambled to the outside world.",
  },
  {
    n: "2",
    title: "Place a sealed order",
    text: "Pick a direction and an amount. Your order is sealed in your browser before it goes anywhere.",
  },
  {
    n: "3",
    title: "Orders pair off privately",
    text: "Opposite orders in the same batch match each other at the market price. No slippage, nothing leaked.",
  },
  {
    n: "4",
    title: "Only the leftover goes public",
    text: "The unmatched remainder trades on Uniswap and everyone is paid out at one fair price, privately.",
  },
];

export default function Landing() {
  const router = useRouter();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ethereum = (window as any).ethereum;
    if (!ethereum) {
      setConnected(false);
      return;
    }
    ethereum
      .request({ method: "eth_accounts" })
      .then((accounts: string[]) => setConnected(accounts.length > 0))
      .catch(() => setConnected(false));
  }, []);

  const enter = async () => {
    if (connected) {
      router.push("/trade");
      return;
    }
    setBusy(true);
    try {
      await connectWallet();
      router.push("/trade");
    } catch {
      setBusy(false);
    }
  };

  const cta = (size: "md" | "lg") => (
    <Button
      color="primary"
      radius="full"
      size={size}
      isLoading={busy || connected === null}
      startContent={
        !busy && connected !== null ? (
          <Icon
            icon={connected ? "solar:arrow-right-up-bold" : "solar:wallet-money-bold"}
            width={size === "lg" ? 20 : 18}
          />
        ) : undefined
      }
      onPress={enter}
    >
      {connected ? "Open dashboard" : "Connect wallet"}
    </Button>
  );

  return (
    <div className="relative">
      <div className="absolute inset-0 overflow-hidden">
        <ParticleField />
      </div>

      <main className="relative mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        {/* Top bar */}
        <div className="mb-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-large bg-content1 shadow-small">
              <NoxSwapMark size={26} />
            </div>
            <p className="text-large font-semibold">NoxSwap</p>
          </div>
          {cta("md")}
        </div>

        {/* Hero */}
        <div className="mb-20 text-center">
          <div className="mb-6 flex justify-center">
            <NoxSwapMark size={56} />
          </div>
          <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">
            Trade without showing your hand
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-large text-default-500">
            A dark pool on top of Uniswap. Your order size and direction stay
            sealed, orders pair off privately, and only the leftover ever trades
            in public.
          </p>
          <div className="mt-8 flex justify-center">{cta("lg")}</div>
        </div>

        {/* Features */}
        <section className="mb-20">
          <h2 className="mb-2 text-center text-2xl font-semibold">Features</h2>
          <p className="mb-8 text-center text-default-500">
            Everything a public exchange leaks, kept to yourself.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <Card key={f.title} shadow="sm" className="border-small border-default-200">
                <CardBody className="flex flex-row items-start gap-3 p-4">
                  <div className={`flex rounded-medium border p-2 ${f.tone}`}>
                    <Icon icon={f.icon} width={24} />
                  </div>
                  <div>
                    <p className="text-medium">{f.title}</p>
                    <p className="text-small text-default-400">{f.text}</p>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="mb-20">
          <h2 className="mb-2 text-center text-2xl font-semibold">How it works</h2>
          <p className="mb-8 text-center text-default-500">
            Four steps from deposit to a private fill.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {STEPS.map((s) => (
              <Card key={s.n} shadow="sm" className="border-small border-default-200">
                <CardBody className="flex flex-row items-start gap-4 p-5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-medium font-semibold text-white">
                    {s.n}
                  </div>
                  <div>
                    <p className="text-medium font-medium">{s.title}</p>
                    <p className="mt-1 text-small text-default-500">{s.text}</p>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
          <div className="mt-10 flex justify-center">{cta("lg")}</div>
        </section>

        {/* Footer */}
        <footer className="pb-6">
          <Divider className="mb-8" />
          <div className="flex flex-col items-center justify-between gap-6 sm:flex-row sm:items-start">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-large bg-content1 shadow-small">
                <NoxSwapMark size={24} />
              </div>
              <div>
                <p className="text-medium font-semibold">NoxSwap</p>
                <p className="text-small text-default-500">A dark pool over Uniswap.</p>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <a
                className="flex items-center gap-2 text-small text-default-500 transition hover:text-foreground"
                href="https://github.com/fozagtx/noxswap"
                target="_blank"
                rel="noreferrer"
              >
                <Icon icon="fe:github" width={18} />
                GitHub
              </a>
              <a
                className="flex items-center gap-2 text-small text-default-500 transition hover:text-foreground"
                href="https://docs.noxprotocol.io"
                target="_blank"
                rel="noreferrer"
              >
                <Icon icon="solar:document-text-linear" width={18} />
                Nox docs
              </a>
              <button
                className="flex items-center gap-2 text-small text-default-500 transition hover:text-foreground"
                onClick={enter}
              >
                <Icon icon="solar:arrow-right-up-linear" width={18} />
                Dashboard
              </button>
            </div>
          </div>
          <p className="mt-8 text-center text-tiny text-default-400">
            NoxSwap · built on iExec Nox · runs on Ethereum Sepolia
          </p>
        </footer>
      </main>
    </div>
  );
}
