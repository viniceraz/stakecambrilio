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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800;900&family=Share+Tech+Mono&display=swap" rel="stylesheet" />
        <style>{`
          *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
          html { scroll-behavior: smooth; }
          body {
            background-color: #080a12;
            background-image: url('/backgroundsss.jpg');
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
            background-repeat: no-repeat;
            color: #f0f0f5;
            font-family: 'Share Tech Mono', monospace;
          }
          ::selection { background: #c8ff0033; color: #c8ff00; }
          ::-webkit-scrollbar { width: 5px; }
          ::-webkit-scrollbar-track { background: #080a12; }
          ::-webkit-scrollbar-thumb { background: #c8ff0030; border-radius: 3px; }
          @keyframes fadeSlideUp {
            from { opacity: 0; transform: translateY(20px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes blink {
            0%, 100% { opacity: 1; }
            50%       { opacity: 0.3; }
          }
          @keyframes pulse {
            0%, 100% { opacity: 0.5; }
            50%       { opacity: 1; }
          }
          @keyframes topAlertMarquee {
            0%   { transform: translateX(0); }
            100% { transform: translateX(-100%); }
          }
          @keyframes coinSpinLoop {
            from { transform: rotateY(0deg); }
            to   { transform: rotateY(360deg); }
          }
          @keyframes coinLandHeads {
            0%   { transform: rotateY(0deg); }
            100% { transform: rotateY(1440deg); }
          }
          @keyframes coinLandTails {
            0%   { transform: rotateY(0deg); }
            100% { transform: rotateY(1260deg); }
          }
          @keyframes resultPop {
            0%   { transform: scale(0.6); opacity: 0; }
            60%  { transform: scale(1.1); opacity: 1; }
            100% { transform: scale(1); }
          }
          @keyframes overlayFadeIn {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
        `}</style>
      </head>
      <body>
        <WagmiProvider config={config}>
          <QueryClientProvider client={queryClient}>
            <RainbowKitProvider
              theme={darkTheme({
                accentColor: "#c8ff00",
                accentColorForeground: "#080a12",
                borderRadius: "small",
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
