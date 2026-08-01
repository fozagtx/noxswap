import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NoxSwap — dark pool over Uniswap",
  description:
    "Encrypted swap intents, TEE batch netting, and residual-only execution on Uniswap. Built on iExec Nox.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink text-zinc-200 antialiased">{children}</body>
    </html>
  );
}
