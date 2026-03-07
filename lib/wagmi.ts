"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { base } from "wagmi/chains";

export const config = getDefaultConfig({
  appName: "Cambrilio Soft Stake",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_ID || "demo",
  chains: [base],
  ssr: true,
});
