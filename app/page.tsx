"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSignMessage, useWriteContract } from "wagmi";
import { getOwnedCambrilios, checkListedClient, OwnedNFT } from "@/lib/blockchain";
import { supabase } from "@/lib/supabase";
import { readContractSafe, publicClient } from "@/lib/viemClient";
import {
  BET_CONTRACT_ADDRESS, NFT_CONTRACT_ADDRESS,
  BET_ABI, ERC721_ABI,
  STATUS_MAP, choiceToSide, sideToChoice, ZERO_ADDRESS, PROTOCOL_FEE,
} from "@/lib/betContract";
import {
  ROULETTE_CONTRACT_ADDRESS,
  ROULETTE_ABI,
  ROULETTE_STATUS_MAP,
  RED as ROULETTE_RED, BLACK as ROULETTE_BLACK,
  colorLabelFromResult,
  PROTOCOL_FEE as ROULETTE_PROTOCOL_FEE,
} from "@/lib/rouletteContract";
import { RouletteWheel, RouletteResultBadge } from "@/components/RouletteWheel";
import type { SpinResult } from "@/components/RouletteWheel";

// ═══ THEME ═══
const T = {
  bg: "#080a12", bgS: "#0d0d1a", card: "#111120", cardH: "#151528",
  border: "#1e1e35", accent: "#c8ff00", burn: "#ff4444",
  sweep: "#00e5ff", gold: "#ffd700", weth: "#627eea",
  listed: "#ff6b6b", white: "#f0f0f5", gray: "#8888a0",
  grayD: "#55556a", grayK: "#333350", success: "#00ff88",
  cum: "#f0c040",
};

// ═══ INTERFACES ═══
interface LeaderEntry { wallet: string; staked: number; balance: number; earned: number; }
interface StoreListing {
  id: number;
  title: string;
  description: string;
  image_url: string;
  project_url: string;
  price_cum: number;
  total_spots: number;
  remaining_spots: number;
  is_active: boolean;
  created_at: string;
  starts_at: string | null;
  expires_at: string | null;
  max_per_wallet?: number;
  // Optional WL project metadata (for multi-chain WL support)
  is_wl_project?: boolean;
  wl_mint_price?: number | string | null;
  wl_chain?: "BTC" | "SOL" | "ETH" | null;
  wl_supply?: number | null;
  wl_description?: string | null;
}
interface Purchase { id: number; listing_id: number; buyer_wallet: string; wl_wallet: string; cum_spent: number; purchased_at: string; store_listings?: { title: string }; }
interface BurnReward { id: number; title: string; description: string; image_url: string; burn_cost: number; total_supply: number; remaining_supply: number; is_active: boolean; created_at: string; expires_at: string | null; starts_at: string | null; }
interface BurnClaim { id: number; reward_id: number; wallet_address: string; token_ids: string[]; tx_hashes: string[]; status: string; admin_notes: string; submitted_at: string; burn_rewards?: { title: string; image_url: string }; }
interface BetLeaderEntry {
  wallet: string;
  totalBets: number;
  wins: number;
  losses: number;
  winRate: number;
  nftsWon: number;
  nftsLost: number;
  netNfts: number;
  ethWon: number;
  ethLost: number;
  netEth: number;
}

interface BetRoom {
  id: bigint;
  creator_wallet: string;
  challenger_wallet: string | null;
  nft_count: number;
  status: "waiting" | "active" | "flipping" | "complete" | "cancelled" | "expired";
  creator_choice: "heads" | "tails";
  creator_nft_ids: string[];
  challenger_nft_ids: string[];
  coin_result: "heads" | "tails" | null;
  winner_wallet: string | null;
  created_at: string;
  eth_amount: bigint; // 0n = NFT-only room
  name: string;
}

interface RouletteRoom {
  id: bigint;
  red_player: string;
  black_player: string | null;
  nft_count: number;
  status: "waiting" | "active" | "spinning" | "complete" | "cancelled" | "expired";
  red_nft_ids: string[];
  black_nft_ids: string[];
  spin_slot: number | null;
  spin_result: "red" | "black" | "green" | null;
  winner_wallet: string | null;
  created_at: string;
  eth_amount: bigint;
  name: string;
}

// ═══ HELPERS ═══
const PS: React.CSSProperties = { background: T.bgS, border: `1px solid ${T.border}`, borderRadius: 6, padding: 20, marginBottom: 16 };
const inputStyle: React.CSSProperties = { width: "100%", background: T.card, border: `1px solid ${T.border}`, borderRadius: 4, padding: "10px 12px", color: T.white, fontSize: 12, fontFamily: "'Share Tech Mono', monospace", outline: "none", boxSizing: "border-box" };
const shortAddr = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

// Normalize timestamps coming from Supabase so that values
// saved via <input type=\"datetime-local\" /> behave as local time
// independent of the server/database timezone.
const parseLocalTimestamp = (value: string) => {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d;
};

// ═══ COUNTDOWN COMPONENT ═══
function Countdown({ expiresAt, label }: { expiresAt: string; label?: string }) {
  const [left, setLeft] = useState("");
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const update = () => {
      const dt = parseLocalTimestamp(expiresAt);
      if (!dt) { setExpired(true); setLeft("EXPIRED"); return; }
      const diff = dt.getTime() - Date.now();
      if (diff <= 0) { setExpired(true); setLeft("EXPIRED"); return; }
      const days = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setLeft(`${days > 0 ? days + "d " : ""}${h.toString().padStart(2, "0")}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: expired ? `${T.burn}15` : `${T.accent}10`, border: `1px solid ${expired ? T.burn : T.accent}30`, borderRadius: 8 }}>
      <span style={{ fontSize: 14 }}>{expired ? "⏰" : "⏳"}</span>
      {label && <span style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, letterSpacing: 1 }}>{label}</span>}
      <span style={{ fontSize: 11, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", color: expired ? T.burn : T.accent, letterSpacing: 1 }}>{left}</span>
    </div>
  );
}

// Starts-at countdown: shows countdown + "LOCKED" until start time, then returns null
function StartsInCountdown({ startsAt, subtitle }: { startsAt: string; subtitle?: string }) {
  const [left, setLeft] = useState("");
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const update = () => {
      const dt = parseLocalTimestamp(startsAt);
      if (!dt) { setStarted(true); return; }
      const diff = dt.getTime() - Date.now();
      if (diff <= 0) { setStarted(true); return; }
      const days = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setLeft(`${days > 0 ? days + "d " : ""}${h.toString().padStart(2, "0")}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startsAt]);
  if (started) return null;
  return (
    <div style={{ padding: "14px 16px", background: `${T.gold}08`, border: `1px solid ${T.gold}30`, borderRadius: 10, textAlign: "center" }}>
      <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.gold, letterSpacing: 2, fontWeight: 700, marginBottom: 6 }}>🔒 OPENS IN</div>
      <div style={{ fontSize: 24, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.gold, letterSpacing: 2, textShadow: `0 0 20px ${T.gold}33` }}>{left}</div>
      <div style={{ fontSize: 8, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginTop: 6, letterSpacing: 1 }}>{subtitle || "AVAILABLE WHEN COUNTDOWN ENDS"}</div>
    </div>
  );
}

// ═══ MAIN PAGE ═══
export default function StakePage() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  // Cast to any once to work around wagmi/viem 2.18 type regression
  // where chain+account are incorrectly required in WriteContractParameters.
  const { writeContractAsync: _writeContractAsync } = useWriteContract();
  const writeContractAsync = _writeContractAsync as unknown as (p: {
    address: `0x${string}`; abi: readonly object[];
    functionName: string; args?: unknown[];
  }) => Promise<`0x${string}`>;

  // Tab
  const [tab, setTab] = useState<"stake" | "store" | "burn" | "dashboard" | "admin" | "bet" | "roulette">("stake");

  // Stake
  const [ownedNfts, setOwnedNfts] = useState<OwnedNFT[]>([]);
  const [listedIds, setListedIds] = useState<Set<string>>(new Set());
  const [stakedIds, setStakedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [staking, setStaking] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState<"ok" | "err">("ok");
  const [stakeEnabled, setStakeEnabled] = useState(false);
  const [transferEnabled, setTransferEnabled] = useState(true);
  const [betEnabled, setBetEnabled] = useState(true);

  // $CUM
  const [cumBalance, setCumBalance] = useState(0);
  const [cumPending, setCumPending] = useState(0);
  const [cumEarned, setCumEarned] = useState(0);
  const [cumSpent, setCumSpent] = useState(0);
  const [cumRate, setCumRate] = useState(0);
  const [claiming, setClaiming] = useState(false);
  const [nftBoostMap, setNftBoostMap] = useState<Record<string, number>>({});
  const [refreshingMeta, setRefreshingMeta] = useState(false);
  const [myPurchases, setMyPurchases] = useState<Purchase[]>([]);
  const [transferWallet, setTransferWallet] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferring, setTransferring] = useState(false);

  // Store
  const [listings, setListings] = useState<StoreListing[]>([]);
  const [buyingId, setBuyingId] = useState<number | null>(null);
  const [wlWalletInput, setWlWalletInput] = useState("");

  // Burn
  const [burnRewards, setBurnRewards] = useState<BurnReward[]>([]);
  const [burnClaims, setBurnClaims] = useState<BurnClaim[]>([]);
  const [allBurnClaims, setAllBurnClaims] = useState<BurnClaim[]>([]);
  const [burnTxInputs, setBurnTxInputs] = useState<Record<number, string[]>>({});
  const [activeBurnId, setActiveBurnId] = useState<number | null>(null);
  const [submittingBurn, setSubmittingBurn] = useState(false);

  // Dashboard
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>([]);
  const [globalStats, setGlobalStats] = useState({ totalStakers: 0, totalNFTsStaked: 0, totalTickets: 0 });
  const [dashSubTab, setDashSubTab] = useState<"stake" | "bet">("stake");
  const [betLeaderboard, setBetLeaderboard] = useState<BetLeaderEntry[]>([]);
  const [loadingBetLeader, setLoadingBetLeader] = useState(false);

  // Admin
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminData, setAdminData] = useState<any>(null);
  const [newListing, setNewListing] = useState({
    title: "",
    description: "",
    imageUrl: "",
    projectUrl: "",
    priceCum: "5",
    totalSpots: "20",
    startsAt: "",
    expiresAt: "",
    maxPerWallet: "1",
    // WL project metadata
    isWlProject: true,
    wlMintPrice: "",
    wlChain: "ETH" as "BTC" | "SOL" | "ETH",
    wlSupply: "",
    wlDescription: "",
  });
  const [newBurnReward, setNewBurnReward] = useState({ title: "", description: "", imageUrl: "", burnCost: "10", totalSupply: "1", expiresAt: "", startsAt: "" });

  // Bet
  const [betRooms, setBetRooms] = useState<BetRoom[]>([]);
  const [myCompletedBets, setMyCompletedBets] = useState<BetRoom[]>([]);
  const [betNftCount, setBetNftCount] = useState<1 | 2 | 3 | "custom">(1);
  const [betCustomCount, setBetCustomCount] = useState("");
  const [betChoice, setBetChoice] = useState<"heads" | "tails">("heads");
  const [betEthAmount, setBetEthAmount] = useState("");
  const [betRoomName, setBetRoomName] = useState("");
  const [betSelectedIds, setBetSelectedIds] = useState<Set<string>>(new Set());
  const [betJoinRoomId, setBetJoinRoomId] = useState<bigint | null>(null);
  const [betJoinSelectedIds, setBetJoinSelectedIds] = useState<Set<string>>(new Set());
  const [creatingBet, setCreatingBet] = useState(false);
  const [joiningBet, setJoiningBet] = useState(false);
  const [flippingBet, setFlippingBet] = useState(false);
  const [flipResult, setFlipResult] = useState<{ roomId: bigint; result: "heads" | "tails"; winner: string; creatorChoice: "heads" | "tails" } | null>(null);
  const [coinPhase, setCoinPhase] = useState<"idle" | "spinning" | "landed">("idle");
  const [betApproved, setBetApproved] = useState(false);
  const prevRoomStatusRef = useRef<Map<string, string>>(new Map());

  // Roulette
  const [rouletteRooms, setRouletteRooms] = useState<RouletteRoom[]>([]);
  const [myCompletedRoulettes, setMyCompletedRoulettes] = useState<RouletteRoom[]>([]);
  const [rouletteNftCount, setRouletteNftCount] = useState<1 | 2 | 3 | "custom">(1);
  const [rouletteCustomCount, setRouletteCustomCount] = useState("");
  const [rouletteColor, setRouletteColor] = useState<"red" | "black">("red");
  const [rouletteEthAmount, setRouletteEthAmount] = useState("");
  const [rouletteRoomName, setRouletteRoomName] = useState("");
  const [rouletteSelectedIds, setRouletteSelectedIds] = useState<Set<string>>(new Set());
  const [rouletteJoinRoomId, setRouletteJoinRoomId] = useState<bigint | null>(null);
  const [rouletteJoinSelectedIds, setRouletteJoinSelectedIds] = useState<Set<string>>(new Set());
  const [creatingRoulette, setCreatingRoulette] = useState(false);
  const [joiningRoulette, setJoiningRoulette] = useState(false);
  const [spinningRoulette, setSpinningRoulette] = useState(false);
  const [rouletteApproved, setRouletteApproved] = useState(false);
  const [wheelSpinning, setWheelSpinning] = useState(false);
  const [wheelTargetSlot, setWheelTargetSlot] = useState<number | undefined>(undefined);
  const [wheelDone, setWheelDone] = useState(false);
  const [wheelResult, setWheelResult] = useState<{ roomId: bigint; slot: number; winner: string; result: "red" | "black" | "green" } | null>(null);
  const prevRouletteStatusRef = useRef<Map<string, string>>(new Map());

  // Mobile menu
  const [mobileMenu, setMobileMenu] = useState(false);

  // ═══ SHOW MESSAGE ═══
  const showMsg = (text: string, type: "ok" | "err" = "ok") => { setMsg(text); setMsgType(type); setTimeout(() => setMsg(""), 6000); };

  // ═══ SHARE BET PNL CARD ═══
  const sharePNLCard = () => {
    if (!address || myCompletedBets.length === 0) return;
    const addrLower = address.toLowerCase();

    // Compute stats from completed bets
    const wins = myCompletedBets.filter(b => b.winner_wallet === addrLower);
    const losses = myCompletedBets.filter(b => b.winner_wallet !== addrLower);
    const totalBets = myCompletedBets.length;
    const winRate = totalBets > 0 ? Math.round((wins.length / totalBets) * 100) : 0;
    const nftsWon = wins.reduce((acc, b) => acc + b.nft_count, 0);
    const nftsLost = losses.reduce((acc, b) => acc + b.nft_count, 0);
    const netNfts = nftsWon - nftsLost;

    // ETH PNL (convert from wei bigint to ETH string)
    const ethWon = wins.reduce((acc, b) => acc + b.eth_amount, BigInt(0));
    const ethLost = losses.reduce((acc, b) => acc + b.eth_amount, BigInt(0));
    const netEthWei = ethWon - ethLost;
    const netEth = Number(netEthWei) / 1e18;
    const hasEth = ethWon > BigInt(0) || ethLost > BigInt(0);

    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 440;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Background
    ctx.fillStyle = "#06060b";
    ctx.fillRect(0, 0, 800, 440);

    // Border
    ctx.strokeStyle = "#1a1a2c";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, 799, 439);

    // Top accent bar gradient
    const grad = ctx.createLinearGradient(0, 0, 800, 0);
    grad.addColorStop(0, netNfts >= 0 ? "#00ff88" : "#ff4444");
    grad.addColorStop(0.5, netNfts >= 0 ? "#c8ff00" : "#ff6b6b");
    grad.addColorStop(1, netNfts >= 0 ? "#00ff88" : "#ff4444");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 800, 4);

    // Logo + title
    ctx.font = "900 15px monospace";
    ctx.fillStyle = "#c8ff00";
    ctx.letterSpacing = "4px";
    ctx.fillText("CAMBRILIO", 40, 50);
    ctx.font = "700 10px monospace";
    ctx.fillStyle = "#55556a";
    ctx.letterSpacing = "2px";
    ctx.fillText("COINFLIP  •  PNL CARD", 40, 70);

    // Divider
    ctx.strokeStyle = "#1a1a2c";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, 88);
    ctx.lineTo(760, 88);
    ctx.stroke();

    // Wallet
    const shortWallet = `${address.slice(0, 8)}...${address.slice(-6)}`;
    ctx.font = "700 10px monospace";
    ctx.fillStyle = "#8888a0";
    ctx.letterSpacing = "1px";
    ctx.fillText("WALLET", 40, 113);
    ctx.font = "700 13px monospace";
    ctx.fillStyle = "#f0f0f5";
    ctx.fillText(shortWallet, 40, 131);

    // Net NFT PNL — big number
    const pnlLabel = netNfts >= 0 ? `+${netNfts} NFTs` : `${netNfts} NFTs`;
    ctx.font = "700 11px monospace";
    ctx.fillStyle = "#8888a0";
    ctx.letterSpacing = "1px";
    ctx.fillText("NET PNL", 40, 182);
    ctx.font = `900 56px monospace`;
    ctx.fillStyle = netNfts >= 0 ? "#00ff88" : "#ff4444";
    ctx.letterSpacing = "-1px";
    ctx.fillText(pnlLabel, 40, 248);

    // ETH PNL line
    if (hasEth) {
      const ethLabel = netEth >= 0 ? `+${netEth.toFixed(4)} ETH` : `${netEth.toFixed(4)} ETH`;
      ctx.font = "700 18px monospace";
      ctx.fillStyle = netEth >= 0 ? "#00ff8880" : "#ff444480";
      ctx.fillText(ethLabel, 40, 275);
    }

    // Stats row
    const statsY = hasEth ? 320 : 305;
    const statsData = [
      { label: "TOTAL BETS", value: totalBets.toString(), color: "#f0f0f5" },
      { label: "WINS", value: wins.length.toString(), color: "#00ff88" },
      { label: "LOSSES", value: losses.length.toString(), color: "#ff4444" },
      { label: "WIN RATE", value: `${winRate}%`, color: winRate >= 50 ? "#c8ff00" : "#ff6b6b" },
      { label: "NFTs WON", value: `+${nftsWon}`, color: "#00ff88" },
    ];

    const colW = 150;
    statsData.forEach((s, i) => {
      const x = 40 + i * colW;
      ctx.font = "700 9px monospace";
      ctx.fillStyle = "#55556a";
      ctx.letterSpacing = "1px";
      ctx.fillText(s.label, x, statsY);
      ctx.font = "900 16px monospace";
      ctx.fillStyle = s.color;
      ctx.fillText(s.value, x, statsY + 22);
    });

    // Divider
    ctx.strokeStyle = "#1a1a2c";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, 380);
    ctx.lineTo(760, 380);
    ctx.stroke();

    // Footer
    ctx.font = "700 10px monospace";
    ctx.fillStyle = "#333345";
    ctx.letterSpacing = "1px";
    ctx.fillText("cambrilio.xyz  •  Base Network  •  Powered by Chainlink VRF", 40, 400);
    ctx.fillText(`Data from last ${totalBets} completed bets`, 40, 420);

    // Draw character image on the right side
    const charImg = new Image();
    charImg.src = "/pnl-character.png";
    const finalize = () => {
      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "cambrilio-bet-pnl.png";
      a.click();

      // Open Twitter intent
    const ethLine = hasEth ? `\n${netEth >= 0 ? "+" : ""}${netEth.toFixed(4)} ETH` : "";
    const tweet = `My @Cambrilio Coinflip PNL:\n\n${netNfts >= 0 ? "+" : ""}${netNfts} NFTs${ethLine}\n${wins.length}W / ${losses.length}L (${winRate}% WR)\n\n🎰 ${totalBets} bets played on Cambrilio Bet\ncambrilio.xyz`;
      const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`;
      window.open(twitterUrl, "_blank", "noopener,noreferrer");
    };

    charImg.onload = () => {
      const imgH = 190;
      const imgW = Math.round(charImg.naturalWidth * (imgH / charImg.naturalHeight));
      const imgX = 800 - imgW - 10;
      const imgY = 95;
      ctx.drawImage(charImg, imgX, imgY, imgW, imgH);
      finalize();
    };
    charImg.onerror = () => finalize();
  };

  // ═══ ADMIN BET PNL CARD ═══
  const generateBetPNLCard = (e: BetLeaderEntry) => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 440;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const isProfit = e.netNfts >= 0;
    const mainColor = isProfit ? "#00ff88" : "#ff4444";
    const accentColor = isProfit ? "#c8ff00" : "#ff6b6b";

    // Background
    ctx.fillStyle = "#080a12";
    ctx.fillRect(0, 0, 800, 440);

    // Border
    ctx.strokeStyle = "#1e1e35";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, 799, 439);

    // Top gradient bar
    const grad = ctx.createLinearGradient(0, 0, 800, 0);
    grad.addColorStop(0, mainColor);
    grad.addColorStop(0.5, accentColor);
    grad.addColorStop(1, mainColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 800, 4);

    // Logo
    ctx.font = "900 15px monospace";
    ctx.fillStyle = "#c8ff00";
    ctx.letterSpacing = "4px";
    ctx.fillText("CAMBRILIO", 40, 50);
    ctx.font = "700 10px monospace";
    ctx.fillStyle = "#55556a";
    ctx.letterSpacing = "2px";
    ctx.fillText("COINFLIP  •  BET LEADERBOARD CARD", 40, 70);

    // Divider
    ctx.strokeStyle = "#1e1e35";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(40, 88); ctx.lineTo(760, 88); ctx.stroke();

    // Wallet
    const shortWallet = `${e.wallet.slice(0, 10)}...${e.wallet.slice(-8)}`;
    ctx.font = "700 10px monospace";
    ctx.fillStyle = "#8888a0";
    ctx.letterSpacing = "1px";
    ctx.fillText("WALLET", 40, 113);
    ctx.font = "700 13px monospace";
    ctx.fillStyle = "#f0f0f5";
    ctx.fillText(shortWallet, 40, 131);

    // Net NFT PNL — big
    const nftLabel = e.netNfts >= 0 ? `+${e.netNfts} NFTs` : `${e.netNfts} NFTs`;
    ctx.font = "700 11px monospace";
    ctx.fillStyle = "#8888a0";
    ctx.letterSpacing = "1px";
    ctx.fillText("NET PNL", 40, 182);
    ctx.font = "900 56px monospace";
    ctx.fillStyle = mainColor;
    ctx.letterSpacing = "-1px";
    ctx.fillText(nftLabel, 40, 248);

    // ETH PNL
    if (e.ethWon > 0 || e.ethLost > 0) {
      const ethLabel = e.netEth >= 0 ? `+${e.netEth.toFixed(4)} ETH` : `${e.netEth.toFixed(4)} ETH`;
      ctx.font = "700 18px monospace";
      ctx.fillStyle = e.netEth >= 0 ? "#00ff8880" : "#ff444480";
      ctx.fillText(ethLabel, 40, 275);
    }

    // Stats row
    const statsY = (e.ethWon > 0 || e.ethLost > 0) ? 320 : 305;
    const statsData = [
      { label: "TOTAL BETS", value: e.totalBets.toString(), color: "#f0f0f5" },
      { label: "WINS", value: e.wins.toString(), color: "#00ff88" },
      { label: "LOSSES", value: e.losses.toString(), color: "#ff4444" },
      { label: "WIN RATE", value: `${e.winRate}%`, color: e.winRate >= 50 ? "#c8ff00" : "#ff6b6b" },
      { label: "NFTs WON", value: `+${e.nftsWon}`, color: "#00ff88" },
    ];
    const colW = 150;
    statsData.forEach((s, idx) => {
      const x = 40 + idx * colW;
      ctx.font = "700 9px monospace";
      ctx.fillStyle = "#55556a";
      ctx.letterSpacing = "1px";
      ctx.fillText(s.label, x, statsY);
      ctx.font = "900 16px monospace";
      ctx.fillStyle = s.color;
      ctx.fillText(s.value, x, statsY + 22);
    });

    // Bottom divider + footer
    ctx.strokeStyle = "#1e1e35";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(40, 380); ctx.lineTo(760, 380); ctx.stroke();
    ctx.font = "700 10px monospace";
    ctx.fillStyle = "#333350";
    ctx.letterSpacing = "1px";
    ctx.fillText("cambrilio.xyz  •  Base Network  •  Powered by Chainlink VRF", 40, 400);
    ctx.fillText(`Admin card — generated from bet leaderboard`, 40, 420);

    // Character image
    const charImg = new Image();
    charImg.src = "/pnl-character.png";
    const finalize = () => {
      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `cambrilio-pnl-${e.wallet.slice(0, 8)}.png`;
      a.click();
      const ethLine = (e.ethWon > 0 || e.ethLost > 0) ? `\n${e.netEth >= 0 ? "+" : ""}${e.netEth.toFixed(4)} ETH` : "";
      const tweet = `@Cambrilio Coinflip PNL Highlight:\n\n${e.netNfts >= 0 ? "+" : ""}${e.netNfts} NFTs${ethLine}\n${e.wins}W / ${e.losses}L (${e.winRate}% WR)\n\n🎰 ${e.totalBets} bets on Cambrilio Bet\ncambrilio.xyz`;
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`, "_blank", "noopener,noreferrer");
    };
    charImg.onload = () => {
      const imgH = 190;
      const imgW = Math.round(charImg.naturalWidth * (imgH / charImg.naturalHeight));
      ctx.drawImage(charImg, 800 - imgW - 10, 95, imgW, imgH);
      finalize();
    };
    charImg.onerror = () => finalize();
  };

  // ═══ DATA LOADERS ═══
  const loadUserData = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const [nfts, { data: stakes, error: stakesErr }] = await Promise.all([
        getOwnedCambrilios(address),
        supabase.from("stakes").select("token_id").eq("wallet_address", address.toLowerCase()).eq("is_active", true),
      ]);
      setOwnedNfts(nfts);
      // Only update stakedIds if query succeeded — prevents false "unstaked" display on network errors
      if (!stakesErr && stakes) setStakedIds(new Set(stakes.map((s: any) => s.token_id)));
      if (nfts.length > 0) { const listed = await checkListedClient(nfts.map(n => n.tokenId)); setListedIds(listed); }
      const balRes = await fetch(`/api/balance?wallet=${address}`);
      const bal = await balRes.json();
      setCumBalance(bal.balance || 0); setCumPending(bal.pendingCum || 0); setCumEarned(bal.totalEarned || 0); setCumSpent(bal.totalSpent || 0); setCumRate(bal.ratePerDay || 0); setMyPurchases(bal.purchases || []);
      // Build boost map from balance API
      const bMap: Record<string, number> = {};
      if (bal.nftBoosts) for (const b of bal.nftBoosts) bMap[b.tokenId] = b.boost;
      setNftBoostMap(bMap);
      const { data: adm } = await supabase.from("admins").select("wallet_address").eq("wallet_address", address.toLowerCase()).single();
      setIsAdmin(!!adm);
      // Check stake enabled setting
      const { data: setting } = await supabase.from("settings").select("value").eq("key", "stake_enabled").single();
      setStakeEnabled(setting?.value === "true");
      const { data: tSetting } = await supabase.from("settings").select("value").eq("key", "transfer_enabled").single();
      setTransferEnabled(tSetting?.value !== "false");
      const { data: bSetting } = await supabase.from("settings").select("value").eq("key", "bet_enabled").single();
      setBetEnabled(bSetting?.value !== "false"); // default true if not set
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [address]);

  const loadLeaderboard = useCallback(async () => { try { const res = await fetch("/api/leaderboard"); const data = await res.json(); setLeaderboard(data.leaderboard || []); setGlobalStats(data.stats || { totalStakers: 0, totalNFTsStaked: 0, totalTickets: 0 }); } catch {} }, []);
  const loadBetLeaderboard = useCallback(async () => { setLoadingBetLeader(true); try { const res = await fetch("/api/bet-leaderboard"); const data = await res.json(); setBetLeaderboard(data.leaderboard || []); } catch {} finally { setLoadingBetLeader(false); } }, []);
  const loadStore = useCallback(async () => { try { const res = await fetch("/api/store"); const data = await res.json(); setListings(data.listings || []); } catch {} }, []);
  const loadBurnData = useCallback(async () => { try { const p = new URLSearchParams(); if (address) p.set("wallet", address); if (isAdmin) p.set("admin", "true"); const res = await fetch(`/api/burn?${p}`); const data = await res.json(); setBurnRewards(data.rewards || []); setBurnClaims(data.claims || []); setAllBurnClaims(data.allClaims || []); } catch {} }, [address, isAdmin]);
  const loadAdminData = useCallback(async () => { if (!address || !isAdmin) return; try { const res = await fetch(`/api/admin?wallet=${address}`); const data = await res.json(); setAdminData(data); } catch {} }, [address, isAdmin]);
  const loadBetRooms = useCallback(async () => {
    try {
      const [raw, rawExtra] = await Promise.all([
        readContractSafe<[bigint[], `0x${string}`[], `0x${string}`[], number[], number[], `0x${string}`[], number[], number[], bigint[]]>({
          address: BET_CONTRACT_ADDRESS,
          abi: BET_ABI,
          functionName: "getRecentRooms",
          args: [BigInt(50)],
        }),
        readContractSafe<[bigint[], bigint[], string[]]>({
          address: BET_CONTRACT_ADDRESS,
          abi: BET_ABI,
          functionName: "getRecentRoomsExtra",
          args: [BigInt(50)],
        }),
      ]);

      const [ids, creators, challengers, nftCounts, statuses, winners, coinResults, creatorChoices, createdAts] = raw;
      const [, ethAmounts, names] = rawExtra;

      const rooms: BetRoom[] = await Promise.all(
        ids.map(async (id, i) => {
          const status = STATUS_MAP[statuses[i]] ?? "cancelled";
          let creatorTokenIds: string[] = [];
          let challengerTokenIds: string[] = [];

          if (status === "waiting" || status === "active") {
            try {
              const tokenData = await readContractSafe<[bigint[], bigint[]]>({
                address: BET_CONTRACT_ADDRESS,
                abi: BET_ABI,
                functionName: "getRoomTokenIds",
                args: [id],
              });
              creatorTokenIds = tokenData[0].map(String);
              challengerTokenIds = tokenData[1].map(String);
            } catch {}
          }

          const winner = winners[i].toLowerCase();
          return {
            id,
            creator_wallet: creators[i].toLowerCase(),
            challenger_wallet: challengers[i] !== ZERO_ADDRESS ? challengers[i].toLowerCase() : null,
            nft_count: nftCounts[i],
            status,
            creator_choice: choiceToSide(creatorChoices[i]),
            creator_nft_ids: creatorTokenIds,
            challenger_nft_ids: challengerTokenIds,
            coin_result: status === "complete" ? choiceToSide(coinResults[i]) : null,
            winner_wallet: winner !== ZERO_ADDRESS ? winner : null,
            created_at: new Date(Number(createdAts[i]) * 1000).toISOString(),
            eth_amount: ethAmounts[i],
            name: names[i] || "",
          } as BetRoom;
        })
      );

      const addrLower = address?.toLowerCase();
      setBetRooms(rooms.filter(r => r.status === "waiting" || r.status === "active" || r.status === "flipping"));
      setMyCompletedBets(
        addrLower
          ? rooms.filter(r => r.status === "complete" && (r.creator_wallet === addrLower || r.challenger_wallet === addrLower)).reverse()
          : []
      );
    } catch (e) { console.error("loadBetRooms", e); }
  }, [address]);

  const loadRouletteRooms = useCallback(async () => {
    try {
      const [raw, rawExtra] = await Promise.all([
        readContractSafe<[bigint[], `0x${string}`[], `0x${string}`[], number[], number[], `0x${string}`[], number[], number[], bigint[]]>({
          address: ROULETTE_CONTRACT_ADDRESS,
          abi: ROULETTE_ABI,
          functionName: "getRecentRooms",
          args: [BigInt(50)],
        }),
        readContractSafe<[bigint[], bigint[], string[]]>({
          address: ROULETTE_CONTRACT_ADDRESS,
          abi: ROULETTE_ABI,
          functionName: "getRecentRoomsExtra",
          args: [BigInt(50)],
        }),
      ]);

      const [ids, redPlayers, blackPlayers, nftCounts, statuses, winners, results, spinSlots, createdAts] = raw;
      const [, ethAmounts, names] = rawExtra;

      const rooms: RouletteRoom[] = await Promise.all(
        ids.map(async (id, i) => {
          const status = ROULETTE_STATUS_MAP[statuses[i]] ?? "cancelled";
          let redTokenIds: string[] = [];
          let blackTokenIds: string[] = [];

          if (status === "waiting" || status === "active") {
            try {
              const tokenData = await readContractSafe<[bigint[], bigint[]]>({
                address: ROULETTE_CONTRACT_ADDRESS,
                abi: ROULETTE_ABI,
                functionName: "getRoomTokenIds",
                args: [id],
              });
              redTokenIds = tokenData[0].map(String);
              blackTokenIds = tokenData[1].map(String);
            } catch {}
          }

          const winner = winners[i].toLowerCase();
          const blackAddr = blackPlayers[i].toLowerCase();
          return {
            id,
            red_player: redPlayers[i].toLowerCase(),
            black_player: blackAddr !== ZERO_ADDRESS ? blackAddr : null,
            nft_count: nftCounts[i],
            status,
            red_nft_ids: redTokenIds,
            black_nft_ids: blackTokenIds,
            spin_slot: status === "complete" ? spinSlots[i] : null,
            spin_result: status === "complete" ? colorLabelFromResult(results[i]) : null,
            winner_wallet: winner !== ZERO_ADDRESS ? winner : null,
            created_at: new Date(Number(createdAts[i]) * 1000).toISOString(),
            eth_amount: ethAmounts[i],
            name: names[i] || "",
          } as RouletteRoom;
        })
      );

      const addrLower = address?.toLowerCase();
      setRouletteRooms(rooms.filter(r => r.status === "waiting" || r.status === "active" || r.status === "spinning"));
      setMyCompletedRoulettes(
        addrLower
          ? rooms.filter(r => r.status === "complete" && (r.red_player === addrLower || r.black_player === addrLower)).reverse()
          : []
      );
    } catch (e) { console.error("loadRouletteRooms", e); }
  }, [address]);

  // Detecta quando a room do usuário entra em "flipping" para mostrar overlay ao challenger
  useEffect(() => {
    if (!address || coinPhase !== "idle") return;
    const addrLower = address.toLowerCase();
    const myRoom = betRooms.find(r => r.creator_wallet === addrLower || r.challenger_wallet === addrLower);
    if (!myRoom) return;

    const roomKey = String(myRoom.id);
    const prev = prevRoomStatusRef.current.get(roomKey);
    prevRoomStatusRef.current.set(roomKey, myRoom.status);

    if (myRoom.status === "flipping" && prev !== "flipping") {
      setCoinPhase("spinning");
      // Polling para pegar o resultado
      let attempts = 0;
      const poll = async (): Promise<void> => {
        if (attempts++ > 40) { setCoinPhase("idle"); return; }
        await new Promise(r => setTimeout(r, 2000));
        const roomData = await readContractSafe<[string, string, number, number, string, number, number, bigint, bigint]>({
          address: BET_CONTRACT_ADDRESS,
          abi: BET_ABI,
          functionName: "getRoom",
          args: [myRoom.id],
        });
        const [,,,status, winner, coinResult, creatorChoice] = roomData;
        if (status === 3) {
          setCoinPhase("landed");
          setFlipResult({
            roomId: myRoom.id,
            result: choiceToSide(coinResult as number),
            winner: (winner as string).toLowerCase(),
            creatorChoice: choiceToSide(creatorChoice as number),
          });
          // Distribui 10 $CUM por NFT apostado para ambos os jogadores
          fetch("/api/bet-reward", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roomId: String(myRoom.id) }),
          }).catch(() => {});
          loadBetRooms();
        } else {
          return poll();
        }
      };
      poll();
    }
  }, [betRooms, address, coinPhase, loadBetRooms]);

  useEffect(() => { loadLeaderboard(); loadStore(); loadBurnData(); fetch("/api/verify", { method: "POST" }).catch(() => {}); supabase.from("settings").select("value").eq("key", "stake_enabled").single().then(({ data }) => setStakeEnabled(data?.value === "true")); supabase.from("settings").select("value").eq("key", "transfer_enabled").single().then(({ data }) => setTransferEnabled(data?.value !== "false")); supabase.from("settings").select("value").eq("key", "bet_enabled").single().then(({ data }) => setBetEnabled(data?.value !== "false")); }, []);
  useEffect(() => { if (isConnected && address) { loadUserData(); loadBurnData(); loadLeaderboard(); } }, [isConnected, address, loadUserData, loadBurnData, loadLeaderboard]);
  useEffect(() => { if (isAdmin && tab === "admin") loadAdminData(); }, [isAdmin, tab, loadAdminData]);
  useEffect(() => { if (tab === "dashboard") { loadLeaderboard(); } }, [tab, loadLeaderboard]);
  useEffect(() => { if (tab === "dashboard" && dashSubTab === "bet") loadBetLeaderboard(); }, [tab, dashSubTab, loadBetLeaderboard]);
  useEffect(() => {
    if (tab !== "bet") return;
    loadBetRooms();
    if (address) {
      readContractSafe<boolean>({
        address: NFT_CONTRACT_ADDRESS,
        abi: ERC721_ABI,
        functionName: "isApprovedForAll",
        args: [address as `0x${string}`, BET_CONTRACT_ADDRESS],
      }).then(approved => setBetApproved(!!approved)).catch(() => {});
    }
    const interval = setInterval(loadBetRooms, 3000);
    return () => clearInterval(interval);
  }, [tab, loadBetRooms, address]);

  useEffect(() => {
    if (tab !== "roulette") return;
    loadRouletteRooms();
    if (address) {
      readContractSafe<boolean>({
        address: NFT_CONTRACT_ADDRESS,
        abi: ERC721_ABI,
        functionName: "isApprovedForAll",
        args: [address as `0x${string}`, ROULETTE_CONTRACT_ADDRESS],
      }).then(approved => setRouletteApproved(!!approved)).catch(() => {});
    }
    const interval = setInterval(loadRouletteRooms, 3000);
    return () => clearInterval(interval);
  }, [tab, loadRouletteRooms, address]);

  // Detecta quando a room do usuário entra em "spinning" para mostrar wheel overlay ao challenger
  useEffect(() => {
    if (!address || wheelSpinning || wheelTargetSlot !== undefined) return;
    const addrLower = address.toLowerCase();
    const myRoom = rouletteRooms.find(r => r.red_player === addrLower || r.black_player === addrLower);
    if (!myRoom) return;

    const roomKey = String(myRoom.id);
    const prev = prevRouletteStatusRef.current.get(roomKey);
    prevRouletteStatusRef.current.set(roomKey, myRoom.status);

    if (myRoom.status === "spinning" && prev !== "spinning") {
      setWheelSpinning(true);
      setWheelTargetSlot(undefined);
      setWheelDone(false);
      let attempts = 0;
      const poll = async (): Promise<void> => {
        if (attempts++ > 40) { setWheelSpinning(false); return; }
        await new Promise(r => setTimeout(r, 2000));
        const roomData = await readContractSafe<[string, string, number, number, string, number, number, bigint, bigint, bigint, string]>({
          address: ROULETTE_CONTRACT_ADDRESS,
          abi: ROULETTE_ABI,
          functionName: "getRoom",
          args: [myRoom.id],
        });
        const [,,,status, winner, result, spinSlot] = roomData;
        if (Number(status) === 3) {
          setWheelSpinning(false);
          setWheelTargetSlot(Number(spinSlot));
          setWheelResult({
            roomId: myRoom.id,
            slot: Number(spinSlot),
            winner: (winner as string).toLowerCase(),
            result: colorLabelFromResult(Number(result)),
          });
          loadRouletteRooms();
        } else {
          return poll();
        }
      };
      poll();
    }
  }, [rouletteRooms, address, wheelSpinning, wheelTargetSlot, loadRouletteRooms]);

  // ═══ STAKE HANDLERS ═══
  const handleStake = async () => {
    if (!address || selectedIds.size === 0) return;
    setStaking(true);
    try {
      const ids = Array.from(selectedIds);
      const message = `I confirm soft staking ${ids.length} Cambrilio NFT(s): ${ids.join(", ")}\nWallet: ${address}\nTimestamp: ${new Date().toISOString()}`;
      const signature = await signMessageAsync({ account: address, message });
      const res = await fetch("/api/stake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: address, tokenIds: ids, signature }) });
      const data = await res.json();
      if (data.success) { showMsg(`Staked ${data.staked} NFT(s)! Total: ${data.total}`); setSelectedIds(new Set()); await loadUserData(); await loadLeaderboard(); }
      else showMsg(data.error, "err");
    } catch (err: any) { showMsg(err.message?.includes("rejected") ? "Signature rejected" : err.message, "err"); }
    finally { setStaking(false); }
  };

  const handleUnstake = async (tokenIds: string[]) => {
    if (!address) return; setStaking(true);
    try { const res = await fetch("/api/unstake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: address, tokenIds }) }); const data = await res.json(); if (data.success) { showMsg(`Unstaked. ${data.remaining} remaining.`); await loadUserData(); await loadLeaderboard(); } } catch (err: any) { showMsg(err.message, "err"); } finally { setStaking(false); }
  };

  // ═══ $CUM HANDLERS ═══
  const handleClaim = async () => {
    if (!address) return; setClaiming(true);
    try { const res = await fetch("/api/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: address }) }); const data = await res.json(); if (data.success) { showMsg(`Claimed ${data.claimed} $CUM! Balance: ${data.balance}`); await loadUserData(); } else showMsg(data.error, "err"); } catch (err: any) { showMsg(err.message, "err"); } finally { setClaiming(false); }
  };

  const handleRefreshMetadata = async () => {
    if (!address) return; setRefreshingMeta(true);
    try { const res = await fetch("/api/refresh-metadata", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: address }) }); const data = await res.json(); if (data.success) { showMsg(data.message); await loadUserData(); } else showMsg(data.error || "Failed to refresh", "err"); } catch (err: any) { showMsg(err.message, "err"); } finally { setRefreshingMeta(false); }
  };

  const handleTransferCum = async () => {
    if (!address || !transferWallet || !transferAmount) return;
    const amt = parseInt(transferAmount);
    if (isNaN(amt) || amt <= 0) { showMsg("Enter a valid amount", "err"); return; }
    if (amt > cumBalance) { showMsg(`Not enough $CUM. You have ${cumBalance}`, "err"); return; }
    if (!/^0x[a-fA-F0-9]{40}$/.test(transferWallet)) { showMsg("Invalid wallet address", "err"); return; }
    if (transferWallet.toLowerCase() === address.toLowerCase()) { showMsg("Cannot send to yourself", "err"); return; }
    setTransferring(true);
    try {
      const res = await fetch("/api/transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: address, to: transferWallet, amount: amt }) });
      const data = await res.json();
      if (data.success) { showMsg(`Sent ${amt} $CUM to ${shortAddr(transferWallet)}`); setTransferWallet(""); setTransferAmount(""); await loadUserData(); }
      else showMsg(data.error, "err");
    } catch (err: any) { showMsg(err.message, "err"); }
    finally { setTransferring(false); }
  };

  // ═══ STORE HANDLERS ═══
  const validateWlAddressClient = (chain: string, addr: string): string | null => {
    const v = (addr || "").trim();
    if (!v) return "WL wallet address is required";
    if (chain === "SOL") {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return "Invalid SOL address format";
      return null;
    }
    if (chain === "BTC") {
      if (!/^bc1[0-9a-z]{25,80}$/.test(v)) return "Invalid BTC Ordinals address format";
      return null;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(v)) return "Invalid ETH address format";
    return null;
  };

  const handleBuy = async (listing: StoreListing) => {
    if (!address || !wlWalletInput) return;
    const chain = listing.is_wl_project ? (listing.wl_chain || "ETH") : "ETH";
    const validationError = validateWlAddressClient(chain, wlWalletInput);
    if (validationError) {
      showMsg(validationError, "err");
      return;
    }
    setStaking(true);
    try {
      const res = await fetch("/api/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, listingId: listing.id, wlWallet: wlWalletInput }),
      });
      const data = await res.json();
      if (data.success) {
        showMsg(`WL purchased! Spent ${data.spent} $CUM`);
        setBuyingId(null);
        setWlWalletInput("");
        await loadUserData();
        await loadStore();
      } else showMsg(data.error, "err");
    } catch (err: any) { showMsg(err.message, "err"); } finally { setStaking(false); }
  };

  const handleDeleteListing = async (id: number, title: string) => {
    if (!address || !confirm(`Delete "${title}"?`)) return;
    try { const res = await fetch("/api/admin", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: address, listingId: id, updates: { is_active: false } }) }); const data = await res.json(); if (data.success) { showMsg("Listing deleted"); await loadStore(); await loadAdminData(); } else showMsg(data.error, "err"); } catch (err: any) { showMsg(err.message, "err"); }
  };

  // ═══ BURN HANDLERS ═══
  const handleBurnSubmit = async (rewardId: number) => {
    if (!address) return;
    const txs = (burnTxInputs[rewardId] || []).filter(t => t.trim().length > 0);
    if (txs.length === 0) { showMsg("Paste at least one transaction hash", "err"); return; }
    const invalid = txs.find(t => !t.trim().startsWith("0x") || t.trim().length !== 66);
    if (invalid) { showMsg("Invalid TX hash format", "err"); return; }
    setSubmittingBurn(true);
    try { const res = await fetch("/api/burn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: address, rewardId, txHashes: txs.map(t => t.trim()) }) }); const data = await res.json(); if (data.success) { showMsg(data.message || "Burn verified!"); setActiveBurnId(null); setBurnTxInputs(p => ({ ...p, [rewardId]: [] })); await loadBurnData(); } else showMsg(data.error, "err"); } catch (err: any) { showMsg(err.message, "err"); } finally { setSubmittingBurn(false); }
  };

  const handleDeleteBurnReward = async (rewardId: number, title: string) => {
    if (!address || !confirm(`Delete "${title}"?`)) return;
    try { const res = await fetch("/api/burn", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: address, rewardId }) }); const data = await res.json(); if (data.success) { showMsg("Reward deleted"); await loadBurnData(); } else showMsg(data.error, "err"); } catch (err: any) { showMsg(err.message, "err"); }
  };

  const handleUpdateBurnClaim = async (claimId: number, status: string) => {
    if (!address) return;
    try { const res = await fetch("/api/burn", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: address, claimId, status }) }); const data = await res.json(); if (data.success) { showMsg(`Claim → ${status}`); await loadBurnData(); } else showMsg(data.error, "err"); } catch (err: any) { showMsg(err.message, "err"); }
  };

  // ═══ ADMIN HANDLERS ═══
  const handleCreateListing = async () => {
    if (!address) return;
    try {
      const toUTC = (local: string) => local ? new Date(local).toISOString() : null;
      const payload = {
        wallet: address,
        ...newListing,
        startsAt: toUTC(newListing.startsAt),
        expiresAt: toUTC(newListing.expiresAt),
        // Ensure wlChain is null when not WL project
        wlChain: newListing.isWlProject ? newListing.wlChain : null,
      };
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        showMsg(`Listing created!`);
        setNewListing({
          title: "",
          description: "",
          imageUrl: "",
          projectUrl: "",
          priceCum: "5",
          totalSpots: "20",
          startsAt: "",
          expiresAt: "",
          maxPerWallet: "1",
          isWlProject: true,
          wlMintPrice: "",
          wlChain: "ETH",
          wlSupply: "",
          wlDescription: "",
        });
        await loadStore();
        await loadAdminData();
      } else showMsg(data.error, "err");
    } catch (err: any) { showMsg(err.message, "err"); }
  };

  const handleCreateBurnReward = async () => {
    if (!address) return;
    try {
      const toUTC = (local: string) => local ? new Date(local).toISOString() : null;
      const res = await fetch("/api/burn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_reward", wallet: address, ...newBurnReward, expiresAt: toUTC(newBurnReward.expiresAt), startsAt: toUTC(newBurnReward.startsAt) }) });
      const data = await res.json();
      if (data.success) { showMsg(`Burn reward created!`); setNewBurnReward({ title: "", description: "", imageUrl: "", burnCost: "10", totalSupply: "1", expiresAt: "", startsAt: "" }); await loadBurnData(); } else showMsg(data.error, "err");
    } catch (err: any) { showMsg(err.message, "err"); }
  };

  const toggleStakeEnabled = async () => {
    if (!address) return;
    const newVal = !stakeEnabled;
    try { const res = await fetch("/api/admin", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: address, setting: { key: "stake_enabled", value: String(newVal) } }) }); const data = await res.json(); if (data.success) { setStakeEnabled(newVal); showMsg(`Staking ${newVal ? "ENABLED" : "DISABLED"}`); } } catch (err: any) { showMsg(err.message, "err"); }
  };

  const toggleTransferEnabled = async () => {
    if (!address) return;
    const newVal = !transferEnabled;
    try { const res = await fetch("/api/admin", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: address, setting: { key: "transfer_enabled", value: String(newVal) } }) }); const data = await res.json(); if (data.success) { setTransferEnabled(newVal); showMsg(`$CUM Transfer ${newVal ? "ENABLED" : "DISABLED"}`); } } catch (err: any) { showMsg(err.message, "err"); }
  };

  const toggleBetEnabled = async () => {
    if (!address) return;
    const newVal = !betEnabled;
    try { const res = await fetch("/api/admin", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: address, setting: { key: "bet_enabled", value: String(newVal) } }) }); const data = await res.json(); if (data.success) { setBetEnabled(newVal); showMsg(`Bet tab ${newVal ? "ENABLED" : "DISABLED"}`); } } catch (err: any) { showMsg(err.message, "err"); }
  };

  const handleRecoverStakes = async () => {
    if (!address) return;
    if (!confirm("Isso vai restaurar todas as stakes removidas por API quebrada e re-verificar ownership. Continuar?")) return;
    try {
      showMsg("Restaurando stakes...");
      const res = await fetch("/api/recover-stakes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: address }) });
      const data = await res.json();
      if (data.error) { showMsg(data.error, "err"); return; }
      showMsg(`${data.message}`);
      // Now trigger re-verify to check real ownership with new API key
      setTimeout(async () => {
        showMsg("Re-verificando ownership com nova API...");
        const vRes = await fetch("/api/verify", { method: "POST" });
        const vData = await vRes.json();
        if (vData.error) { showMsg(vData.error, "err"); return; }
        showMsg(`Verificação completa: ${vData.verified} válidos, ${vData.removed} removidos`);
        loadLeaderboard();
      }, 1000);
    } catch (err: any) { showMsg(err.message, "err"); }
  };

  const updateBurnTxInput = (rid: number, idx: number, val: string) => setBurnTxInputs(prev => { const a = [...(prev[rid] || [""])]; a[idx] = val; return { ...prev, [rid]: a }; });
  const addTxField = (rid: number) => setBurnTxInputs(prev => { const a = [...(prev[rid] || [""]), ""]; return { ...prev, [rid]: a }; });
  const removeTxField = (rid: number, idx: number) => setBurnTxInputs(prev => { const a = [...(prev[rid] || [])]; a.splice(idx, 1); if (a.length === 0) a.push(""); return { ...prev, [rid]: a }; });

  // ═══ BET HANDLERS (on-chain) ═══
  const resolvedBetCount = betNftCount === "custom" ? parseInt(betCustomCount || "0") : betNftCount;

  const ensureBetApproval = async (): Promise<boolean> => {
    if (!address) return false;
    try {
      const approved = await readContractSafe<boolean>({
        address: NFT_CONTRACT_ADDRESS,
        abi: ERC721_ABI,
        functionName: "isApprovedForAll",
        args: [address as `0x${string}`, BET_CONTRACT_ADDRESS],
      });
      if (approved) { setBetApproved(true); return true; }
      showMsg("Approve NFT contract first — confirm in wallet", "ok");
      const txHash = await writeContractAsync({
        address: NFT_CONTRACT_ADDRESS,
        abi: ERC721_ABI,
        functionName: "setApprovalForAll",
        args: [BET_CONTRACT_ADDRESS, true],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      setBetApproved(true);
      return true;
    } catch (err: any) { showMsg(err.shortMessage || err.message, "err"); return false; }
  };

  const handleCreateBet = async () => {
    if (!address || betSelectedIds.size === 0) return;
    const ids = Array.from(betSelectedIds);
    if (ids.length !== resolvedBetCount) { showMsg(`Select exactly ${resolvedBetCount} NFT(s) to wager`, "err"); return; }
    setCreatingBet(true);
    try {
      if (!(await ensureBetApproval())) return;
      const ethWei = betEthAmount ? BigInt(Math.floor(parseFloat(betEthAmount) * 1e18)) : 0n;
      const txHash = await writeContractAsync({
        address: BET_CONTRACT_ADDRESS,
        abi: BET_ABI,
        functionName: "createRoom",
        args: [ids.map(BigInt), sideToChoice(betChoice), betRoomName.trim().slice(0, 32)],
        value: ethWei + PROTOCOL_FEE,
      } as any);
      showMsg("Tx submitted — waiting for confirmation...");
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      showMsg("Bet room created! Waiting for a challenger...");
      setBetSelectedIds(new Set());
      await loadBetRooms();
    } catch (err: any) { showMsg(err.shortMessage || err.message, "err"); }
    finally { setCreatingBet(false); }
  };

  const handleJoinBet = async (roomId: bigint) => {
    if (!address || betJoinSelectedIds.size === 0) return;
    setJoiningBet(true);
    try {
      if (!(await ensureBetApproval())) return;
      const room = betRooms.find(r => r.id === roomId);
      const ethWei = room?.eth_amount ?? 0n;
      const txHash = await writeContractAsync({
        address: BET_CONTRACT_ADDRESS,
        abi: BET_ABI,
        functionName: "joinRoom",
        args: [roomId, Array.from(betJoinSelectedIds).map(BigInt)],
        value: ethWei + PROTOCOL_FEE,
      } as any);
      showMsg("Tx submitted — waiting for confirmation...");
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      showMsg("Joined! Both players are ready — flip the coin!");
      setBetJoinRoomId(null);
      setBetJoinSelectedIds(new Set());
      await loadBetRooms();
    } catch (err: any) { showMsg(err.shortMessage || err.message, "err"); }
    finally { setJoiningBet(false); }
  };

  const handleFlip = async (roomId: bigint) => {
    if (!address) return;
    setFlippingBet(true);
    setCoinPhase("spinning");
    try {
      // Submit flip() tx — this only requests VRF randomness
      const txHash = await writeContractAsync({
        address: BET_CONTRACT_ADDRESS,
        abi: BET_ABI,
        functionName: "flip",
        args: [roomId],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      await loadBetRooms();

      // Poll getRoom() until Chainlink fulfills (status goes from Flipping → Complete)
      let attempts = 0;
      const poll = async (): Promise<void> => {
        if (attempts++ > 40) {
          showMsg("VRF taking longer than expected — result will appear when confirmed", "ok");
          setCoinPhase("idle");
          return;
        }
        await new Promise(r => setTimeout(r, 2000));
        const roomData = await readContractSafe<[string, string, number, number, string, number, number, bigint, bigint]>({
          address: BET_CONTRACT_ADDRESS,
          abi: BET_ABI,
          functionName: "getRoom",
          args: [roomId],
        });
        const [,,,status, winner, coinResult, creatorChoice] = roomData;
        if (status === 3) { // Complete
          setCoinPhase("landed");
          setFlipResult({
            roomId,
            result: choiceToSide(coinResult),
            winner: (winner as string).toLowerCase(),
            creatorChoice: choiceToSide(creatorChoice),
          });
          await loadBetRooms();
        } else {
          return poll();
        }
      };
      await poll();
    } catch (err: any) {
      showMsg(err.shortMessage || err.message, "err");
      setCoinPhase("idle");
    }
    finally { setFlippingBet(false); }
  };

  const handleRefundExpired = async (roomId: bigint) => {
    if (!address) return;
    try {
      const txHash = await writeContractAsync({
        address: BET_CONTRACT_ADDRESS,
        abi: BET_ABI,
        functionName: "refundExpired",
        args: [roomId],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      showMsg("Room expired — NFTs returned to both players.");
      await loadBetRooms();
    } catch (err: any) { showMsg(err.shortMessage || err.message, "err"); }
  };

  const handleCancelBet = async (roomId: bigint) => {
    if (!address) return;
    try {
      const txHash = await writeContractAsync({
        address: BET_CONTRACT_ADDRESS,
        abi: BET_ABI,
        functionName: "cancelRoom",
        args: [roomId],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      showMsg("Bet room cancelled. NFTs returned to your wallet.");
      await loadBetRooms();
    } catch (err: any) { showMsg(err.shortMessage || err.message, "err"); }
  };

  // ═══ ROULETTE HANDLERS (on-chain) ═══
  const resolvedRouletteCount = rouletteNftCount === "custom" ? parseInt(rouletteCustomCount || "0") : rouletteNftCount;

  const ensureRouletteApproval = async (): Promise<boolean> => {
    if (!address) return false;
    try {
      const approved = await readContractSafe<boolean>({
        address: NFT_CONTRACT_ADDRESS,
        abi: ERC721_ABI,
        functionName: "isApprovedForAll",
        args: [address as `0x${string}`, ROULETTE_CONTRACT_ADDRESS],
      });
      if (approved) { setRouletteApproved(true); return true; }
      showMsg("Approve NFT contract first — confirm in wallet", "ok");
      const txHash = await writeContractAsync({
        address: NFT_CONTRACT_ADDRESS,
        abi: ERC721_ABI,
        functionName: "setApprovalForAll",
        args: [ROULETTE_CONTRACT_ADDRESS, true],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      setRouletteApproved(true);
      return true;
    } catch (err: any) { showMsg(err.shortMessage || err.message, "err"); return false; }
  };

  const handleCreateRoulette = async () => {
    if (!address || rouletteSelectedIds.size === 0) return;
    const ids = Array.from(rouletteSelectedIds);
    if (ids.length !== resolvedRouletteCount) { showMsg(`Select exactly ${resolvedRouletteCount} NFT(s) to wager`, "err"); return; }
    setCreatingRoulette(true);
    try {
      if (!(await ensureRouletteApproval())) return;
      const ethWei = rouletteEthAmount ? BigInt(Math.floor(parseFloat(rouletteEthAmount) * 1e18)) : 0n;
      const colorNum = rouletteColor === "red" ? ROULETTE_RED : ROULETTE_BLACK;
      const txHash = await writeContractAsync({
        address: ROULETTE_CONTRACT_ADDRESS,
        abi: ROULETTE_ABI,
        functionName: "createRoom",
        args: [ids.map(BigInt), colorNum, rouletteRoomName.trim().slice(0, 32)],
        value: ethWei + ROULETTE_PROTOCOL_FEE,
      } as any);
      showMsg("Tx submitted — waiting for confirmation...");
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      showMsg("Roulette room created! Waiting for a challenger...");
      setRouletteSelectedIds(new Set());
      await loadRouletteRooms();
    } catch (err: any) { showMsg(err.shortMessage || err.message, "err"); }
    finally { setCreatingRoulette(false); }
  };

  const handleJoinRoulette = async (roomId: bigint) => {
    if (!address || rouletteJoinSelectedIds.size === 0) return;
    setJoiningRoulette(true);
    try {
      if (!(await ensureRouletteApproval())) return;
      const room = rouletteRooms.find(r => r.id === roomId);
      const ethWei = room?.eth_amount ?? 0n;
      const txHash = await writeContractAsync({
        address: ROULETTE_CONTRACT_ADDRESS,
        abi: ROULETTE_ABI,
        functionName: "joinRoom",
        args: [roomId, Array.from(rouletteJoinSelectedIds).map(BigInt)],
        value: ethWei + ROULETTE_PROTOCOL_FEE,
      } as any);
      showMsg("Tx submitted — waiting for confirmation...");
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      showMsg("Joined! Both players are ready — spin the wheel!");
      setRouletteJoinRoomId(null);
      setRouletteJoinSelectedIds(new Set());
      await loadRouletteRooms();
    } catch (err: any) { showMsg(err.shortMessage || err.message, "err"); }
    finally { setJoiningRoulette(false); }
  };

  const handleSpin = async (roomId: bigint) => {
    if (!address) return;
    setSpinningRoulette(true);
    setWheelSpinning(true);
    setWheelTargetSlot(undefined);
    setWheelDone(false);
    try {
      const txHash = await writeContractAsync({
        address: ROULETTE_CONTRACT_ADDRESS,
        abi: ROULETTE_ABI,
        functionName: "spin",
        args: [roomId],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      await loadRouletteRooms();

      let attempts = 0;
      const poll = async (): Promise<void> => {
        if (attempts++ > 40) {
          showMsg("VRF taking longer than expected — result will appear when confirmed", "ok");
          setWheelSpinning(false);
          return;
        }
        await new Promise(r => setTimeout(r, 2000));
        const roomData = await readContractSafe<[string, string, number, number, string, number, number, bigint, bigint, bigint, string]>({
          address: ROULETTE_CONTRACT_ADDRESS,
          abi: ROULETTE_ABI,
          functionName: "getRoom",
          args: [roomId],
        });
        const [,,,status, winner, result, spinSlot] = roomData;
        if (Number(status) === 3) {
          setWheelSpinning(false);
          setWheelTargetSlot(Number(spinSlot));
          setWheelResult({
            roomId,
            slot: Number(spinSlot),
            winner: (winner as string).toLowerCase(),
            result: colorLabelFromResult(Number(result)),
          });
          await loadRouletteRooms();
        } else {
          return poll();
        }
      };
      await poll();
    } catch (err: any) {
      showMsg(err.shortMessage || err.message, "err");
      setWheelSpinning(false);
    } finally { setSpinningRoulette(false); }
  };

  const handleCancelRoulette = async (roomId: bigint) => {
    if (!address) return;
    try {
      const txHash = await writeContractAsync({
        address: ROULETTE_CONTRACT_ADDRESS,
        abi: ROULETTE_ABI,
        functionName: "cancelRoom",
        args: [roomId],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      showMsg("Roulette room cancelled. NFTs returned to your wallet.");
      await loadRouletteRooms();
    } catch (err: any) { showMsg(err.shortMessage || err.message, "err"); }
  };

  const handleRefundExpiredRoulette = async (roomId: bigint) => {
    if (!address) return;
    try {
      const txHash = await writeContractAsync({
        address: ROULETTE_CONTRACT_ADDRESS,
        abi: ROULETTE_ABI,
        functionName: "refundExpired",
        args: [roomId],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      showMsg("Room expired — NFTs returned to both players.");
      await loadRouletteRooms();
    } catch (err: any) { showMsg(err.shortMessage || err.message, "err"); }
  };

  const toggleSelect = (id: string) => setSelectedIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = () => setSelectedIds(new Set(ownedNfts.filter(n => !stakedIds.has(n.tokenId) && !listedIds.has(n.tokenId)).map(n => n.tokenId)));
  const stakeableNfts = ownedNfts.filter(n => !stakedIds.has(n.tokenId) && !listedIds.has(n.tokenId));
  const stakedNfts = ownedNfts.filter(n => stakedIds.has(n.tokenId));
  const listedNfts = ownedNfts.filter(n => listedIds.has(n.tokenId));

  // Check if listing/reward is expired
  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    const d = parseLocalTimestamp(expiresAt);
    if (!d) return false;
    return d.getTime() <= Date.now();
  };
  const RECENT_ALERT_WINDOW_MS = 48 * 60 * 60 * 1000;
  const nowTs = Date.now();
  const newStoreTitles = listings
    .filter(l => l.is_active && nowTs - new Date(l.created_at).getTime() <= RECENT_ALERT_WINDOW_MS)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 3)
    .map(l => l.title);
  const newBurnTitles = burnRewards
    .filter(r => r.is_active && nowTs - new Date(r.created_at).getTime() <= RECENT_ALERT_WINDOW_MS)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 3)
    .map(r => r.title);
  const alertParts: string[] = [];
  if (newStoreTitles.length > 0) alertParts.push(`🛒 NEW STORE: ${newStoreTitles.join(" • ")}`);
  if (newBurnTitles.length > 0) alertParts.push(`🔥 NEW BURN: ${newBurnTitles.join(" • ")}`);
  const topAnnouncement = alertParts.join("   ✦   ");

  // ═══ RENDER ═══
  return (
    <div style={{ minHeight: "100vh", background: `${T.bg}cc`, color: T.white, fontFamily: "'Share Tech Mono', monospace" }}>
      {/* NAV */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: `${T.bg}ee`, backdropFilter: "blur(12px)", borderBottom: `1px solid ${T.border}`, padding: "0 16px" }}>
        {topAnnouncement && (
          <div style={{ height: 28, display: "flex", alignItems: "center", borderBottom: `1px solid ${T.border}`, overflow: "hidden", background: `${T.accent}08` }}>
            <div className="top-alert-marquee-track">
              <span className="top-alert-text">{topAnnouncement}   ✦   {topAnnouncement}   ✦   {topAnnouncement}</span>
            </div>
          </div>
        )}
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56, gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <img src="/1500x500.png" alt="Cambrilio" style={{ height: 38, width: 'auto' }} />
          </div>
          {/* Desktop tabs */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 1 }}>
            {(["stake", "store", "burn", "bet", "roulette", "dashboard", ...(isAdmin ? ["admin"] : [])] as const).map(t => (
              <button key={t} onClick={() => { setTab(t as any); setMobileMenu(false); }} className="nav-tab-desktop" style={{ background: "none", border: "none", cursor: "pointer", color: tab === t ? T.accent : T.grayD, fontSize: 10, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 1.5, borderBottom: tab === t ? `2px solid ${T.accent}` : "2px solid transparent", padding: "6px 2px", whiteSpace: "nowrap", flexShrink: 0 }}>▸{t.toUpperCase()}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
            {isConnected && <div style={{ padding: "3px 8px", background: `${T.cum}15`, border: `1px solid ${T.cum}30`, borderRadius: 6 }}><span style={{ fontSize: 11, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.cum }}>{cumBalance}</span><span style={{ fontSize: 8, color: T.cum, opacity: 0.7, marginLeft: 3 }}>$CUM</span></div>}
            <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" label="Connect Wallet" />
            {/* Hamburger for mobile */}
            <button className="nav-hamburger" onClick={() => setMobileMenu(p => !p)} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 8px", cursor: "pointer", color: T.white, fontSize: 16, lineHeight: 1 }}>{mobileMenu ? "✕" : "☰"}</button>
          </div>
        </div>
        {/* Mobile dropdown */}
        {mobileMenu && (
          <div className="nav-mobile-menu" style={{ display: "flex", flexDirection: "column", gap: 2, padding: "8px 0 12px", borderTop: `1px solid ${T.border}` }}>
            {(["stake", "store", "burn", "bet", "roulette", "dashboard", ...(isAdmin ? ["admin"] : [])] as const).map(t => (
              <button key={t} onClick={() => { setTab(t as any); setMobileMenu(false); }} style={{ background: tab === t ? `${T.accent}10` : "none", border: "none", cursor: "pointer", color: tab === t ? T.accent : T.grayD, fontSize: 12, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 2, padding: "10px 16px", textAlign: "left", borderRadius: 6, borderLeft: tab === t ? `3px solid ${T.accent}` : "3px solid transparent" }}>▸ {t.toUpperCase()}</button>
            ))}
          </div>
        )}
      </nav>
      <style>{`
        .top-alert-marquee-track {
          width: 100%;
          white-space: nowrap;
          will-change: transform;
          animation: topAlertMarquee 22s linear infinite;
        }
        .top-alert-text {
          display: inline-block;
          padding-left: 100%;
          font-size: 10px;
          font-family: 'Share Tech Mono', monospace;
          font-weight: 700;
          letter-spacing: 2px;
          color: ${T.accent};
        }
        @media (max-width: 640px) {
          .nav-tab-desktop { display: none !important; }
          .nav-hamburger { display: flex !important; }
          .top-alert-text { font-size: 9px; }
        }
        @media (min-width: 641px) {
          .nav-hamburger { display: none !important; }
          .nav-mobile-menu { display: none !important; }
        }
        .coin-spin-loop { animation: coinSpinLoop 0.55s linear infinite; }
        .coin-land-heads { animation: coinLandHeads 1.4s cubic-bezier(0.25,0.46,0.45,0.94) forwards; }
        .coin-land-tails { animation: coinLandTails 1.4s cubic-bezier(0.25,0.46,0.45,0.94) forwards; }
        .result-pop { animation: resultPop 0.4s ease forwards; }
        .overlay-fade { animation: overlayFadeIn 0.25s ease forwards; }
      `}</style>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px 60px" }}>
        {msg && <div style={{ padding: "10px 14px", marginBottom: 16, borderRadius: 8, background: msgType === "err" ? `${T.burn}15` : `${T.success}15`, border: `1px solid ${msgType === "err" ? T.burn : T.success}30`, color: msgType === "err" ? T.burn : T.success, fontSize: 12, fontFamily: "'Share Tech Mono', monospace" }}>{msg}</div>}

        {/* ═══════════════ STAKE TAB ═══════════════ */}
        {tab === "stake" && (
          <>
            {!isConnected ? (
              <div style={{ textAlign: "center", padding: "60px 16px", animation: "fadeSlideUp 0.6s ease both" }}>
                <img src="/1500x500.png" alt="Cambrilio" style={{ maxWidth: 440, width: "100%", marginBottom: 32 }} />
                <h1 style={{ fontSize: 28, fontWeight: 900, fontFamily: "'Orbitron', sans-serif", letterSpacing: 3, marginBottom: 12, color: T.accent }}>SOFT STAKE</h1>
                <p style={{ fontSize: 13, color: T.gray, maxWidth: 420, margin: "0 auto 14px", lineHeight: 1.8, fontFamily: "'Share Tech Mono', monospace" }}>Stake your Cambrilios without leaving your wallet. Earn <span style={{ color: T.cum, fontWeight: 700 }}>$CUM tickets</span> every 24 hours.</p>
                <p style={{ fontSize: 11, color: T.grayD, fontFamily: "'Share Tech Mono', monospace", marginBottom: 8 }}>1 staked NFT = 1 $CUM / day</p>
                <p style={{ fontSize: 10, color: T.accent, fontFamily: "'Share Tech Mono', monospace", marginBottom: 4 }}>🎉 Party Hat NFTs = <b>3x</b> boost</p>
                <p style={{ fontSize: 10, color: T.gold, fontFamily: "'Share Tech Mono', monospace", marginBottom: 24 }}>👑 1/1 NFTs = <b>5x</b> boost</p>
              </div>
            ) : loading ? (
              <div style={{ textAlign: "center", padding: 60, fontSize: 11, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>⏳ Loading your Cambrilios...</div>
            ) : ownedNfts.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60 }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>😔</div>
                <div style={{ fontSize: 14, fontFamily: "'Share Tech Mono', monospace", color: T.gray }}>No Cambrilios found in this wallet</div>
                <a href="https://opensea.io/collection/cambrilio" target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 16, padding: "10px 24px", background: T.accent, color: T.bg, borderRadius: 8, fontSize: 12, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", textDecoration: "none" }}>BUY ON OPENSEA →</a>
              </div>
            ) : (
              <>
                {/* $CUM Balance Card */}
                <div style={{ ...PS, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, letterSpacing: 2, fontWeight: 700, marginBottom: 4 }}>YOUR $CUM BALANCE</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 32, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.cum }}>{cumBalance}</span>
                      <span style={{ fontSize: 12, fontFamily: "'Share Tech Mono', monospace", color: T.cum, opacity: 0.6 }}>$CUM</span>
                    </div>
                    <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginTop: 4 }}>Rate: {cumRate}/day{Object.keys(nftBoostMap).length > 0 && <span style={{ color: T.accent }}> (boosted!)</span>} • Pending: ~{cumPending} • Earned: {cumEarned} • Spent: {cumSpent}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button onClick={handleClaim} disabled={claiming || cumPending < 1} style={{ background: cumPending >= 1 ? T.cum : T.grayK, color: T.bg, border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 12, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 1, cursor: cumPending >= 1 ? "pointer" : "not-allowed", opacity: claiming ? 0.6 : 1 }}>{claiming ? "CLAIMING..." : cumPending >= 1 ? `CLAIM ${cumPending} $CUM` : "ACCUMULATING (24h cycle)"}</button>
                    <button onClick={handleRefreshMetadata} disabled={refreshingMeta} style={{ background: `${T.sweep}15`, border: `1px solid ${T.sweep}40`, borderRadius: 8, padding: "10px 14px", fontSize: 9, fontWeight: 700, fontFamily: "'Share Tech Mono', monospace", color: T.sweep, cursor: refreshingMeta ? "wait" : "pointer", opacity: refreshingMeta ? 0.6 : 1 }}>{refreshingMeta ? "⏳ REFRESHING..." : "🔄 REFRESH METADATA"}</button>
                  </div>
                </div>

                {/* Send $CUM to another wallet */}
                {transferEnabled && (
                <div style={{ ...PS, padding: 16 }}>
                  <div style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, letterSpacing: 2, fontWeight: 700, marginBottom: 10 }}>SEND $CUM TO ANOTHER WALLET</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <div style={{ flex: "1 1 200px" }}>
                      <label style={{ fontSize: 8, fontFamily: "'Share Tech Mono', monospace", color: T.grayK }}>RECIPIENT WALLET</label>
                      <input type="text" placeholder="0x..." value={transferWallet} onChange={e => setTransferWallet(e.target.value)} style={{ ...inputStyle, marginTop: 2 }} />
                    </div>
                    <div style={{ flex: "0 0 100px" }}>
                      <label style={{ fontSize: 8, fontFamily: "'Share Tech Mono', monospace", color: T.grayK }}>AMOUNT</label>
                      <input type="number" placeholder="0" value={transferAmount} onChange={e => setTransferAmount(e.target.value)} style={{ ...inputStyle, marginTop: 2 }} />
                    </div>
                    <button onClick={handleTransferCum} disabled={transferring || !transferWallet || !transferAmount} style={{ background: cumBalance > 0 && transferWallet && transferAmount ? T.cum : T.grayK, color: T.bg, border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 10, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", cursor: cumBalance > 0 ? "pointer" : "not-allowed", opacity: transferring ? 0.6 : 1, whiteSpace: "nowrap" }}>{transferring ? "SENDING..." : "SEND $CUM"}</button>
                  </div>
                </div>
                )}

                {/* Stake disabled notice */}
                {!stakeEnabled && (
                  <div style={{ ...PS, background: `${T.grayK}40`, textAlign: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, letterSpacing: 2 }}>🔒 STAKING IS CURRENTLY PAUSED</div>
                    <div style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: T.grayK, marginTop: 6 }}>New stakes are disabled by admin. Existing stakes continue earning $CUM.</div>
                  </div>
                )}

                {/* Staked */}
                {stakedNfts.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                      <h2 style={{ fontSize: 15, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.sweep, letterSpacing: 2 }}>🔒 STAKED ({stakedNfts.length})</h2>
                      {stakeEnabled && <button onClick={() => handleUnstake(stakedNfts.map(n => n.tokenId))} disabled={staking} style={{ background: `${T.burn}15`, border: `1px solid ${T.burn}40`, borderRadius: 6, padding: "5px 12px", color: T.burn, fontSize: 9, fontFamily: "'Share Tech Mono', monospace", fontWeight: 700, cursor: "pointer" }}>UNSTAKE ALL</button>}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                      {stakedNfts.map(nft => {
                        const boost = nftBoostMap[nft.tokenId] || nft.boostMultiplier || 1;
                        const boostColor = boost >= 5 ? T.gold : boost >= 3 ? T.accent : "";
                        return (
                        <div key={nft.tokenId} style={{ background: T.card, border: `1px solid ${boost > 1 ? boostColor + "60" : T.sweep + "40"}`, borderRadius: 10, overflow: "hidden" }}>
                          <div style={{ aspectRatio: "1", position: "relative", background: T.bg }}>
                            {nft.image ? <img src={nft.image} alt={nft.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>🎨</div>}
                            <div style={{ position: "absolute", top: 3, right: 3, background: T.sweep, borderRadius: 4, padding: "2px 5px", fontSize: 7, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.bg }}>STAKED</div>
                            {boost > 1 && <div style={{ position: "absolute", top: 3, left: 3, background: boostColor, borderRadius: 4, padding: "2px 5px", fontSize: 7, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.bg }}>{boost}x BOOST</div>}
                          </div>
                          <div style={{ padding: "5px 7px" }}>
                            <div style={{ fontSize: 9, fontWeight: 700, fontFamily: "'Share Tech Mono', monospace", color: T.sweep, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nft.name}</div>
                            <div style={{ fontSize: 7, fontFamily: "'Share Tech Mono', monospace", color: boost > 1 ? boostColor : T.cum, marginTop: 2, fontWeight: boost > 1 ? 800 : 400 }}>+{boost} $CUM/day{boost > 1 && " 🔥"}</div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Listed */}
                {listedNfts.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <h2 style={{ fontSize: 13, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.listed, letterSpacing: 2, marginBottom: 10 }}>⚠️ LISTED — DELIST TO STAKE ({listedNfts.length})</h2>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                      {listedNfts.map(nft => (
                        <div key={nft.tokenId} style={{ background: T.card, border: `1px solid ${T.listed}30`, borderRadius: 10, overflow: "hidden", opacity: 0.4 }}>
                          <div style={{ aspectRatio: "1", background: T.bg }}>{nft.image ? <img src={nft.image} alt={nft.name} style={{ width: "100%", height: "100%", objectFit: "cover", filter: "grayscale(0.5)" }} /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>🎨</div>}</div>
                          <div style={{ padding: "5px 7px" }}><div style={{ fontSize: 9, fontWeight: 700, fontFamily: "'Share Tech Mono', monospace", color: T.listed }}>{nft.name}</div></div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Available to stake */}
                {stakeableNfts.length > 0 && stakeEnabled && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                      <h2 style={{ fontSize: 15, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.accent, letterSpacing: 2 }}>AVAILABLE ({stakeableNfts.length})</h2>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={selectAll} style={{ background: `${T.accent}15`, border: `1px solid ${T.accent}40`, borderRadius: 6, padding: "5px 12px", color: T.accent, fontSize: 9, fontFamily: "'Share Tech Mono', monospace", fontWeight: 700, cursor: "pointer" }}>SELECT ALL</button>
                        <button onClick={() => setSelectedIds(new Set())} style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 12px", color: T.grayD, fontSize: 9, fontFamily: "'Share Tech Mono', monospace", fontWeight: 700, cursor: "pointer" }}>CLEAR</button>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                      {stakeableNfts.map(nft => {
                        const sel = selectedIds.has(nft.tokenId);
                        const boost = nft.boostMultiplier || 1;
                        const boostColor = boost >= 5 ? T.gold : boost >= 3 ? T.accent : "";
                        return (
                          <div key={nft.tokenId} onClick={() => toggleSelect(nft.tokenId)} style={{ background: T.card, borderRadius: 10, overflow: "hidden", cursor: "pointer", border: `2px solid ${sel ? T.accent : T.border}`, transition: "all 0.15s" }}>
                            <div style={{ aspectRatio: "1", position: "relative", background: T.bg }}>
                              {nft.image ? <img src={nft.image} alt={nft.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>🎨</div>}
                              {sel && <div style={{ position: "absolute", inset: 0, background: `${T.accent}20`, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontSize: 28 }}>✓</span></div>}
                              {boost > 1 && <div style={{ position: "absolute", top: 3, left: 3, background: boostColor, borderRadius: 4, padding: "2px 5px", fontSize: 7, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.bg }}>{boost}x BOOST</div>}
                            </div>
                            <div style={{ padding: "5px 7px" }}>
                              <div style={{ fontSize: 9, fontWeight: 700, fontFamily: "'Share Tech Mono', monospace", color: sel ? T.accent : T.white, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nft.name}</div>
                              {boost > 1 && <div style={{ fontSize: 7, fontFamily: "'Share Tech Mono', monospace", color: boostColor, fontWeight: 800 }}>+{boost} $CUM/day 🔥</div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {selectedIds.size > 0 && (
                      <div style={{ position: "sticky", bottom: 16, marginTop: 16, background: `${T.bg}ee`, backdropFilter: "blur(12px)", border: `1px solid ${T.accent}40`, borderRadius: 12, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                        <div><div style={{ fontSize: 13, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.accent }}>{selectedIds.size} NFT{selectedIds.size > 1 ? "s" : ""}</div><div style={{ fontSize: 9, color: T.cum, fontFamily: "'Share Tech Mono', monospace" }}>= {ownedNfts.filter(n => selectedIds.has(n.tokenId)).reduce((sum, n) => sum + (n.boostMultiplier || 1), 0)} $CUM/day{ownedNfts.filter(n => selectedIds.has(n.tokenId)).some(n => (n.boostMultiplier || 1) > 1) ? " 🔥" : ""}</div></div>
                        <button onClick={handleStake} disabled={staking} style={{ background: T.accent, color: T.bg, border: "none", borderRadius: 8, padding: "10px 28px", fontSize: 13, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 2, cursor: staking ? "wait" : "pointer", opacity: staking ? 0.6 : 1 }}>{staking ? "SIGNING..." : "🔒 STAKE NOW"}</button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ═══════════════ STORE TAB ═══════════════ */}
        {tab === "store" && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 2, color: T.white, marginBottom: 6 }}>$CUM STORE</h2>
            <p style={{ fontSize: 11, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginBottom: 20 }}>Spend your $CUM tickets on WL spots, airdrops, itens in game, cambrilios....</p>
            {isConnected && <div style={{ ...PS, display: "flex", gap: 16, alignItems: "center" }}><span style={{ fontSize: 22, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.cum }}>{cumBalance}</span><span style={{ fontSize: 10, color: T.cum, opacity: 0.6 }}>$CUM available</span></div>}
            {listings.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60 }}><div style={{ fontSize: 36 }}>🔮</div><div style={{ fontSize: 16, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.accent, letterSpacing: 2, marginTop: 10 }}>SOONBRIA!</div><div style={{ fontSize: 10, color: T.grayD, fontFamily: "'Share Tech Mono', monospace", marginTop: 6 }}>No listings yet.</div></div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
                {listings.filter(l => l.is_active).map(l => {
                  const notStarted = l.starts_at ? (() => { const d = parseLocalTimestamp(l.starts_at!); return d ? d.getTime() > Date.now() : false; })() : false;
                  const ended = isExpired(l.expires_at);
                  const soldOut = l.remaining_spots <= 0;
                  const buyDisabled = soldOut || ended || notStarted;
                  return (
                  <div key={l.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden" }}>
                    {l.image_url && <img src={l.image_url} alt={l.title} style={{ width: "100%", height: 140, objectFit: "cover" }} />}
                    <div style={{ padding: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <h3 style={{ fontSize: 15, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", color: T.white, margin: 0 }}>{l.title}</h3>
                        {l.project_url && <a href={l.project_url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 8px", background: `${T.sweep}10`, border: `1px solid ${T.sweep}30`, borderRadius: 6, color: T.sweep, fontSize: 9, fontFamily: "'Share Tech Mono', monospace", fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>🔗 LINK</a>}
                      </div>
                      {l.description && <p style={{ fontSize: 10, color: T.gray, lineHeight: 1.6, marginBottom: 10 }}>{l.description}</p>}
                      {l.starts_at && notStarted && <div style={{ marginBottom: 10 }}><StartsInCountdown startsAt={l.starts_at} subtitle="STORE SALE OPENS WHEN COUNTDOWN ENDS" /></div>}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                        {l.expires_at && <Countdown expiresAt={l.expires_at} label="ENDS IN" />}
                        {ended && <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", background: `${T.burn}10`, border: `1px solid ${T.burn}30`, borderRadius: 8 }}><span style={{ fontSize: 10 }}>🔴</span><span style={{ fontSize: 10, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", color: T.burn, letterSpacing: 1 }}>ENDED</span></div>}
                        {!ended && !soldOut && !notStarted && <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", background: `${T.success}10`, border: `1px solid ${T.success}30`, borderRadius: 8 }}><span style={{ fontSize: 10 }}>🟢</span><span style={{ fontSize: 10, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", color: T.success, letterSpacing: 1 }}>LIVE</span></div>}
                      </div>
                      {l.is_wl_project && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10, fontSize: 9, fontFamily: "'Share Tech Mono', monospace" }}>
                          <span style={{ padding: "3px 8px", borderRadius: 999, background: `${T.accent}15`, border: `1px solid ${T.accent}40`, color: T.accent, fontWeight: 800 }}>
                            WL • {l.wl_chain || "ETH"}
                          </span>
                          {l.wl_mint_price && (
                            <span style={{ padding: "3px 8px", borderRadius: 999, background: `${T.grayK}30`, border: `1px solid ${T.border}`, color: T.gray }}>
                              Mint: {l.wl_mint_price}
                            </span>
                          )}
                          {typeof l.wl_supply === "number" && (
                            <span style={{ padding: "3px 8px", borderRadius: 999, background: `${T.grayK}30`, border: `1px solid ${T.border}`, color: T.gray }}>
                              Supply: {l.wl_supply}
                            </span>
                          )}
                        </div>
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "10px 0" }}>
                        <div style={{ fontSize: 18, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.cum }}>{l.price_cum} <span style={{ fontSize: 10, opacity: 0.6 }}>$CUM</span></div>
                        <div style={{ textAlign: "right" }}><div style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: l.remaining_spots <= 3 ? T.burn : T.grayD }}>{l.remaining_spots}/{l.total_spots} left</div>{(l.max_per_wallet || 1) > 1 && <div style={{ fontSize: 8, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>max {l.max_per_wallet}/wallet</div>}</div>
                      </div>
                      <div style={{ height: 3, background: T.grayK, borderRadius: 2, marginBottom: 12, overflow: "hidden" }}><div style={{ height: "100%", width: `${((l.total_spots - l.remaining_spots) / l.total_spots) * 100}%`, background: l.remaining_spots <= 3 ? T.burn : T.accent, borderRadius: 2 }} /></div>
                      {buyingId === l.id ? (
                        <div>
                          <label style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>WL WALLET ADDRESS</label>
                          <input
                            type="text"
                            placeholder={l.is_wl_project ? (l.wl_chain === "SOL" ? "Solana address" : l.wl_chain === "BTC" ? "bc1..." : "0x...") : "0x..."}
                            value={wlWalletInput}
                            onChange={e => setWlWalletInput(e.target.value)}
                            style={{ ...inputStyle, marginBottom: 8, marginTop: 4 }}
                          />
                          {isConnected && <button onClick={() => setWlWalletInput(address!)} style={{ background: "none", border: "none", color: T.accent, fontSize: 8, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer", padding: 0, marginBottom: 8 }}>↑ Use connected wallet</button>}
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => handleBuy(l)} disabled={staking || !wlWalletInput} style={{ flex: 1, background: T.cum, color: T.bg, border: "none", borderRadius: 8, padding: "8px", fontSize: 11, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer" }}>CONFIRM</button>
                            <button onClick={() => { setBuyingId(null); setWlWalletInput(""); }} style={{ background: T.grayK, color: T.white, border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 11, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer" }}>✕</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { if (!isConnected) { showMsg("Connect wallet first", "err"); return; } if (notStarted) { showMsg("Sale has not started yet", "err"); return; } if (ended) { showMsg("Sale has ended", "err"); return; } if (cumBalance < l.price_cum) { showMsg(`Need ${l.price_cum} $CUM`, "err"); return; } setBuyingId(l.id); }} disabled={buyDisabled} style={{ width: "100%", background: buyDisabled ? T.grayK : T.accent, color: T.bg, border: "none", borderRadius: 8, padding: "10px", fontSize: 12, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 1, cursor: buyDisabled ? "not-allowed" : "pointer" }}>{notStarted ? "COMING SOON" : ended ? "ENDED" : soldOut ? "SOLD OUT" : "BUY WL SPOT"}</button>
                      )}
                    </div>
                  </div>
                );})}
              </div>
            )}
            {myPurchases.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <h3 style={{ fontSize: 13, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.white, letterSpacing: 2, marginBottom: 10 }}>YOUR PURCHASES</h3>
                <div style={PS}>{myPurchases.map((p, i) => (<div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < myPurchases.length - 1 ? `1px solid ${T.border}` : "none", fontSize: 10, fontFamily: "'Share Tech Mono', monospace", flexWrap: "wrap", gap: 6 }}><span style={{ color: T.white, fontWeight: 700 }}>{(p as any).store_listings?.title || `#${p.listing_id}`}</span><span style={{ color: T.grayD }}>WL: {shortAddr(p.wl_wallet)}</span><span style={{ color: T.cum, fontWeight: 700 }}>{p.cum_spent} $CUM</span></div>))}</div>
              </div>
            )}
          </>
        )}

        {/* ═══════════════ BURN TAB ═══════════════ */}
        {tab === "burn" && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 2, color: T.white, marginBottom: 6 }}>🔥 BURN REWARDS</h2>
            <p style={{ fontSize: 11, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginBottom: 16 }}>Burn Cambrilios permanently for exclusive rewards. Supports bulk transfers.</p>
            <div style={{ ...PS, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>BURN ADDRESS:</span>
              <code style={{ fontSize: 11, fontFamily: "'Share Tech Mono', monospace", color: T.burn, background: `${T.burn}10`, padding: "3px 8px", borderRadius: 6, border: `1px solid ${T.burn}20`, wordBreak: "break-all" }}>0x000000000000000000000000000000000000dEaD</code>
              <button onClick={() => navigator.clipboard.writeText("0x000000000000000000000000000000000000dEaD")} style={{ background: `${T.burn}15`, border: `1px solid ${T.burn}30`, borderRadius: 6, padding: "3px 8px", color: T.burn, fontSize: 8, fontFamily: "'Share Tech Mono', monospace", fontWeight: 700, cursor: "pointer" }}>COPY</button>
            </div>
            {burnRewards.filter(r => r.is_active).length === 0 ? (
              <div style={{ textAlign: "center", padding: 60 }}><div style={{ fontSize: 36 }}>🔮</div><div style={{ fontSize: 16, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.accent, letterSpacing: 2, marginTop: 10 }}>SOONBRIA!</div></div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
                {burnRewards.filter(r => r.is_active).map(reward => {
                  const isActive = activeBurnId === reward.id;
                  const myClaim = burnClaims.find(c => c.reward_id === reward.id);
                  const txInputs = burnTxInputs[reward.id] || [""];
                  const isSoldOut = reward.remaining_supply <= 0;
                  const isClaimed = !!myClaim;
                  const notStarted = reward.starts_at ? (() => { const d = parseLocalTimestamp(reward.starts_at!); return d ? d.getTime() > Date.now() : false; })() : false;
                  const isRewardExpired = isExpired(reward.expires_at);
                  const isEnded = isSoldOut || isRewardExpired;
                  return (
                    <div key={reward.id} style={{ background: T.card, border: `1px solid ${isClaimed ? T.success + "40" : T.border}`, borderRadius: 14, overflow: "hidden" }}>
                      {reward.image_url && <img src={reward.image_url} alt={reward.title} style={{ width: "100%", height: "auto", maxHeight: 1000, objectFit: "contain" }} />}
                      <div style={{ padding: 16 }}>
                        <h3 style={{ fontSize: 15, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.white, marginBottom: 6 }}>{reward.title}</h3>
                        {reward.description && <p style={{ fontSize: 10, color: T.gray, lineHeight: 1.6, marginBottom: 10 }}>{reward.description}</p>}
                        {reward.starts_at && notStarted && <div style={{ marginBottom: 10 }}><StartsInCountdown startsAt={reward.starts_at} /></div>}
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                          {reward.expires_at && <Countdown expiresAt={reward.expires_at} label="ENDS IN" />}
                          {isEnded && <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", background: `${T.burn}10`, border: `1px solid ${T.burn}30`, borderRadius: 8 }}><span style={{ fontSize: 10 }}>🔴</span><span style={{ fontSize: 10, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", color: T.burn, letterSpacing: 1 }}>ENDED</span></div>}
                          {!isEnded && reward.starts_at && !notStarted && <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", background: `${T.success}10`, border: `1px solid ${T.success}30`, borderRadius: 8 }}><span style={{ fontSize: 10 }}>🟢</span><span style={{ fontSize: 10, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", color: T.success, letterSpacing: 1 }}>LIVE</span></div>}
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                          <div><div style={{ fontSize: 8, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>BURN COST</div><div style={{ fontSize: 20, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.burn }}>{reward.burn_cost} <span style={{ fontSize: 10, opacity: 0.7 }}>NFTs</span></div></div>
                          <div style={{ textAlign: "right" }}><div style={{ fontSize: 8, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>AVAILABLE</div><div style={{ fontSize: 14, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: reward.remaining_supply <= 1 ? T.burn : T.accent }}>{reward.remaining_supply}/{reward.total_supply}</div></div>
                        </div>
                        <div style={{ height: 3, background: T.grayK, borderRadius: 2, marginBottom: 14, overflow: "hidden" }}><div style={{ height: "100%", width: `${((reward.total_supply - reward.remaining_supply) / reward.total_supply) * 100}%`, background: reward.remaining_supply <= 1 ? T.burn : T.accent, borderRadius: 2 }} /></div>
                        {isClaimed && <div style={{ padding: "8px 12px", borderRadius: 8, marginBottom: 10, background: myClaim.status === "delivered" ? `${T.success}15` : `${T.sweep}15`, border: `1px solid ${myClaim.status === "delivered" ? T.success : T.sweep}30` }}><div style={{ fontSize: 10, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", color: myClaim.status === "delivered" ? T.success : T.sweep }}>{myClaim.status === "delivered" ? "✅ DELIVERED" : "⏳ AWAITING DELIVERY"}</div><div style={{ fontSize: 8, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginTop: 3 }}>Burned: {myClaim.token_ids.map(id => `#${id}`).join(", ")}</div></div>}
                        {!isClaimed && !isEnded && isConnected && !notStarted && (
                          isActive ? (
                            <div>
                              <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.gray, marginBottom: 8, padding: "6px 8px", background: T.bgS, borderRadius: 6, border: `1px solid ${T.border}`, lineHeight: 1.7 }}>1. Transfer {reward.burn_cost} NFTs to <span style={{ color: T.burn }}>0x...dEaD</span><br />2. Paste TX hash(es) below (bulk OK)</div>
                              {txInputs.map((val, i) => (
                                <div key={i} style={{ display: "flex", gap: 4, marginBottom: 4, alignItems: "center" }}>
                                  <input type="text" placeholder={`0x... (TX #${i + 1})`} value={val} onChange={e => updateBurnTxInput(reward.id, i, e.target.value)} style={{ ...inputStyle, border: `1px solid ${val && val.startsWith("0x") && val.length === 66 ? T.success + "40" : T.border}` }} />
                                  {txInputs.length > 1 && <button onClick={() => removeTxField(reward.id, i)} style={{ background: `${T.burn}15`, border: `1px solid ${T.burn}30`, borderRadius: 6, padding: "6px 8px", color: T.burn, fontSize: 10, cursor: "pointer", fontFamily: "'Share Tech Mono', monospace" }}>✕</button>}
                                </div>
                              ))}
                              <button onClick={() => addTxField(reward.id)} style={{ background: "none", border: `1px dashed ${T.border}`, borderRadius: 6, padding: "5px", width: "100%", color: T.grayD, fontSize: 8, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer", marginBottom: 10 }}>+ Add TX hash</button>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button onClick={() => handleBurnSubmit(reward.id)} disabled={submittingBurn} style={{ flex: 1, background: T.burn, color: T.white, border: "none", borderRadius: 8, padding: "9px", fontSize: 11, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer", opacity: submittingBurn ? 0.6 : 1 }}>{submittingBurn ? "VERIFYING..." : "🔥 SUBMIT PROOF"}</button>
                                <button onClick={() => setActiveBurnId(null)} style={{ background: T.grayK, color: T.white, border: "none", borderRadius: 8, padding: "9px 14px", fontSize: 11, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer" }}>✕</button>
                              </div>
                            </div>
                          ) : (
                            <button onClick={() => { setActiveBurnId(reward.id); setBurnTxInputs(p => ({ ...p, [reward.id]: p[reward.id] || [""] })); }} style={{ width: "100%", background: `${T.burn}15`, border: `1px solid ${T.burn}40`, borderRadius: 8, padding: "10px", fontSize: 12, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.burn, cursor: "pointer", letterSpacing: 1 }}>🔥 BURN {reward.burn_cost} NFTs TO CLAIM</button>
                          )
                        )}
                        {!isConnected && !isSoldOut && !isClaimed && !notStarted && <div style={{ textAlign: "center", padding: 8, fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>Connect wallet to claim</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ═══════════════ DASHBOARD TAB ═══════════════ */}
        {tab === "dashboard" && (
          <>
            {/* Sub-tab toggle */}
            <div style={{ display: "flex", gap: 2, marginBottom: 24, background: T.bgS, border: `1px solid ${T.border}`, borderRadius: 6, padding: 4, width: "fit-content" }}>
              {(["stake", "bet"] as const).map(t => (
                <button key={t} onClick={() => setDashSubTab(t)} style={{ background: dashSubTab === t ? T.accent : "transparent", color: dashSubTab === t ? T.bg : T.grayD, border: "none", borderRadius: 4, padding: "8px 22px", fontSize: 10, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 2, cursor: "pointer", transition: "all 0.2s" }}>
                  {t === "stake" ? "▸ STAKE" : "🎰 BET"}
                </button>
              ))}
            </div>

            {/* ── STAKE LEADERBOARD ── */}
            {dashSubTab === "stake" && (
              <>
                <h2 style={{ fontSize: 18, fontWeight: 900, fontFamily: "'Orbitron', sans-serif", letterSpacing: 2, color: T.white, marginBottom: 6 }}>STAKING LEADERBOARD</h2>
                <p style={{ fontSize: 11, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginBottom: 20 }}>More staked = more $CUM/day</p>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20, padding: "14px 16px", background: T.bgS, border: `1px solid ${T.border}`, borderRadius: 6 }}>
                  {[{ label: "STAKERS", value: globalStats.totalStakers, color: T.white }, { label: "NFTs STAKED", value: globalStats.totalNFTsStaked, color: T.accent }, { label: "$CUM/DAY", value: globalStats.totalNFTsStaked, color: T.cum }].map((s, i) => (
                    <div key={i}><div style={{ fontSize: 8, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, letterSpacing: 1.5, fontWeight: 700 }}>{s.label}</div><div style={{ fontSize: 20, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: s.color }}>{s.value}</div></div>
                  ))}
                </div>
                {leaderboard.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 60 }}><div style={{ fontSize: 36 }}>🔮</div><div style={{ fontSize: 16, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.accent, letterSpacing: 2, marginTop: 10 }}>SOONBRIA!</div></div>
                ) : (
                  <div style={{ background: T.bgS, border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "40px 1fr 70px 70px", padding: "10px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 8, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, letterSpacing: 1.5, fontWeight: 700 }}><span>#</span><span>WALLET</span><span style={{ textAlign: "right" }}>STAKED</span><span style={{ textAlign: "right" }}>$CUM/D</span></div>
                    {leaderboard.map((e, i) => { const isMe = address && e.wallet.toLowerCase() === address.toLowerCase(); return (
                      <div key={e.wallet} style={{ display: "grid", gridTemplateColumns: "40px 1fr 70px 70px", padding: "10px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontFamily: "'Share Tech Mono', monospace", background: isMe ? `${T.accent}08` : "transparent" }}>
                        <span style={{ fontWeight: 900, color: i === 0 ? T.gold : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : T.grayD }}>{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</span>
                        <span style={{ color: isMe ? T.accent : T.white, wordBreak: "break-all" }}>{shortAddr(e.wallet)} {isMe && <span style={{ color: T.accent, fontSize: 8 }}>YOU</span>}</span>
                        <span style={{ textAlign: "right", color: T.sweep, fontWeight: 700 }}>{e.staked}</span>
                        <span style={{ textAlign: "right", color: T.cum, fontWeight: 700 }}>{e.staked}</span>
                      </div>
                    ); })}
                  </div>
                )}
              </>
            )}

            {/* ── BET LEADERBOARD ── */}
            {dashSubTab === "bet" && (
              <>
                <h2 style={{ fontSize: 18, fontWeight: 900, fontFamily: "'Orbitron', sans-serif", letterSpacing: 2, color: T.white, marginBottom: 6 }}>BET LEADERBOARD</h2>
                <p style={{ fontSize: 11, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginBottom: 20 }}>Ranked by net NFT PNL across all completed flips</p>
                {loadingBetLeader ? (
                  <div style={{ textAlign: "center", padding: 60, fontSize: 11, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>⏳ Loading...</div>
                ) : betLeaderboard.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 60 }}><div style={{ fontSize: 36 }}>🎰</div><div style={{ fontSize: 14, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginTop: 10 }}>No completed bets yet</div></div>
                ) : (
                  <div style={{ background: T.bgS, border: `1px solid ${T.border}`, borderRadius: 6, overflow: "auto" }}>
                    {/* Header */}
                    <div style={{ display: "grid", gridTemplateColumns: "36px 1fr 60px 56px 70px 90px 100px 80px", padding: "10px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 8, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, letterSpacing: 1.5, fontWeight: 700, minWidth: 640 }}>
                      <span>#</span><span>WALLET</span><span style={{ textAlign: "right" }}>BETS</span><span style={{ textAlign: "right" }}>W/L</span><span style={{ textAlign: "right" }}>WIN%</span><span style={{ textAlign: "right" }}>NET NFTs</span><span style={{ textAlign: "right" }}>NET ETH</span>{isAdmin && <span style={{ textAlign: "center" }}>CARD</span>}
                    </div>
                    {betLeaderboard.map((e, i) => {
                      const isMe = address && e.wallet.toLowerCase() === address.toLowerCase();
                      const nftColor = e.netNfts >= 0 ? T.success : T.burn;
                      const ethColor = e.netEth >= 0 ? T.success : T.burn;
                      return (
                        <div key={e.wallet} style={{ display: "grid", gridTemplateColumns: "36px 1fr 60px 56px 70px 90px 100px 80px", padding: "10px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontFamily: "'Share Tech Mono', monospace", background: isMe ? `${T.accent}08` : "transparent", alignItems: "center", minWidth: 640 }}>
                          <span style={{ fontWeight: 900, color: i === 0 ? T.gold : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : T.grayD }}>{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</span>
                          <span style={{ color: isMe ? T.accent : T.white }}>{shortAddr(e.wallet)} {isMe && <span style={{ color: T.accent, fontSize: 8 }}>YOU</span>}</span>
                          <span style={{ textAlign: "right", color: T.gray }}>{e.totalBets}</span>
                          <span style={{ textAlign: "right", color: T.gray }}>{e.wins}/{e.losses}</span>
                          <span style={{ textAlign: "right", color: e.winRate >= 50 ? T.accent : T.burn, fontWeight: 700 }}>{e.winRate}%</span>
                          <span style={{ textAlign: "right", color: nftColor, fontWeight: 700 }}>{e.netNfts >= 0 ? "+" : ""}{e.netNfts} NFT</span>
                          <span style={{ textAlign: "right", color: ethColor, fontWeight: 700 }}>{e.netEth >= 0 ? "+" : ""}{e.netEth.toFixed(4)} ETH</span>
                          {isAdmin && (
                            <span style={{ textAlign: "center" }}>
                              <button onClick={() => generateBetPNLCard(e)} style={{ background: `${T.accent}15`, border: `1px solid ${T.accent}40`, borderRadius: 4, padding: "4px 10px", fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.accent, cursor: "pointer", letterSpacing: 1 }}>🖨 CARD</button>
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ═══════════════ ADMIN TAB ═══════════════ */}
        {tab === "admin" && isAdmin && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 2, color: T.white, marginBottom: 20 }}>ADMIN PANEL</h2>

            {/* Stake toggle */}
            <div style={{ ...PS, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div><div style={{ fontSize: 12, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", color: T.white }}>STAKING</div><div style={{ fontSize: 9, color: T.grayD, fontFamily: "'Share Tech Mono', monospace" }}>Enable or disable new stakes</div></div>
              <button onClick={toggleStakeEnabled} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: stakeEnabled ? T.success : T.burn, color: T.bg, fontSize: 11, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer", letterSpacing: 1 }}>{stakeEnabled ? "ON ✓" : "OFF ✕"}</button>
            </div>

            {/* Transfer toggle */}
            <div style={{ ...PS, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div><div style={{ fontSize: 12, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", color: T.white }}>$CUM TRANSFER</div><div style={{ fontSize: 9, color: T.grayD, fontFamily: "'Share Tech Mono', monospace" }}>Enable or disable $CUM transfers between wallets</div></div>
              <button onClick={toggleTransferEnabled} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: transferEnabled ? T.success : T.burn, color: T.bg, fontSize: 11, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer", letterSpacing: 1 }}>{transferEnabled ? "ON ✓" : "OFF ✕"}</button>
            </div>

            {/* Bet toggle */}
            <div style={{ ...PS, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div><div style={{ fontSize: 12, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", color: T.white }}>BET TAB</div><div style={{ fontSize: 9, color: T.grayD, fontFamily: "'Share Tech Mono', monospace" }}>Disable during contract updates or maintenance</div></div>
              <button onClick={toggleBetEnabled} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: betEnabled ? T.success : T.burn, color: T.bg, fontSize: 11, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer", letterSpacing: 1 }}>{betEnabled ? "ON ✓" : "OFF ✕"}</button>
            </div>

            {/* Recover stakes (after broken API key) */}
            <div style={{ ...PS, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, border: `1px solid ${T.burn}40` }}>
              <div><div style={{ fontSize: 12, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", color: T.burn }}>RECOVERY DE STAKES</div><div style={{ fontSize: 9, color: T.grayD, fontFamily: "'Share Tech Mono', monospace" }}>Restaura stakes removidas por API key quebrada e re-verifica ownership</div></div>
              <button onClick={handleRecoverStakes} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: T.burn, color: T.white, fontSize: 11, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer", letterSpacing: 1 }}>RECUPERAR</button>
            </div>

            {/* Create store listing */}
            <div style={PS}>
              <h3 style={{ fontSize: 13, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", color: T.accent, letterSpacing: 2, marginBottom: 12 }}>CREATE STORE LISTING</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><label style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>TITLE *</label><input value={newListing.title} onChange={e => setNewListing(p => ({ ...p, title: e.target.value }))} style={inputStyle} placeholder="Project WL" /></div>
                <div><label style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>PROJECT URL</label><input value={newListing.projectUrl} onChange={e => setNewListing(p => ({ ...p, projectUrl: e.target.value }))} style={inputStyle} placeholder="https://..." /></div>
                <div style={{ gridColumn: "1 / -1" }}><label style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>DESCRIPTION</label><input value={newListing.description} onChange={e => setNewListing(p => ({ ...p, description: e.target.value }))} style={inputStyle} /></div>
                <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    id="is-wl-project"
                    type="checkbox"
                    checked={newListing.isWlProject}
                    onChange={e => setNewListing(p => ({ ...p, isWlProject: e.target.checked }))}
                    style={{ width: 14, height: 14, cursor: "pointer" }}
                  />
                  <label htmlFor="is-wl-project" style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, cursor: "pointer" }}>
                    Listing é WL de projeto (BTC Ordinals / SOL / ETH)
                  </label>
                </div>
                {newListing.isWlProject && (
                  <>
                    <div><label style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>MINT PRICE</label><input value={newListing.wlMintPrice} onChange={e => setNewListing(p => ({ ...p, wlMintPrice: e.target.value }))} style={inputStyle} placeholder="ex: 0.1 ETH" /></div>
                    <div>
                      <label style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>CHAIN *</label>
                      <select
                        value={newListing.wlChain}
                        onChange={e => setNewListing(p => ({ ...p, wlChain: e.target.value as "BTC" | "SOL" | "ETH" }))}
                        style={{ ...inputStyle, paddingRight: 24 }}
                      >
                        <option value="ETH">ETH</option>
                        <option value="SOL">SOL</option>
                        <option value="BTC">BTC (Ordinals)</option>
                      </select>
                    </div>
                    <div><label style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>SUPPLY</label><input type="number" value={newListing.wlSupply} onChange={e => setNewListing(p => ({ ...p, wlSupply: e.target.value }))} style={inputStyle} placeholder="ex: 555" /></div>
                    <div style={{ gridColumn: "1 / -1" }}><label style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>WL DESCRIPTION</label><input value={newListing.wlDescription} onChange={e => setNewListing(p => ({ ...p, wlDescription: e.target.value }))} style={inputStyle} placeholder="Details about WL / mint mechanics" /></div>
                  </>
                )}
                <div><label style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>IMAGE URL</label><input value={newListing.imageUrl} onChange={e => setNewListing(p => ({ ...p, imageUrl: e.target.value }))} style={inputStyle} /></div>
                <div><label style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>STARTS AT (countdown to open)</label><input type="datetime-local" value={newListing.startsAt} onChange={e => setNewListing(p => ({ ...p, startsAt: e.target.value }))} style={inputStyle} /></div>
                <div><label style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>EXPIRES AT</label><input type="datetime-local" value={newListing.expiresAt} onChange={e => setNewListing(p => ({ ...p, expiresAt: e.target.value }))} style={inputStyle} /></div>
                <div><label style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>PRICE ($CUM) *</label><input type="number" value={newListing.priceCum} onChange={e => setNewListing(p => ({ ...p, priceCum: e.target.value }))} style={inputStyle} /></div>
                <div><label style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>SPOTS *</label><input type="number" value={newListing.totalSpots} onChange={e => setNewListing(p => ({ ...p, totalSpots: e.target.value }))} style={inputStyle} /></div>
                <div><label style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>MAX PER WALLET</label><input type="number" min="1" value={newListing.maxPerWallet} onChange={e => setNewListing(p => ({ ...p, maxPerWallet: e.target.value }))} style={inputStyle} placeholder="1" /></div>
              </div>
              <button onClick={handleCreateListing} disabled={!newListing.title} style={{ marginTop: 12, background: T.accent, color: T.bg, border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 11, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer" }}>CREATE LISTING</button>
            </div>

            {/* Manage store listings */}
            {adminData?.listings?.length > 0 && (
              <div style={PS}>
                <h3 style={{ fontSize: 13, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", color: T.white, letterSpacing: 2, marginBottom: 12 }}>STORE LISTINGS</h3>
                {adminData.listings.map((l: any) => (
                  <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${T.border}`, fontSize: 10, fontFamily: "'Share Tech Mono', monospace", flexWrap: "wrap", gap: 6 }}>
                    <div><span style={{ color: T.white, fontWeight: 700 }}>{l.title}</span>{!l.is_active && <span style={{ color: T.burn, fontSize: 8, marginLeft: 6 }}>(OFF)</span>}<div style={{ fontSize: 8, color: T.grayD }}>Price: {l.price_cum} $CUM • {l.remaining_spots}/{l.total_spots} left • Max/wallet: {l.max_per_wallet || 1}</div></div>
                    {l.is_active && <button onClick={() => handleDeleteListing(l.id, l.title)} style={{ background: `${T.burn}15`, border: `1px solid ${T.burn}40`, borderRadius: 6, padding: "4px 10px", color: T.burn, fontSize: 8, fontFamily: "'Share Tech Mono', monospace", fontWeight: 700, cursor: "pointer" }}>🗑 DELETE</button>}
                  </div>
                ))}
              </div>
            )}

            {/* Create burn reward */}
            <div style={PS}>
              <h3 style={{ fontSize: 13, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", color: T.burn, letterSpacing: 2, marginBottom: 12 }}>🔥 CREATE BURN REWARD</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><label style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>TITLE *</label><input value={newBurnReward.title} onChange={e => setNewBurnReward(p => ({ ...p, title: e.target.value }))} style={inputStyle} placeholder="White Party Hat 1/1" /></div>
                <div><label style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>IMAGE URL</label><input value={newBurnReward.imageUrl} onChange={e => setNewBurnReward(p => ({ ...p, imageUrl: e.target.value }))} style={inputStyle} /></div>
                <div style={{ gridColumn: "1 / -1" }}><label style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>DESCRIPTION</label><input value={newBurnReward.description} onChange={e => setNewBurnReward(p => ({ ...p, description: e.target.value }))} style={inputStyle} /></div>
                <div><label style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>STARTS AT (countdown to open)</label><input type="datetime-local" value={newBurnReward.startsAt} onChange={e => setNewBurnReward(p => ({ ...p, startsAt: e.target.value }))} style={inputStyle} /></div>
                <div><label style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>EXPIRES AT</label><input type="datetime-local" value={newBurnReward.expiresAt} onChange={e => setNewBurnReward(p => ({ ...p, expiresAt: e.target.value }))} style={inputStyle} /></div>
                <div><label style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>BURN COST (NFTs) *</label><input type="number" value={newBurnReward.burnCost} onChange={e => setNewBurnReward(p => ({ ...p, burnCost: e.target.value }))} style={inputStyle} /></div>
                <div><label style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>SUPPLY *</label><input type="number" value={newBurnReward.totalSupply} onChange={e => setNewBurnReward(p => ({ ...p, totalSupply: e.target.value }))} style={inputStyle} /></div>
              </div>
              <button onClick={handleCreateBurnReward} disabled={!newBurnReward.title} style={{ marginTop: 12, background: T.burn, color: T.white, border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 11, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer" }}>🔥 CREATE BURN REWARD</button>
            </div>

            {/* Manage burn rewards */}
            {burnRewards.length > 0 && (
              <div style={PS}>
                <h3 style={{ fontSize: 13, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", color: T.white, letterSpacing: 2, marginBottom: 12 }}>BURN REWARDS</h3>
                {burnRewards.map(r => (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${T.border}`, fontSize: 10, fontFamily: "'Share Tech Mono', monospace", flexWrap: "wrap", gap: 6 }}>
                    <div><span style={{ color: T.white, fontWeight: 700 }}>{r.title}</span>{!r.is_active && <span style={{ color: T.burn, fontSize: 8, marginLeft: 6 }}>(OFF)</span>}<div style={{ fontSize: 8, color: T.grayD }}>Cost: {r.burn_cost} NFTs • {r.remaining_supply}/{r.total_supply} left</div></div>
                    {r.is_active && <button onClick={() => handleDeleteBurnReward(r.id, r.title)} style={{ background: `${T.burn}15`, border: `1px solid ${T.burn}40`, borderRadius: 6, padding: "4px 10px", color: T.burn, fontSize: 8, fontFamily: "'Share Tech Mono', monospace", fontWeight: 700, cursor: "pointer" }}>🗑 DELETE</button>}
                  </div>
                ))}
              </div>
            )}

            {/* All burn claims */}
            {allBurnClaims.length > 0 && (
              <div style={PS}>
                <h3 style={{ fontSize: 13, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", color: T.white, letterSpacing: 2, marginBottom: 12 }}>BURN CLAIMS ({allBurnClaims.length})</h3>
                {allBurnClaims.map(claim => (
                  <div key={claim.id} style={{ padding: "12px 0", borderBottom: `1px solid ${T.border}`, fontSize: 10, fontFamily: "'Share Tech Mono', monospace" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexWrap: "wrap", gap: 6 }}>
                      <span style={{ color: T.white, fontWeight: 700 }}>{(claim as any).burn_rewards?.title || `#${claim.reward_id}`}</span>
                      <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 8, fontWeight: 800, background: claim.status === "delivered" ? `${T.success}20` : claim.status === "rejected" ? `${T.burn}20` : `${T.sweep}20`, color: claim.status === "delivered" ? T.success : claim.status === "rejected" ? T.burn : T.sweep }}>{claim.status.toUpperCase()}</span>
                    </div>
                    <div style={{ fontSize: 8, color: T.grayD }}>Wallet: <span style={{ color: T.accent }}>{claim.wallet_address}</span> <button onClick={() => navigator.clipboard.writeText(claim.wallet_address)} style={{ background: "none", border: "none", color: T.grayD, fontSize: 8, cursor: "pointer" }}>📋</button></div>
                    <div style={{ fontSize: 8, color: T.grayD }}>Burned: {claim.token_ids.map(id => `#${id}`).join(", ")}</div>
                    <div style={{ fontSize: 8, color: T.grayD }}>TXs: {claim.tx_hashes.map(h => <a key={h} href={`https://basescan.org/tx/${h}`} target="_blank" rel="noopener noreferrer" style={{ color: T.sweep, marginRight: 6 }}>{h.slice(0, 12)}...↗</a>)}</div>
                    {(claim.status === "verified" || claim.status === "pending") && (
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <button onClick={() => handleUpdateBurnClaim(claim.id, "delivered")} style={{ background: `${T.success}15`, border: `1px solid ${T.success}40`, borderRadius: 6, padding: "4px 10px", color: T.success, fontSize: 8, fontFamily: "'Share Tech Mono', monospace", fontWeight: 700, cursor: "pointer" }}>✅ DELIVERED</button>
                        <button onClick={() => handleUpdateBurnClaim(claim.id, "rejected")} style={{ background: `${T.burn}15`, border: `1px solid ${T.burn}40`, borderRadius: 6, padding: "4px 10px", color: T.burn, fontSize: 8, fontFamily: "'Share Tech Mono', monospace", fontWeight: 700, cursor: "pointer" }}>❌ REJECT</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* WL Export */}
            {adminData?.purchases?.length > 0 && (
              <div style={PS}>
                <h3 style={{ fontSize: 13, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", color: T.white, letterSpacing: 2, marginBottom: 12 }}>WL PURCHASES ({adminData.purchases.length})</h3>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "'Share Tech Mono', monospace" }}>
                    <thead><tr style={{ borderBottom: `1px solid ${T.border}` }}><th style={{ textAlign: "left", padding: 6, color: T.grayD, fontWeight: 700 }}>LISTING</th><th style={{ textAlign: "left", padding: 6, color: T.grayD, fontWeight: 700 }}>WL WALLET</th><th style={{ textAlign: "right", padding: 6, color: T.grayD, fontWeight: 700 }}>$CUM</th></tr></thead>
                    <tbody>{adminData.purchases.map((p: any) => (<tr key={p.id} style={{ borderBottom: `1px solid ${T.border}` }}><td style={{ padding: 6, color: T.white }}>{p.store_listings?.title || p.listing_id}</td><td style={{ padding: 6, color: T.accent, fontWeight: 700, wordBreak: "break-all" }}>{p.wl_wallet}</td><td style={{ padding: 6, color: T.cum, textAlign: "right" }}>{p.cum_spent}</td></tr>))}</tbody>
                  </table>
                </div>
                <button onClick={() => { const csv = "Listing,Buyer,WL Wallet,$CUM,Date\n" + adminData.purchases.map((p: any) => `"${p.store_listings?.title || p.listing_id}","${p.buyer_wallet}","${p.wl_wallet}",${p.cum_spent},"${new Date(p.purchased_at).toISOString()}"`).join("\n"); const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "cambrilio-wl-export.csv"; a.click(); }} style={{ marginTop: 10, background: `${T.accent}15`, border: `1px solid ${T.accent}40`, borderRadius: 6, padding: "6px 14px", color: T.accent, fontSize: 9, fontFamily: "'Share Tech Mono', monospace", fontWeight: 700, cursor: "pointer" }}>📥 EXPORT CSV</button>
              </div>
            )}
          </>
        )}

        {/* ═══════════════ BET TAB ═══════════════ */}
        {tab === "bet" && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 2, color: T.white, marginBottom: 4 }}>CAMBRILIO BET</h2>
            <p style={{ fontSize: 11, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginBottom: 20 }}>Wager your NFTs in a peer-to-peer coin flip. Winner takes all.</p>

            {!betEnabled && !isAdmin ? (
              <div style={{ textAlign: "center", padding: "60px 16px" }}>
                <div style={{ fontSize: 36, marginBottom: 16 }}>🔧</div>
                <div style={{ fontSize: 16, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.burn, letterSpacing: 2, marginBottom: 8 }}>MAINTENANCE</div>
                <div style={{ fontSize: 12, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, maxWidth: 360, margin: "0 auto" }}>The Bet tab is temporarily disabled for contract updates. Check back soon.</div>
              </div>
            ) : !isConnected ? (
              <div style={{ textAlign: "center", padding: 60 }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🎰</div>
                <div style={{ fontSize: 13, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, letterSpacing: 2 }}>CONNECT YOUR WALLET TO PLAY</div>
              </div>
            ) : (
              <>
                {/* ── COIN FLIP OVERLAY ── */}
                {coinPhase !== "idle" && (
                  <div className="overlay-fade" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 9999, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", backdropFilter: "blur(6px)" }}>

                    {/* Coin 3D */}
                    <div style={{ perspective: "700px", marginBottom: 36 }}>
                      <div
                        className={
                          coinPhase === "spinning" ? "coin-spin-loop" :
                          flipResult?.result === "heads" ? "coin-land-heads" : "coin-land-tails"
                        }
                        style={{ width: 140, height: 140, position: "relative", transformStyle: "preserve-3d" }}
                      >
                        {/* HEADS face */}
                        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "linear-gradient(135deg, #FFD700, #FFA500)", backfaceVisibility: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 64, boxShadow: "0 0 32px rgba(255,215,0,0.5)" }}>
                          👑
                        </div>
                        {/* TAILS face */}
                        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "linear-gradient(135deg, #7B6CD8, #3d2fa0)", backfaceVisibility: "hidden", transform: "rotateY(180deg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 64, boxShadow: "0 0 32px rgba(123,108,216,0.5)" }}>
                          🌀
                        </div>
                      </div>
                    </div>

                    {coinPhase === "spinning" && (
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 14, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.white, letterSpacing: 2, marginBottom: 8 }}>FLIPPING...</div>
                        <div style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>Verifying on Chainlink VRF</div>
                      </div>
                    )}

                    {coinPhase === "landed" && flipResult && (
                      <div className="result-pop" style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 52, marginBottom: 10 }}>
                          {flipResult.result === "heads" ? "👑" : "🌀"}
                        </div>
                        <div style={{ fontSize: 11, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, letterSpacing: 2, marginBottom: 8 }}>
                          {flipResult.result.toUpperCase()}
                        </div>
                        <div style={{ fontSize: 28, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 3, color: flipResult.winner.toLowerCase() === address?.toLowerCase() ? T.success : T.burn, marginBottom: 8 }}>
                          {flipResult.winner.toLowerCase() === address?.toLowerCase() ? "YOU WIN!" : "YOU LOSE"}
                        </div>
                        <div style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginBottom: 20 }}>
                          Winner: <span style={{ color: T.accent }}>{shortAddr(flipResult.winner)}</span>
                        </div>
                        <button onClick={() => { setCoinPhase("idle"); setFlipResult(null); }} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 24px", color: T.white, fontSize: 11, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer", letterSpacing: 1 }}>
                          DISMISS
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ── MY ACTIVE ROOM (creator view) ── */}
                {(() => {
                  const myRoom = betRooms.find(r => r.creator_wallet === address?.toLowerCase() || r.challenger_wallet === address?.toLowerCase());
                  if (!myRoom) return null;
                  const isCreator = myRoom.creator_wallet === address?.toLowerCase();
                  return (
                    <div style={{ ...PS, border: `1px solid ${myRoom.status === "active" ? T.accent : T.border}40` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.accent, letterSpacing: 1 }}>YOUR ROOM</div>
                          <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginTop: 2 }}>ROOM #{String(myRoom.id)}</div>
                        </div>
                        <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 9, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", background: myRoom.status === "active" ? `${T.success}20` : myRoom.status === "flipping" ? `${T.sweep}20` : `${T.gold}20`, color: myRoom.status === "active" ? T.success : myRoom.status === "flipping" ? T.sweep : T.gold }}>{myRoom.status === "active" ? "⚡ READY TO FLIP" : myRoom.status === "flipping" ? "🔗 WAITING FOR VRF..." : "⏳ WAITING FOR CHALLENGER"}</span>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "center", marginBottom: 14 }}>
                        {/* Creator side */}
                        <div style={{ background: T.card, borderRadius: 10, padding: 12, border: isCreator ? `1px solid ${T.accent}40` : `1px solid ${T.border}` }}>
                          <div style={{ fontSize: 8, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginBottom: 4 }}>CREATOR {isCreator && <span style={{ color: T.accent }}>· YOU</span>}</div>
                          <div style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: T.white, wordBreak: "break-all" }}>{shortAddr(myRoom.creator_wallet)}</div>
                          <div style={{ fontSize: 9, color: T.accent, fontFamily: "'Share Tech Mono', monospace", marginTop: 4 }}>
                            {myRoom.nft_count} NFT{myRoom.nft_count > 1 ? "s" : ""} · <span style={{ color: myRoom.creator_choice === "heads" ? T.gold : T.sweep }}>{myRoom.creator_choice.toUpperCase()}</span>
                          </div>
                          <div style={{ fontSize: 8, color: T.grayD, fontFamily: "'Share Tech Mono', monospace", marginTop: 2 }}>#{myRoom.creator_nft_ids.join(", #")}</div>
                        </div>

                        <div style={{ fontSize: 18, color: T.burn, fontWeight: 900, textAlign: "center" }}>VS</div>

                        {/* Challenger side */}
                        <div style={{ background: T.card, borderRadius: 10, padding: 12, border: !isCreator ? `1px solid ${T.accent}40` : `1px solid ${T.border}` }}>
                          {myRoom.challenger_wallet ? (
                            <>
                              <div style={{ fontSize: 8, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginBottom: 4 }}>CHALLENGER {!isCreator && <span style={{ color: T.accent }}>· YOU</span>}</div>
                              <div style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: T.white, wordBreak: "break-all" }}>{shortAddr(myRoom.challenger_wallet)}</div>
                              <div style={{ fontSize: 9, color: T.accent, fontFamily: "'Share Tech Mono', monospace", marginTop: 4 }}>{myRoom.nft_count} NFT{myRoom.nft_count > 1 ? "s" : ""}</div>
                              <div style={{ fontSize: 8, color: T.grayD, fontFamily: "'Share Tech Mono', monospace", marginTop: 2 }}>#{myRoom.challenger_nft_ids.join(", #")}</div>
                            </>
                          ) : (
                            <div style={{ textAlign: "center", padding: "8px 0" }}>
                              <div style={{ fontSize: 16 }}>⌛</div>
                              <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginTop: 4 }}>WAITING FOR<br />CHALLENGER</div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {myRoom.status === "active" && (
                          <button
                            onClick={() => handleFlip(myRoom.id)}
                            disabled={flippingBet}
                            style={{ flex: 1, padding: "12px 0", background: flippingBet ? T.grayK : T.accent, border: "none", borderRadius: 10, color: T.bg, fontSize: 13, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 2, cursor: flippingBet ? "not-allowed" : "pointer", transition: "background 0.2s" }}
                          >
                            🪙 FLIP COIN
                          </button>
                        )}
                        {myRoom.status === "flipping" && (
                          <div style={{ flex: 1, padding: "12px 0", background: `${T.sweep}10`, border: `1px solid ${T.sweep}30`, borderRadius: 10, color: T.sweep, fontSize: 11, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 1, textAlign: "center" }}>
                            🔗 CHAINLINK VRF RESOLVING...
                          </div>
                        )}
                        {myRoom.status === "waiting" && isCreator && (
                          <button onClick={() => handleCancelBet(myRoom.id)} style={{ padding: "10px 16px", background: `${T.burn}15`, border: `1px solid ${T.burn}40`, borderRadius: 10, color: T.burn, fontSize: 10, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer" }}>CANCEL</button>
                        )}
                        {(myRoom.status === "active" || myRoom.status === "flipping") &&
                          Number(myRoom.created_at) > 0 &&
                          Date.now() > new Date(myRoom.created_at).getTime() + 24 * 3600 * 1000 && (
                          <button onClick={() => handleRefundExpired(myRoom.id)} style={{ padding: "10px 14px", background: `${T.gold}15`, border: `1px solid ${T.gold}40`, borderRadius: 10, color: T.gold, fontSize: 10, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer" }}>⏰ REFUND EXPIRED</button>
                        )}
                        <button onClick={loadBetRooms} style={{ padding: "10px 14px", background: `${T.accent}10`, border: `1px solid ${T.accent}20`, borderRadius: 10, color: T.accent, fontSize: 10, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer" }}>↻</button>
                      </div>
                    </div>
                  );
                })()}

                {/* ── CREATE BET (only if not already in a room) ── */}
                {!betRooms.find(r => r.creator_wallet === address?.toLowerCase() || r.challenger_wallet === address?.toLowerCase()) && (
                  <div style={PS}>
                    <h3 style={{ fontSize: 12, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.accent, letterSpacing: 2, marginBottom: 14 }}>CREATE BET ROOM</h3>

                    {/* Step 1: choose NFT count */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, letterSpacing: 1, marginBottom: 8 }}>HOW MANY NFTs TO WAGER?</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {([1, 2, 3, "custom"] as const).map(v => (
                          <button key={v} onClick={() => { setBetNftCount(v); setBetSelectedIds(new Set()); }} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${betNftCount === v ? T.accent : T.border}`, background: betNftCount === v ? `${T.accent}15` : T.card, color: betNftCount === v ? T.accent : T.grayD, fontSize: 11, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer" }}>
                            {v === "custom" ? "CUSTOM" : `${v} NFT`}
                          </button>
                        ))}
                      </div>
                      {betNftCount === "custom" && (
                        <input type="number" min={1} max={20} value={betCustomCount} onChange={e => { setBetCustomCount(e.target.value); setBetSelectedIds(new Set()); }} placeholder="Enter amount..." style={{ ...inputStyle, marginTop: 8, width: 160 }} />
                      )}
                    </div>

                    {/* Step 2: choose heads or tails */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, letterSpacing: 1, marginBottom: 8 }}>YOUR CALL</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        {(["heads", "tails"] as const).map(side => (
                          <button key={side} onClick={() => setBetChoice(side)} style={{ padding: "10px 24px", borderRadius: 10, border: `1px solid ${betChoice === side ? T.gold : T.border}`, background: betChoice === side ? `${T.gold}15` : T.card, color: betChoice === side ? T.gold : T.grayD, fontSize: 13, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 1, cursor: "pointer" }}>
                            {side === "heads" ? "👑 HEADS" : "🌀 TAILS"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Step 3: room name */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, letterSpacing: 1, marginBottom: 8 }}>
                        ROOM NAME <span style={{ color: T.grayK }}>(OPTIONAL · MAX 32 CHARS)</span>
                      </div>
                      <input
                        type="text"
                        maxLength={32}
                        value={betRoomName}
                        onChange={e => setBetRoomName(e.target.value)}
                        placeholder="e.g. 3v3 High Stakes"
                        style={inputStyle}
                      />
                    </div>

                    {/* Step 4: optional ETH wager */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, letterSpacing: 1, marginBottom: 8 }}>
                        ETH WAGER <span style={{ color: T.grayK }}>(OPTIONAL)</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          value={betEthAmount}
                          onChange={e => setBetEthAmount(e.target.value)}
                          placeholder="0.00 ETH"
                          style={{ ...inputStyle, width: 160 }}
                        />
                        <span style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>ETH</span>
                      </div>
                      {betEthAmount && parseFloat(betEthAmount) > 0 && (
                        <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayK, marginTop: 4 }}>
                          Challenger must match {betEthAmount} ETH · 5% fee on win
                        </div>
                      )}
                    </div>

                    {/* Step 4: select NFTs */}
                    {resolvedBetCount > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, letterSpacing: 1, marginBottom: 8 }}>
                          SELECT {resolvedBetCount} NFT{resolvedBetCount > 1 ? "s" : ""} TO WAGER
                          <span style={{ marginLeft: 8, color: betSelectedIds.size === resolvedBetCount ? T.success : T.accent }}>{betSelectedIds.size}/{resolvedBetCount} selected</span>
                        </div>
                        {ownedNfts.length === 0 ? (
                          <div style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>No NFTs found in your wallet.</div>
                        ) : (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 260, overflowY: "auto" }}>
                            {ownedNfts.map(nft => {
                              const sel = betSelectedIds.has(nft.tokenId);
                              const locked = betRooms.some(r => [...r.creator_nft_ids, ...r.challenger_nft_ids].includes(nft.tokenId));
                              return (
                                <div
                                  key={nft.tokenId}
                                  onClick={() => {
                                    if (locked) return;
                                    setBetSelectedIds(prev => {
                                      const n = new Set(prev);
                                      if (n.has(nft.tokenId)) { n.delete(nft.tokenId); return n; }
                                      if (n.size >= resolvedBetCount) return prev;
                                      n.add(nft.tokenId); return n;
                                    });
                                  }}
                                  style={{ width: 72, borderRadius: 10, overflow: "hidden", border: `2px solid ${locked ? T.grayK : sel ? T.accent : T.border}`, cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.4 : 1, background: sel ? `${T.accent}10` : T.card, flexShrink: 0 }}
                                >
                                  {nft.image && <img src={nft.image} alt={`#${nft.tokenId}`} style={{ width: "100%", display: "block" }} />}
                                  <div style={{ padding: "3px 4px", textAlign: "center", fontSize: 8, fontFamily: "'Share Tech Mono', monospace", color: sel ? T.accent : T.grayD, fontWeight: 700 }}>#{nft.tokenId}</div>
                                  {locked && <div style={{ padding: "2px 4px", textAlign: "center", fontSize: 7, fontFamily: "'Share Tech Mono', monospace", color: T.burn }}>IN BET</div>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    <button
                      onClick={handleCreateBet}
                      disabled={creatingBet || betSelectedIds.size !== resolvedBetCount || resolvedBetCount === 0}
                      style={{ width: "100%", padding: "12px 0", background: (creatingBet || betSelectedIds.size !== resolvedBetCount || resolvedBetCount === 0) ? T.grayK : T.accent, border: "none", borderRadius: 10, color: T.bg, fontSize: 12, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 2, cursor: (creatingBet || betSelectedIds.size !== resolvedBetCount || resolvedBetCount === 0) ? "not-allowed" : "pointer" }}
                    >
                      {creatingBet ? "CREATING..." : "🎰 CREATE BET ROOM"}
                    </button>
                  </div>
                )}

                {/* ── OPEN LOBBIES ── */}
                <div style={PS}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <h3 style={{ fontSize: 12, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.white, letterSpacing: 2 }}>OPEN LOBBIES</h3>
                    <button onClick={loadBetRooms} style={{ background: `${T.accent}10`, border: `1px solid ${T.accent}20`, borderRadius: 6, padding: "4px 10px", color: T.accent, fontSize: 9, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer" }}>↻ REFRESH</button>
                  </div>

                  {betRooms.filter(r => r.status === "waiting" && r.creator_wallet !== address?.toLowerCase()).length === 0 ? (
                    <div style={{ textAlign: "center", padding: "30px 0", color: T.grayD, fontSize: 11, fontFamily: "'Share Tech Mono', monospace" }}>No open rooms right now. Create one above!</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {betRooms.filter(r => r.status === "waiting" && r.creator_wallet !== address?.toLowerCase()).map(room => (
                        <div key={room.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", color: T.white }}>{room.name || shortAddr(room.creator_wallet)}</div>
                              {room.name && <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>{shortAddr(room.creator_wallet)}</div>}
                              <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginTop: 2 }}>
                                wagering {room.nft_count} NFT{room.nft_count > 1 ? "s" : ""} · #{room.creator_nft_ids.join(", #")}
                                {room.eth_amount > 0n && <span style={{ marginLeft: 6, color: T.accent }}>+ {(Number(room.eth_amount) / 1e18).toFixed(4)} ETH</span>}
                              </div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontSize: 10, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: room.creator_choice === "heads" ? T.gold : T.sweep }}>{room.creator_choice === "heads" ? "👑 HEADS" : "🌀 TAILS"}</div>
                              <div style={{ fontSize: 8, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginTop: 2 }}>{new Date(room.created_at).toLocaleTimeString()}</div>
                            </div>
                          </div>

                          {/* Join UI — inline NFT selector */}
                          {betJoinRoomId === room.id ? (
                            <div>
                              <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginBottom: 8 }}>
                                SELECT {room.nft_count} NFT{room.nft_count > 1 ? "s" : ""} TO MATCH
                                <span style={{ marginLeft: 8, color: betJoinSelectedIds.size === room.nft_count ? T.success : T.accent }}>{betJoinSelectedIds.size}/{room.nft_count}</span>
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 200, overflowY: "auto", marginBottom: 10 }}>
                                {ownedNfts.map(nft => {
                                  const sel = betJoinSelectedIds.has(nft.tokenId);
                                  const locked = betRooms.some(r => [...r.creator_nft_ids, ...r.challenger_nft_ids].includes(nft.tokenId));
                                  return (
                                    <div
                                      key={nft.tokenId}
                                      onClick={() => {
                                        if (locked) return;
                                        setBetJoinSelectedIds(prev => {
                                          const n = new Set(prev);
                                          if (n.has(nft.tokenId)) { n.delete(nft.tokenId); return n; }
                                          if (n.size >= room.nft_count) return prev;
                                          n.add(nft.tokenId); return n;
                                        });
                                      }}
                                      style={{ width: 64, borderRadius: 8, overflow: "hidden", border: `2px solid ${locked ? T.grayK : sel ? T.accent : T.border}`, cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.4 : 1, background: sel ? `${T.accent}10` : T.bgS, flexShrink: 0 }}
                                    >
                                      {nft.image && <img src={nft.image} alt={`#${nft.tokenId}`} style={{ width: "100%", display: "block" }} />}
                                      <div style={{ padding: "2px 3px", textAlign: "center", fontSize: 7, fontFamily: "'Share Tech Mono', monospace", color: sel ? T.accent : T.grayD, fontWeight: 700 }}>#{nft.tokenId}</div>
                                    </div>
                                  );
                                })}
                              </div>
                              <div style={{ display: "flex", gap: 8 }}>
                                <button
                                  onClick={() => handleJoinBet(room.id)}
                                  disabled={joiningBet || betJoinSelectedIds.size !== room.nft_count}
                                  style={{ flex: 1, padding: "10px 0", background: (joiningBet || betJoinSelectedIds.size !== room.nft_count) ? T.grayK : T.accent, border: "none", borderRadius: 8, color: T.bg, fontSize: 11, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", cursor: (joiningBet || betJoinSelectedIds.size !== room.nft_count) ? "not-allowed" : "pointer" }}
                                >
                                  {joiningBet ? "JOINING..." : `CONFIRM JOIN${room.eth_amount > 0n ? ` · ${(Number(room.eth_amount) / 1e18).toFixed(4)} ETH` : ""}`}
                                </button>
                                <button onClick={() => { setBetJoinRoomId(null); setBetJoinSelectedIds(new Set()); }} style={{ padding: "10px 14px", background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, color: T.grayD, fontSize: 10, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer" }}>CANCEL</button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setBetJoinRoomId(room.id); setBetJoinSelectedIds(new Set()); }}
                              disabled={!!betRooms.find(r => r.creator_wallet === address?.toLowerCase() || r.challenger_wallet === address?.toLowerCase())}
                              style={{ width: "100%", padding: "9px 0", background: betRooms.find(r => r.creator_wallet === address?.toLowerCase() || r.challenger_wallet === address?.toLowerCase()) ? T.grayK : `${T.sweep}15`, border: `1px solid ${T.sweep}30`, borderRadius: 8, color: T.sweep, fontSize: 11, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", cursor: betRooms.find(r => r.creator_wallet === address?.toLowerCase() || r.challenger_wallet === address?.toLowerCase()) ? "not-allowed" : "pointer" }}
                            >
                              ⚡ JOIN & MATCH {room.nft_count} NFT{room.nft_count > 1 ? "s" : ""}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── MY RECENT COMPLETED BETS ── */}
                {myCompletedBets.length > 0 && (
                  <div style={PS}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                      <h3 style={{ fontSize: 12, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.white, letterSpacing: 2, margin: 0 }}>RECENT RESULTS</h3>
                      <button onClick={sharePNLCard} style={{ background: "#000", border: "1px solid #333", borderRadius: 8, padding: "8px 14px", fontSize: 9, fontWeight: 700, fontFamily: "'Share Tech Mono', monospace", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.737-8.835L1.254 2.25H8.08l4.261 5.636 5.903-5.636zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                        SHARE PNL
                      </button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {myCompletedBets.map(bet => {
                        const iWon = bet.winner_wallet?.toLowerCase() === address?.toLowerCase();
                        return (
                          <div key={bet.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: iWon ? `${T.success}08` : `${T.burn}08`, border: `1px solid ${iWon ? T.success : T.burn}30`, borderRadius: 10, flexWrap: "wrap", gap: 6 }}>
                            <div>
                              <span style={{ fontSize: 11, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: iWon ? T.success : T.burn }}>{iWon ? "🏆 WIN" : "💀 LOSS"}</span>
                              <span style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginLeft: 8 }}>vs {shortAddr(iWon ? (bet.challenger_wallet && bet.creator_wallet === bet.winner_wallet ? bet.challenger_wallet : bet.creator_wallet) || "" : (bet.winner_wallet || ""))}</span>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: T.accent }}>
                                {bet.coin_result?.toUpperCase()} · {bet.nft_count * 2} NFTs {iWon ? "won" : "lost"}
                              </div>
                              <div style={{ fontSize: 8, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>{new Date(bet.created_at).toLocaleString()}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ═══════════════ ROULETTE TAB ═══════════════ */}
        {tab === "roulette" && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 2, color: T.white, marginBottom: 4 }}>CAMBRILIO ROULETTE</h2>
            <p style={{ fontSize: 11, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginBottom: 20 }}>Wager your NFTs in a peer-to-peer roulette. Winner takes all — powered by Chainlink VRF.</p>

            {!isConnected ? (
              <div style={{ textAlign: "center", padding: 60 }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🎡</div>
                <div style={{ fontSize: 13, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, letterSpacing: 2 }}>CONNECT YOUR WALLET TO PLAY</div>
              </div>
            ) : (
              <>
                {/* ── ROULETTE WHEEL OVERLAY ── */}
                {(wheelSpinning || wheelTargetSlot !== undefined) && (
                  <div className="overlay-fade" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 9999, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)", gap: 20 }}>
                    <div style={{ fontSize: 11, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, letterSpacing: 2, marginBottom: 4 }}>
                      {wheelDone ? "RESULT" : "SPINNING..."}
                    </div>

                    <RouletteWheel
                      spinning={wheelSpinning}
                      targetSlot={wheelTargetSlot}
                      onDone={(_res: SpinResult) => { setWheelDone(true); }}
                    />

                    {!wheelDone && (
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 14, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.white, letterSpacing: 2, marginBottom: 6 }}>WAITING FOR CHAINLINK VRF</div>
                        <div style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>This may take ~30–60 seconds on Base</div>
                      </div>
                    )}

                    {wheelDone && wheelResult && (
                      <div className="result-pop" style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                        <RouletteResultBadge result={{ slot: wheelResult.slot, color: wheelResult.result }} />
                        <div style={{ fontSize: 28, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 3, color: wheelResult.winner.toLowerCase() === address?.toLowerCase() ? T.success : T.burn }}>
                          {wheelResult.winner.toLowerCase() === address?.toLowerCase() ? "YOU WIN!" : wheelResult.result === "green" ? "HOUSE WINS" : "YOU LOSE"}
                        </div>
                        {wheelResult.winner !== ZERO_ADDRESS && (
                          <div style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>
                            Winner: <span style={{ color: T.accent }}>{shortAddr(wheelResult.winner)}</span>
                          </div>
                        )}
                        <button
                          onClick={() => { setWheelTargetSlot(undefined); setWheelDone(false); setWheelResult(null); }}
                          style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 28px", color: T.white, fontSize: 11, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer", letterSpacing: 1, marginTop: 8 }}
                        >
                          DISMISS
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ── MY ACTIVE ROULETTE ROOM ── */}
                {(() => {
                  const addrLower = address?.toLowerCase();
                  const myRoom = rouletteRooms.find(r => r.red_player === addrLower || r.black_player === addrLower);
                  if (!myRoom) return null;
                  const userColor = myRoom.red_player === addrLower ? "red" : "black";
                  const userNftIds = userColor === "red" ? myRoom.red_nft_ids : myRoom.black_nft_ids;
                  const opponentAddr = userColor === "red" ? myRoom.black_player : myRoom.red_player;
                  const opponentNftIds = userColor === "red" ? myRoom.black_nft_ids : myRoom.red_nft_ids;
                  return (
                    <div style={{ ...PS, border: `1px solid ${myRoom.status === "active" ? T.accent : T.border}40` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.accent, letterSpacing: 1 }}>YOUR ROOM</div>
                          <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginTop: 2 }}>ROOM #{String(myRoom.id)} {myRoom.name && `· "${myRoom.name}"`}</div>
                        </div>
                        <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 9, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", background: myRoom.status === "active" ? `${T.success}20` : myRoom.status === "spinning" ? `${T.sweep}20` : `${T.gold}20`, color: myRoom.status === "active" ? T.success : myRoom.status === "spinning" ? T.sweep : T.gold }}>
                          {myRoom.status === "active" ? "⚡ READY TO SPIN" : myRoom.status === "spinning" ? "🔗 WAITING FOR VRF..." : "⏳ WAITING FOR CHALLENGER"}
                        </span>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "center", marginBottom: 14 }}>
                        {/* RED side */}
                        <div style={{ background: T.card, borderRadius: 10, padding: 12, border: `1px solid ${userColor === "red" ? "#ef444440" : T.border}` }}>
                          <div style={{ fontSize: 8, fontFamily: "'Share Tech Mono', monospace", color: "#ef4444", marginBottom: 4, fontWeight: 800 }}>🔴 RED {userColor === "red" && <span style={{ color: T.accent }}>· YOU</span>}</div>
                          <div style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: T.white, wordBreak: "break-all" }}>{myRoom.red_player ? shortAddr(myRoom.red_player) : "—"}</div>
                          <div style={{ fontSize: 9, color: T.accent, fontFamily: "'Share Tech Mono', monospace", marginTop: 4 }}>{(userColor === "red" ? userNftIds : opponentNftIds).length} NFT{(userColor === "red" ? userNftIds : opponentNftIds).length !== 1 ? "s" : ""}</div>
                          <div style={{ fontSize: 8, color: T.grayD, fontFamily: "'Share Tech Mono', monospace", marginTop: 2 }}>
                            {userColor === "red" ? `#${userNftIds.join(", #")}` : myRoom.red_player ? `#${opponentNftIds.join(", #")}` : "—"}
                          </div>
                        </div>

                        <div style={{ fontSize: 18, color: T.burn, fontWeight: 900, textAlign: "center" }}>VS</div>

                        {/* BLACK side */}
                        <div style={{ background: T.card, borderRadius: 10, padding: 12, border: `1px solid ${userColor === "black" ? T.accent + "40" : T.border}` }}>
                          {myRoom.black_player ? (
                            <>
                              <div style={{ fontSize: 8, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginBottom: 4, fontWeight: 800 }}>⚫ BLACK {userColor === "black" && <span style={{ color: T.accent }}>· YOU</span>}</div>
                              <div style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: T.white, wordBreak: "break-all" }}>{shortAddr(myRoom.black_player)}</div>
                              <div style={{ fontSize: 9, color: T.accent, fontFamily: "'Share Tech Mono', monospace", marginTop: 4 }}>{(userColor === "black" ? userNftIds : myRoom.black_nft_ids).length} NFT{(userColor === "black" ? userNftIds : myRoom.black_nft_ids).length !== 1 ? "s" : ""}</div>
                              <div style={{ fontSize: 8, color: T.grayD, fontFamily: "'Share Tech Mono', monospace", marginTop: 2 }}>#{(userColor === "black" ? userNftIds : myRoom.black_nft_ids).join(", #")}</div>
                            </>
                          ) : (
                            <div style={{ textAlign: "center", padding: "8px 0" }}>
                              <div style={{ fontSize: 16 }}>⌛</div>
                              <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginTop: 4 }}>WAITING FOR<br />CHALLENGER</div>
                            </div>
                          )}
                        </div>
                      </div>

                      {myRoom.eth_amount > 0n && (
                        <div style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: T.accent, marginBottom: 10, textAlign: "center" }}>
                          ⚡ ETH wager: {(Number(myRoom.eth_amount) / 1e18).toFixed(4)} ETH each side
                        </div>
                      )}

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {myRoom.status === "active" && (
                          <button
                            onClick={() => handleSpin(myRoom.id)}
                            disabled={spinningRoulette}
                            style={{ flex: 1, padding: "12px 0", background: spinningRoulette ? T.grayK : T.accent, border: "none", borderRadius: 10, color: T.bg, fontSize: 13, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 2, cursor: spinningRoulette ? "not-allowed" : "pointer" }}
                          >
                            🎡 SPIN THE WHEEL
                          </button>
                        )}
                        {myRoom.status === "spinning" && (
                          <div style={{ flex: 1, padding: "12px 0", background: `${T.sweep}10`, border: `1px solid ${T.sweep}30`, borderRadius: 10, color: T.sweep, fontSize: 11, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 1, textAlign: "center" }}>
                            🔗 CHAINLINK VRF RESOLVING...
                          </div>
                        )}
                        {myRoom.status === "waiting" && myRoom.red_player === addrLower && !myRoom.black_player && (
                          <button onClick={() => handleCancelRoulette(myRoom.id)} style={{ padding: "10px 16px", background: `${T.burn}15`, border: `1px solid ${T.burn}40`, borderRadius: 10, color: T.burn, fontSize: 10, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer" }}>CANCEL</button>
                        )}
                        {myRoom.status === "waiting" && myRoom.black_player === addrLower && !myRoom.red_player && (
                          <button onClick={() => handleCancelRoulette(myRoom.id)} style={{ padding: "10px 16px", background: `${T.burn}15`, border: `1px solid ${T.burn}40`, borderRadius: 10, color: T.burn, fontSize: 10, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer" }}>CANCEL</button>
                        )}
                        {(myRoom.status === "active" || myRoom.status === "spinning") &&
                          Date.now() > new Date(myRoom.created_at).getTime() + 24 * 3600 * 1000 && (
                          <button onClick={() => handleRefundExpiredRoulette(myRoom.id)} style={{ padding: "10px 14px", background: `${T.gold}15`, border: `1px solid ${T.gold}40`, borderRadius: 10, color: T.gold, fontSize: 10, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer" }}>⏰ REFUND EXPIRED</button>
                        )}
                        <button onClick={loadRouletteRooms} style={{ padding: "10px 14px", background: `${T.accent}10`, border: `1px solid ${T.accent}20`, borderRadius: 10, color: T.accent, fontSize: 10, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer" }}>↻</button>
                      </div>
                    </div>
                  );
                })()}

                {/* ── CREATE ROULETTE ROOM ── */}
                {!rouletteRooms.find(r => r.red_player === address?.toLowerCase() || r.black_player === address?.toLowerCase()) && (
                  <div style={PS}>
                    <h3 style={{ fontSize: 12, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.accent, letterSpacing: 2, marginBottom: 14 }}>CREATE ROULETTE ROOM</h3>

                    {/* Step 1: NFT count */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, letterSpacing: 1, marginBottom: 8 }}>HOW MANY NFTs TO WAGER?</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {([1, 2, 3, "custom"] as const).map(v => (
                          <button key={v} onClick={() => { setRouletteNftCount(v); setRouletteSelectedIds(new Set()); }} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${rouletteNftCount === v ? T.accent : T.border}`, background: rouletteNftCount === v ? `${T.accent}15` : T.card, color: rouletteNftCount === v ? T.accent : T.grayD, fontSize: 11, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer" }}>
                            {v === "custom" ? "CUSTOM" : `${v} NFT`}
                          </button>
                        ))}
                      </div>
                      {rouletteNftCount === "custom" && (
                        <input type="number" min={1} max={20} value={rouletteCustomCount} onChange={e => { setRouletteCustomCount(e.target.value); setRouletteSelectedIds(new Set()); }} placeholder="Enter amount..." style={{ ...inputStyle, marginTop: 8, width: 160 }} />
                      )}
                    </div>

                    {/* Step 2: choose color */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, letterSpacing: 1, marginBottom: 8 }}>YOUR COLOR</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => setRouletteColor("red")} style={{ padding: "10px 24px", borderRadius: 10, border: `1px solid ${rouletteColor === "red" ? "#ef4444" : T.border}`, background: rouletteColor === "red" ? "#ef444415" : T.card, color: rouletteColor === "red" ? "#ef4444" : T.grayD, fontSize: 13, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 1, cursor: "pointer" }}>
                          🔴 RED
                        </button>
                        <button onClick={() => setRouletteColor("black")} style={{ padding: "10px 24px", borderRadius: 10, border: `1px solid ${rouletteColor === "black" ? "#71717a" : T.border}`, background: rouletteColor === "black" ? "#71717a15" : T.card, color: rouletteColor === "black" ? "#a1a1aa" : T.grayD, fontSize: 13, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 1, cursor: "pointer" }}>
                          ⚫ BLACK
                        </button>
                      </div>
                      <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayK, marginTop: 6 }}>
                        31 slots · 15 RED · 15 BLACK · 1 GREEN (house) · 5% fee on ETH wins
                      </div>
                    </div>

                    {/* Step 3: room name */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, letterSpacing: 1, marginBottom: 8 }}>
                        ROOM NAME <span style={{ color: T.grayK }}>(OPTIONAL · MAX 32 CHARS)</span>
                      </div>
                      <input type="text" maxLength={32} value={rouletteRoomName} onChange={e => setRouletteRoomName(e.target.value)} placeholder="e.g. 3v3 Roulette" style={inputStyle} />
                    </div>

                    {/* Step 4: optional ETH wager */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, letterSpacing: 1, marginBottom: 8 }}>
                        ETH WAGER <span style={{ color: T.grayK }}>(OPTIONAL)</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input type="number" min="0" step="0.001" value={rouletteEthAmount} onChange={e => setRouletteEthAmount(e.target.value)} placeholder="0.00 ETH" style={{ ...inputStyle, width: 160 }} />
                        <span style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>ETH</span>
                      </div>
                      {rouletteEthAmount && parseFloat(rouletteEthAmount) > 0 && (
                        <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayK, marginTop: 4 }}>
                          Challenger must match {rouletteEthAmount} ETH · 5% fee on win
                        </div>
                      )}
                    </div>

                    {/* Step 5: select NFTs */}
                    {resolvedRouletteCount > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, letterSpacing: 1, marginBottom: 8 }}>
                          SELECT {resolvedRouletteCount} NFT{resolvedRouletteCount > 1 ? "s" : ""} TO WAGER
                          <span style={{ marginLeft: 8, color: rouletteSelectedIds.size === resolvedRouletteCount ? T.success : T.accent }}>{rouletteSelectedIds.size}/{resolvedRouletteCount} selected</span>
                        </div>
                        {ownedNfts.length === 0 ? (
                          <div style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>No NFTs found in your wallet.</div>
                        ) : (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 260, overflowY: "auto" }}>
                            {ownedNfts.map(nft => {
                              const sel = rouletteSelectedIds.has(nft.tokenId);
                              const locked = rouletteRooms.some(r => [...r.red_nft_ids, ...r.black_nft_ids].includes(nft.tokenId));
                              return (
                                <div
                                  key={nft.tokenId}
                                  onClick={() => {
                                    if (locked) return;
                                    setRouletteSelectedIds(prev => {
                                      const n = new Set(prev);
                                      if (n.has(nft.tokenId)) { n.delete(nft.tokenId); return n; }
                                      if (n.size >= resolvedRouletteCount) return prev;
                                      n.add(nft.tokenId); return n;
                                    });
                                  }}
                                  style={{ width: 72, borderRadius: 10, overflow: "hidden", border: `2px solid ${locked ? T.grayK : sel ? T.accent : T.border}`, cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.4 : 1, background: sel ? `${T.accent}10` : T.card, flexShrink: 0 }}
                                >
                                  {nft.image && <img src={nft.image} alt={`#${nft.tokenId}`} style={{ width: "100%", display: "block" }} />}
                                  <div style={{ padding: "3px 4px", textAlign: "center", fontSize: 8, fontFamily: "'Share Tech Mono', monospace", color: sel ? T.accent : T.grayD, fontWeight: 700 }}>#{nft.tokenId}</div>
                                  {locked && <div style={{ padding: "2px 4px", textAlign: "center", fontSize: 7, fontFamily: "'Share Tech Mono', monospace", color: T.burn }}>IN BET</div>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    <button
                      onClick={handleCreateRoulette}
                      disabled={creatingRoulette || rouletteSelectedIds.size !== resolvedRouletteCount || resolvedRouletteCount === 0}
                      style={{ width: "100%", padding: "12px 0", background: (creatingRoulette || rouletteSelectedIds.size !== resolvedRouletteCount || resolvedRouletteCount === 0) ? T.grayK : T.accent, border: "none", borderRadius: 10, color: T.bg, fontSize: 12, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 2, cursor: (creatingRoulette || rouletteSelectedIds.size !== resolvedRouletteCount || resolvedRouletteCount === 0) ? "not-allowed" : "pointer" }}
                    >
                      {creatingRoulette ? "CREATING..." : "🎡 CREATE ROULETTE ROOM"}
                    </button>
                  </div>
                )}

                {/* ── OPEN ROULETTE LOBBIES ── */}
                <div style={PS}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <h3 style={{ fontSize: 12, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.white, letterSpacing: 2 }}>OPEN LOBBIES</h3>
                    <button onClick={loadRouletteRooms} style={{ background: `${T.accent}10`, border: `1px solid ${T.accent}20`, borderRadius: 6, padding: "4px 10px", color: T.accent, fontSize: 9, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer" }}>↻ REFRESH</button>
                  </div>

                  {rouletteRooms.filter(r => r.status === "waiting" && r.red_player !== address?.toLowerCase() && r.black_player !== address?.toLowerCase()).length === 0 ? (
                    <div style={{ textAlign: "center", padding: "30px 0", color: T.grayD, fontSize: 11, fontFamily: "'Share Tech Mono', monospace" }}>No open rooms right now. Create one above!</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {rouletteRooms
                        .filter(r => r.status === "waiting" && r.red_player !== address?.toLowerCase() && r.black_player !== address?.toLowerCase())
                        .map(room => {
                          const creatorColor = room.red_player !== ZERO_ADDRESS && !room.black_player ? "red" : "black";
                          const joinerColor = creatorColor === "red" ? "black" : "red";
                          const creatorAddr = creatorColor === "red" ? room.red_player : (room.black_player ?? "");
                          const creatorNftIds = creatorColor === "red" ? room.red_nft_ids : room.black_nft_ids;
                          return (
                            <div key={room.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
                                <div>
                                  <div style={{ fontSize: 11, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", color: T.white }}>{room.name || shortAddr(creatorAddr)}</div>
                                  {room.name && <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>{shortAddr(creatorAddr)}</div>}
                                  <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginTop: 2 }}>
                                    wagering {room.nft_count} NFT{room.nft_count > 1 ? "s" : ""} · #{creatorNftIds.join(", #")}
                                    {room.eth_amount > 0n && <span style={{ marginLeft: 6, color: T.accent }}>+ {(Number(room.eth_amount) / 1e18).toFixed(4)} ETH</span>}
                                  </div>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <div style={{ fontSize: 10, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: creatorColor === "red" ? "#ef4444" : "#a1a1aa" }}>
                                    {creatorColor === "red" ? "🔴 RED" : "⚫ BLACK"}
                                  </div>
                                  <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.accent, marginTop: 2 }}>
                                    You play: <span style={{ color: joinerColor === "red" ? "#ef4444" : "#a1a1aa" }}>{joinerColor === "red" ? "🔴 RED" : "⚫ BLACK"}</span>
                                  </div>
                                  <div style={{ fontSize: 8, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginTop: 2 }}>{new Date(room.created_at).toLocaleTimeString()}</div>
                                </div>
                              </div>

                              {/* Join UI */}
                              {rouletteJoinRoomId === room.id ? (
                                <div>
                                  <div style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginBottom: 8 }}>
                                    SELECT {room.nft_count} NFT{room.nft_count > 1 ? "s" : ""} TO MATCH
                                    <span style={{ marginLeft: 8, color: rouletteJoinSelectedIds.size === room.nft_count ? T.success : T.accent }}>{rouletteJoinSelectedIds.size}/{room.nft_count}</span>
                                  </div>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 200, overflowY: "auto", marginBottom: 10 }}>
                                    {ownedNfts.map(nft => {
                                      const sel = rouletteJoinSelectedIds.has(nft.tokenId);
                                      const locked = rouletteRooms.some(r => [...r.red_nft_ids, ...r.black_nft_ids].includes(nft.tokenId));
                                      return (
                                        <div
                                          key={nft.tokenId}
                                          onClick={() => {
                                            if (locked) return;
                                            setRouletteJoinSelectedIds(prev => {
                                              const n = new Set(prev);
                                              if (n.has(nft.tokenId)) { n.delete(nft.tokenId); return n; }
                                              if (n.size >= room.nft_count) return prev;
                                              n.add(nft.tokenId); return n;
                                            });
                                          }}
                                          style={{ width: 64, borderRadius: 8, overflow: "hidden", border: `2px solid ${locked ? T.grayK : sel ? T.accent : T.border}`, cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.4 : 1, background: sel ? `${T.accent}10` : T.bgS, flexShrink: 0 }}
                                        >
                                          {nft.image && <img src={nft.image} alt={`#${nft.tokenId}`} style={{ width: "100%", display: "block" }} />}
                                          <div style={{ padding: "2px 3px", textAlign: "center", fontSize: 7, fontFamily: "'Share Tech Mono', monospace", color: sel ? T.accent : T.grayD, fontWeight: 700 }}>#{nft.tokenId}</div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                  <div style={{ display: "flex", gap: 8 }}>
                                    <button
                                      onClick={() => handleJoinRoulette(room.id)}
                                      disabled={joiningRoulette || rouletteJoinSelectedIds.size !== room.nft_count}
                                      style={{ flex: 1, padding: "10px 0", background: (joiningRoulette || rouletteJoinSelectedIds.size !== room.nft_count) ? T.grayK : T.accent, border: "none", borderRadius: 8, color: T.bg, fontSize: 11, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", cursor: (joiningRoulette || rouletteJoinSelectedIds.size !== room.nft_count) ? "not-allowed" : "pointer" }}
                                    >
                                      {joiningRoulette ? "JOINING..." : `CONFIRM JOIN${room.eth_amount > 0n ? ` · ${(Number(room.eth_amount) / 1e18).toFixed(4)} ETH` : ""}`}
                                    </button>
                                    <button onClick={() => { setRouletteJoinRoomId(null); setRouletteJoinSelectedIds(new Set()); }} style={{ padding: "10px 14px", background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, color: T.grayD, fontSize: 10, fontFamily: "'Share Tech Mono', monospace", cursor: "pointer" }}>CANCEL</button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  onClick={() => { setRouletteJoinRoomId(room.id); setRouletteJoinSelectedIds(new Set()); }}
                                  disabled={!!rouletteRooms.find(r => r.red_player === address?.toLowerCase() || r.black_player === address?.toLowerCase())}
                                  style={{ width: "100%", padding: "9px 0", background: rouletteRooms.find(r => r.red_player === address?.toLowerCase() || r.black_player === address?.toLowerCase()) ? T.grayK : `${T.sweep}15`, border: `1px solid ${T.sweep}30`, borderRadius: 8, color: T.sweep, fontSize: 11, fontWeight: 800, fontFamily: "'Share Tech Mono', monospace", cursor: rouletteRooms.find(r => r.red_player === address?.toLowerCase() || r.black_player === address?.toLowerCase()) ? "not-allowed" : "pointer" }}
                                >
                                  ⚡ JOIN AS {joinerColor.toUpperCase()} · MATCH {room.nft_count} NFT{room.nft_count > 1 ? "s" : ""}
                                </button>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>

                {/* ── MY RECENT ROULETTE RESULTS ── */}
                {myCompletedRoulettes.length > 0 && (
                  <div style={PS}>
                    <h3 style={{ fontSize: 12, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: T.white, letterSpacing: 2, marginBottom: 12 }}>RECENT RESULTS</h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {myCompletedRoulettes.map(r => {
                        const iWon = r.winner_wallet?.toLowerCase() === address?.toLowerCase();
                        const isGreen = r.spin_result === "green";
                        const slotColor = r.spin_result === "red" ? "#ef4444" : r.spin_result === "black" ? "#a1a1aa" : "#4ade80";
                        return (
                          <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: isGreen ? `${T.gold}08` : iWon ? `${T.success}08` : `${T.burn}08`, border: `1px solid ${isGreen ? T.gold : iWon ? T.success : T.burn}30`, borderRadius: 10, flexWrap: "wrap", gap: 6 }}>
                            <div>
                              <span style={{ fontSize: 11, fontWeight: 900, fontFamily: "'Share Tech Mono', monospace", color: isGreen ? T.gold : iWon ? T.success : T.burn }}>
                                {isGreen ? "🟢 HOUSE WINS" : iWon ? "🏆 WIN" : "💀 LOSS"}
                              </span>
                              {r.winner_wallet && <span style={{ fontSize: 9, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, marginLeft: 8 }}>winner: {shortAddr(r.winner_wallet)}</span>}
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: slotColor }}>
                                SLOT #{r.spin_slot} · {r.spin_result?.toUpperCase()} · {r.nft_count * 2} NFTs
                              </div>
                              <div style={{ fontSize: 8, fontFamily: "'Share Tech Mono', monospace", color: T.grayD }}>{new Date(r.created_at).toLocaleString()}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* FOOTER */}
        <div style={{ textAlign: "center", padding: "30px 0 0", borderTop: `1px solid ${T.border}`, marginTop: 24 }}>
          <div style={{ fontSize: 8, fontFamily: "'Share Tech Mono', monospace", color: T.grayD, letterSpacing: 2, lineHeight: 2 }}>CAMBRILIO SOFT STAKE • BASE • 1 NFT = 1 $CUM/DAY • PARTY HAT = 3x • 1/1 = 5x<br />NFTs never leave your wallet</div>
        </div>
      </div>
    </div>
  );
}
