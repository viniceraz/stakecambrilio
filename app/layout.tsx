"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { config } from "@/lib/wagmi";

const queryClient = new QueryClient();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <title>Cambrilio Soft Stake</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/logo.png" />
        <style>{`
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { background: #06060b; color: #f0f0f5; font-family: 'Inter', -apple-system, sans-serif; }
          ::-webkit-scrollbar { width: 6px; }
          ::-webkit-scrollbar-track { background: #0b0b14; }
          ::-webkit-scrollbar-thumb { background: #333345; border-radius: 3px; }
        `}</style>
      </head>
      <body>
        <WagmiProvider config={config}>
          <QueryClientProvider client={queryClient}>
            <RainbowKitProvider
              theme={darkTheme({
                accentColor: "#c8ff00",
                accentColorForeground: "#06060b",
                borderRadius: "medium",
              })}
              locale="en"
            >
              {children}
            </RainbowKitProvider>
          </QueryClientProvider>
        </WagmiProvider>
      </body>
    </html>
  );
}
