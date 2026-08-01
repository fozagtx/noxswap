"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody } from "@heroui/react";
import { Icon } from "@iconify/react";
import { connectWallet } from "@/lib/nox";
import { NoxSwapMark } from "@/components/logo";

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
          <Icon icon={connected ? "solar:arrow-right-up-bold" : "solar:wallet-money-bold"} width={size === "lg" ? 20 : 18} />
        ) : undefined
      }
      onPress={enter}
    >
      {connected ? "Open dashboard" : "Connect wallet"}
    </Button>
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
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
      <div className="mb-12 text-center">
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

      {/* Three value cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card shadow="sm" className="border-small border-default-200">
          <CardBody className="flex flex-row items-start gap-3 p-4">
            <div className="flex rounded-medium border border-primary-100 bg-primary-50 p-2">
              <Icon className="text-primary" icon="solar:lock-keyhole-bold" width={24} />
            </div>
            <div>
              <p className="text-medium">Sealed orders</p>
              <p className="text-small text-default-400">
                Nobody sees your size or direction. Not bots, not us.
              </p>
            </div>
          </CardBody>
        </Card>
        <Card shadow="sm" className="border-small border-default-200">
          <CardBody className="flex flex-row items-start gap-3 p-4">
            <div className="flex rounded-medium border border-secondary-100 bg-secondary-50 p-2">
              <Icon className="text-secondary" icon="solar:transfer-horizontal-bold" width={24} />
            </div>
            <div>
              <p className="text-medium">Private matching</p>
              <p className="text-small text-default-400">
                Opposite orders pair off at the market price with zero slippage.
              </p>
            </div>
          </CardBody>
        </Card>
        <Card shadow="sm" className="border-small border-default-200">
          <CardBody className="flex flex-row items-start gap-3 p-4">
            <div className="flex rounded-medium border border-default-100 bg-default-50 p-2">
              <Icon className="text-default-500" icon="solar:eye-closed-bold" width={24} />
            </div>
            <div>
              <p className="text-medium">Tiny public footprint</p>
              <p className="text-small text-default-400">
                Only the unmatched remainder is traded publicly on Uniswap.
              </p>
            </div>
          </CardBody>
        </Card>
      </div>
    </main>
  );
}
