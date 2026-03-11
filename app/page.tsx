"use client";

import { useState, useEffect, useCallback } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSignMessage } from "wagmi";
import { getOwnedCambrilios, checkListedClient, OwnedNFT } from "@/lib/blockchain";
import { supabase } from "@/lib/supabase";

// ═══ THEME ═══
const T = {
  bg: "#06060b", bgS: "#0b0b14", card: "#0e0e18", cardH: "#121220",
  border: "#1a1a2c", accent: "#c8ff00", burn: "#ff4444",
  sweep: "#00e5ff", gold: "#ffd700", weth: "#627eea",
  listed: "#ff6b6b", white: "#f0f0f5", gray: "#8888a0",
  grayD: "#55556a", grayK: "#333345", success: "#00ff88",
  cum: "#f0c040",
};

// ═══ INTERFACES ═══
interface LeaderEntry { wallet: string; staked: number; balance: number; earned: number; }
interface StoreListing { id: number; title: string; description: string; image_url: string; project_url: string; price_cum: number; total_spots: number; remaining_spots: number; is_active: boolean; created_at: string; expires_at: string | null; }
interface Purchase { id: number; listing_id: number; buyer_wallet: string; wl_wallet: string; cum_spent: number; purchased_at: string; store_listings?: { title: string }; }
interface BurnReward { id: number; title: string; description: string; image_url: string; burn_cost: number; total_supply: number; remaining_supply: number; is_active: boolean; created_at: string; expires_at: string | null; }
interface BurnClaim { id: number; reward_id: number; wallet_address: string; token_ids: string[]; tx_hashes: string[]; status: string; admin_notes: string; submitted_at: string; burn_rewards?: { title: string; image_url: string }; }

// ═══ HELPERS ═══
const PS: React.CSSProperties = { background: T.bgS, border: `1px solid ${T.border}`, borderRadius: 14, padding: 20, marginBottom: 20 };
const inputStyle: React.CSSProperties = { width: "100%", background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px", color: T.white, fontSize: 12, fontFamily: "monospace", outline: "none", boxSizing: "border-box" };
const shortAddr = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

// ═══ COUNTDOWN COMPONENT ═══
function Countdown({ expiresAt }: { expiresAt: string }) {
  const [left, setLeft] = useState("");
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) { setExpired(true); setLeft("EXPIRED"); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setLeft(`${d > 0 ? d + "d " : ""}${h.toString().padStart(2, "0")}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: expired ? `${T.burn}15` : `${T.accent}10`, border: `1px solid ${expired ? T.burn : T.accent}30`, borderRadius: 8 }}>
      <span style={{ fontSize: 14 }}>{expired ? "⏰" : "⏳"}</span>
      <span style={{ fontSize: 11, fontWeight: 800, fontFamily: "monospace", color: expired ? T.burn : T.accent, letterSpacing: 1 }}>{left}</span>
    </div>
  );
}

// ═══ MAIN PAGE ═══
export default function StakePage() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  // Tab
  const [tab, setTab] = useState<"stake" | "store" | "burn" | "dashboard" | "admin">("stake");

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

  // $CUM
  const [cumBalance, setCumBalance] = useState(0);
  const [cumPending, setCumPending] = useState(0);
  const [cumEarned, setCumEarned] = useState(0);
  const [cumSpent, setCumSpent] = useState(0);
  const [cumRate, setCumRate] = useState(0);
  const [claiming, setClaiming] = useState(false);
  const [myPurchases, setMyPurchases] = useState<Purchase[]>([]);

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

  // Admin
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminData, setAdminData] = useState<any>(null);
  const [newListing, setNewListing] = useState({ title: "", description: "", imageUrl: "", projectUrl: "", priceCum: "5", totalSpots: "20", expiresAt: "" });
  const [newBurnReward, setNewBurnReward] = useState({ title: "", description: "", imageUrl: "", burnCost: "10", totalSupply: "1", expiresAt: "" });

  // ═══ SHOW MESSAGE ═══
  const showMsg = (text: string, type: "ok" | "err" = "ok") => { setMsg(text); setMsgType(type); setTimeout(() => setMsg(""), 6000); };

  // ═══ DATA LOADERS ═══
  const loadUserData = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const [nfts, { data: stakes }] = await Promise.all([
        getOwnedCambrilios(address),
        supabase.from("stakes").select("token_id").eq("wallet_address", address.toLowerCase()).eq("is_active", true),
      ]);
      setOwnedNfts(nfts);
      setStakedIds(new Set((stakes || []).map((s: any) => s.token_id)));
      if (nfts.length > 0) { const listed = await checkListedClient(nfts.map(n => n.tokenId)); setListedIds(listed); }
      const balRes = await fetch(`/api/balance?wallet=${address}`);
      const bal = await balRes.json();
      setCumBalance(bal.balance || 0); setCumPending(bal.pendingCum || 0); setCumEarned(bal.totalEarned || 0); setCumSpent(bal.totalSpent || 0); setCumRate(bal.ratePerDay || 0); setMyPurchases(bal.purchases || []);
      const { data: adm } = await supabase.from("admins").select("wallet_address").eq("wallet_address", address.toLowerCase()).single();
      setIsAdmin(!!adm);
      // Check stake enabled setting
      const { data: setting } = await supabase.from("settings").select("value").eq("key", "stake_enabled").single();
      setStakeEnabled(setting?.value === "true");
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [address]);

  const loadLeaderboard = useCallback(async () => { try { const res = await fetch("/api/leaderboard"); const data = await res.json(); setLeaderboard(data.leaderboard || []); setGlobalStats(data.stats || { totalStakers: 0, totalNFTsStaked: 0, totalTickets: 0 }); } catch {} }, []);
  const loadStore = useCallback(async () => { try { const res = await fetch("/api/store"); const data = await res.json(); setListings(data.listings || []); } catch {} }, []);
  const loadBurnData = useCallback(async () => { try { const p = new URLSearchParams(); if (address) p.set("wallet", address); if (isAdmin) p.set("admin", "true"); const res = await fetch(`/api/burn?${p}`); const data = await res.json(); setBurnRewards(data.rewards || []); setBurnClaims(data.claims || []); setAllBurnClaims(data.allClaims || []); } catch {} }, [address, isAdmin]);
  const loadAdminData = useCallback(async () => { if (!address || !isAdmin) return; try { const res = await fetch(`/api/admin?wallet=${address}`); const data = await res.json(); setAdminData(data); } catch {} }, [address, isAdmin]);

  useEffect(() => { loadLeaderboard(); loadStore(); loadBurnData(); fetch("/api/verify", { method: "POST" }).catch(() => {}); /* Check stake setting publicly */ supabase.from("settings").select("value").eq("key", "stake_enabled").single().then(({ data }) => setStakeEnabled(data?.value === "true")); }, []);
  useEffect(() => { if (isConnected && address) { loadUserData(); loadBurnData(); } }, [isConnected, address, loadUserData, loadBurnData]);
  useEffect(() => { if (isAdmin && tab === "admin") loadAdminData(); }, [isAdmin, tab, loadAdminData]);

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

  // ═══ STORE HANDLERS ═══
  const handleBuy = async (listingId: number) => {
    if (!address || !wlWalletInput) return; setStaking(true);
    try { const res = await fetch("/api/store", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: address, listingId, wlWallet: wlWalletInput }) }); const data = await res.json(); if (data.success) { showMsg(`WL purchased! Spent ${data.spent} $CUM`); setBuyingId(null); setWlWalletInput(""); await loadUserData(); await loadStore(); } else showMsg(data.error, "err"); } catch (err: any) { showMsg(err.message, "err"); } finally { setStaking(false); }
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
    try { const res = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: address, ...newListing, expiresAt: newListing.expiresAt || null }) }); const data = await res.json(); if (data.success) { showMsg(`Listing created!`); setNewListing({ title: "", description: "", imageUrl: "", projectUrl: "", priceCum: "5", totalSpots: "20", expiresAt: "" }); await loadStore(); await loadAdminData(); } else showMsg(data.error, "err"); } catch (err: any) { showMsg(err.message, "err"); }
  };

  const handleCreateBurnReward = async () => {
    if (!address) return;
    try { const res = await fetch("/api/burn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_reward", wallet: address, ...newBurnReward, expiresAt: newBurnReward.expiresAt || null }) }); const data = await res.json(); if (data.success) { showMsg(`Burn reward created!`); setNewBurnReward({ title: "", description: "", imageUrl: "", burnCost: "10", totalSupply: "1", expiresAt: "" }); await loadBurnData(); } else showMsg(data.error, "err"); } catch (err: any) { showMsg(err.message, "err"); }
  };

  const toggleStakeEnabled = async () => {
    if (!address) return;
    const newVal = !stakeEnabled;
    try { const res = await fetch("/api/admin", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: address, setting: { key: "stake_enabled", value: String(newVal) } }) }); const data = await res.json(); if (data.success) { setStakeEnabled(newVal); showMsg(`Staking ${newVal ? "ENABLED" : "DISABLED"}`); } } catch (err: any) { showMsg(err.message, "err"); }
  };

  const updateBurnTxInput = (rid: number, idx: number, val: string) => setBurnTxInputs(prev => { const a = [...(prev[rid] || [""])]; a[idx] = val; return { ...prev, [rid]: a }; });
  const addTxField = (rid: number) => setBurnTxInputs(prev => { const a = [...(prev[rid] || [""]), ""]; return { ...prev, [rid]: a }; });
  const removeTxField = (rid: number, idx: number) => setBurnTxInputs(prev => { const a = [...(prev[rid] || [])]; a.splice(idx, 1); if (a.length === 0) a.push(""); return { ...prev, [rid]: a }; });

  const toggleSelect = (id: string) => setSelectedIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = () => setSelectedIds(new Set(ownedNfts.filter(n => !stakedIds.has(n.tokenId) && !listedIds.has(n.tokenId)).map(n => n.tokenId)));
  const stakeableNfts = ownedNfts.filter(n => !stakedIds.has(n.tokenId) && !listedIds.has(n.tokenId));
  const stakedNfts = ownedNfts.filter(n => stakedIds.has(n.tokenId));
  const listedNfts = ownedNfts.filter(n => listedIds.has(n.tokenId));

  // Check if listing/reward is expired
  const isExpired = (expiresAt: string | null) => expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false;

  // ═══ RENDER ═══
  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.white, fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* NAV */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: `${T.bg}ee`, backdropFilter: "blur(12px)", borderBottom: `1px solid ${T.border}`, padding: "0 16px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56, gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 20 }}>🔥</span>
            <span style={{ fontSize: 16, fontWeight: 900, fontFamily: "monospace", letterSpacing: 3, color: T.accent }}>CAMBRILIO</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", overflowX: "auto", flexShrink: 1 }}>
            {(["stake", "store", "burn", "dashboard", ...(isAdmin ? ["admin"] : [])] as const).map(t => (
              <button key={t} onClick={() => setTab(t as any)} style={{ background: "none", border: "none", cursor: "pointer", color: tab === t ? T.accent : T.grayD, fontSize: 10, fontWeight: 800, fontFamily: "monospace", letterSpacing: 1.5, borderBottom: tab === t ? `2px solid ${T.accent}` : "2px solid transparent", padding: "6px 2px", whiteSpace: "nowrap", flexShrink: 0 }}>▸{t.toUpperCase()}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
            {isConnected && <div style={{ padding: "3px 8px", background: `${T.cum}15`, border: `1px solid ${T.cum}30`, borderRadius: 6 }}><span style={{ fontSize: 11, fontWeight: 900, fontFamily: "monospace", color: T.cum }}>{cumBalance}</span><span style={{ fontSize: 8, color: T.cum, opacity: 0.7, marginLeft: 3 }}>$CUM</span></div>}
            <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" label="Connect Wallet" />
          </div>
        </div>
      </nav>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px 60px" }}>
        {msg && <div style={{ padding: "10px 14px", marginBottom: 16, borderRadius: 8, background: msgType === "err" ? `${T.burn}15` : `${T.success}15`, border: `1px solid ${msgType === "err" ? T.burn : T.success}30`, color: msgType === "err" ? T.burn : T.success, fontSize: 12, fontFamily: "monospace" }}>{msg}</div>}

        {/* ═══════════════ STAKE TAB ═══════════════ */}
        {tab === "stake" && (
          <>
            {!isConnected ? (
              <div style={{ textAlign: "center", padding: "60px 16px" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🔥</div>
                <h1 style={{ fontSize: 28, fontWeight: 900, fontFamily: "monospace", letterSpacing: 3, marginBottom: 10, color: T.accent }}>SOFT STAKE</h1>
                <p style={{ fontSize: 13, color: T.gray, maxWidth: 420, margin: "0 auto 14px", lineHeight: 1.8 }}>Stake your Cambrilios without leaving your wallet. Earn <span style={{ color: T.cum, fontWeight: 700 }}>$CUM tickets</span> every 24 hours.</p>
                <p style={{ fontSize: 11, color: T.grayD, fontFamily: "monospace", marginBottom: 24 }}>1 staked NFT = 1 $CUM / day</p>
                <ConnectButton label="Connect Wallet" />
              </div>
            ) : loading ? (
              <div style={{ textAlign: "center", padding: 60, fontSize: 11, fontFamily: "monospace", color: T.grayD }}>⏳ Loading your Cambrilios...</div>
            ) : ownedNfts.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60 }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>😔</div>
                <div style={{ fontSize: 14, fontFamily: "monospace", color: T.gray }}>No Cambrilios found in this wallet</div>
                <a href="https://opensea.io/collection/cambrilio" target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 16, padding: "10px 24px", background: T.accent, color: T.bg, borderRadius: 8, fontSize: 12, fontWeight: 800, fontFamily: "monospace", textDecoration: "none" }}>BUY ON OPENSEA →</a>
              </div>
            ) : (
              <>
                {/* $CUM Balance Card */}
                <div style={{ ...PS, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 10, fontFamily: "monospace", color: T.grayD, letterSpacing: 2, fontWeight: 700, marginBottom: 4 }}>YOUR $CUM BALANCE</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 32, fontWeight: 900, fontFamily: "monospace", color: T.cum }}>{cumBalance}</span>
                      <span style={{ fontSize: 12, fontFamily: "monospace", color: T.cum, opacity: 0.6 }}>$CUM</span>
                    </div>
                    <div style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD, marginTop: 4 }}>Rate: {cumRate}/day • Pending: ~{cumPending} • Earned: {cumEarned} • Spent: {cumSpent}</div>
                  </div>
                  <button onClick={handleClaim} disabled={claiming || cumPending < 1} style={{ background: cumPending >= 1 ? T.cum : T.grayK, color: T.bg, border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 12, fontWeight: 900, fontFamily: "monospace", letterSpacing: 1, cursor: cumPending >= 1 ? "pointer" : "not-allowed", opacity: claiming ? 0.6 : 1 }}>{claiming ? "CLAIMING..." : cumPending >= 1 ? `CLAIM ${cumPending} $CUM` : "ACCUMULATING..."}</button>
                </div>

                {/* Stake disabled notice */}
                {!stakeEnabled && (
                  <div style={{ ...PS, background: `${T.grayK}40`, textAlign: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 800, fontFamily: "monospace", color: T.grayD, letterSpacing: 2 }}>🔒 STAKING IS CURRENTLY PAUSED</div>
                    <div style={{ fontSize: 10, fontFamily: "monospace", color: T.grayK, marginTop: 6 }}>New stakes are disabled by admin. Existing stakes continue earning $CUM.</div>
                  </div>
                )}

                {/* Staked */}
                {stakedNfts.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                      <h2 style={{ fontSize: 15, fontWeight: 900, fontFamily: "monospace", color: T.sweep, letterSpacing: 2 }}>🔒 STAKED ({stakedNfts.length})</h2>
                      {stakeEnabled && <button onClick={() => handleUnstake(stakedNfts.map(n => n.tokenId))} disabled={staking} style={{ background: `${T.burn}15`, border: `1px solid ${T.burn}40`, borderRadius: 6, padding: "5px 12px", color: T.burn, fontSize: 9, fontFamily: "monospace", fontWeight: 700, cursor: "pointer" }}>UNSTAKE ALL</button>}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                      {stakedNfts.map(nft => (
                        <div key={nft.tokenId} style={{ background: T.card, border: `1px solid ${T.sweep}40`, borderRadius: 10, overflow: "hidden" }}>
                          <div style={{ aspectRatio: "1", position: "relative", background: T.bg }}>
                            {nft.image ? <img src={nft.image} alt={nft.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>🎨</div>}
                            <div style={{ position: "absolute", top: 3, right: 3, background: T.sweep, borderRadius: 4, padding: "2px 5px", fontSize: 7, fontWeight: 900, fontFamily: "monospace", color: T.bg }}>STAKED</div>
                          </div>
                          <div style={{ padding: "5px 7px" }}>
                            <div style={{ fontSize: 9, fontWeight: 700, fontFamily: "monospace", color: T.sweep, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nft.name}</div>
                            <div style={{ fontSize: 7, fontFamily: "monospace", color: T.cum, marginTop: 2 }}>+1 $CUM/day</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Listed */}
                {listedNfts.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <h2 style={{ fontSize: 13, fontWeight: 900, fontFamily: "monospace", color: T.listed, letterSpacing: 2, marginBottom: 10 }}>⚠️ LISTED — DELIST TO STAKE ({listedNfts.length})</h2>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                      {listedNfts.map(nft => (
                        <div key={nft.tokenId} style={{ background: T.card, border: `1px solid ${T.listed}30`, borderRadius: 10, overflow: "hidden", opacity: 0.4 }}>
                          <div style={{ aspectRatio: "1", background: T.bg }}>{nft.image ? <img src={nft.image} alt={nft.name} style={{ width: "100%", height: "100%", objectFit: "cover", filter: "grayscale(0.5)" }} /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>🎨</div>}</div>
                          <div style={{ padding: "5px 7px" }}><div style={{ fontSize: 9, fontWeight: 700, fontFamily: "monospace", color: T.listed }}>{nft.name}</div></div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Available to stake */}
                {stakeableNfts.length > 0 && stakeEnabled && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                      <h2 style={{ fontSize: 15, fontWeight: 900, fontFamily: "monospace", color: T.accent, letterSpacing: 2 }}>AVAILABLE ({stakeableNfts.length})</h2>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={selectAll} style={{ background: `${T.accent}15`, border: `1px solid ${T.accent}40`, borderRadius: 6, padding: "5px 12px", color: T.accent, fontSize: 9, fontFamily: "monospace", fontWeight: 700, cursor: "pointer" }}>SELECT ALL</button>
                        <button onClick={() => setSelectedIds(new Set())} style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 12px", color: T.grayD, fontSize: 9, fontFamily: "monospace", fontWeight: 700, cursor: "pointer" }}>CLEAR</button>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                      {stakeableNfts.map(nft => {
                        const sel = selectedIds.has(nft.tokenId);
                        return (
                          <div key={nft.tokenId} onClick={() => toggleSelect(nft.tokenId)} style={{ background: T.card, borderRadius: 10, overflow: "hidden", cursor: "pointer", border: `2px solid ${sel ? T.accent : T.border}`, transition: "all 0.15s" }}>
                            <div style={{ aspectRatio: "1", position: "relative", background: T.bg }}>
                              {nft.image ? <img src={nft.image} alt={nft.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>🎨</div>}
                              {sel && <div style={{ position: "absolute", inset: 0, background: `${T.accent}20`, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontSize: 28 }}>✓</span></div>}
                            </div>
                            <div style={{ padding: "5px 7px" }}><div style={{ fontSize: 9, fontWeight: 700, fontFamily: "monospace", color: sel ? T.accent : T.white, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nft.name}</div></div>
                          </div>
                        );
                      })}
                    </div>
                    {selectedIds.size > 0 && (
                      <div style={{ position: "sticky", bottom: 16, marginTop: 16, background: `${T.bg}ee`, backdropFilter: "blur(12px)", border: `1px solid ${T.accent}40`, borderRadius: 12, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                        <div><div style={{ fontSize: 13, fontWeight: 900, fontFamily: "monospace", color: T.accent }}>{selectedIds.size} NFT{selectedIds.size > 1 ? "s" : ""}</div><div style={{ fontSize: 9, color: T.cum, fontFamily: "monospace" }}>= {selectedIds.size} $CUM/day</div></div>
                        <button onClick={handleStake} disabled={staking} style={{ background: T.accent, color: T.bg, border: "none", borderRadius: 8, padding: "10px 28px", fontSize: 13, fontWeight: 900, fontFamily: "monospace", letterSpacing: 2, cursor: staking ? "wait" : "pointer", opacity: staking ? 0.6 : 1 }}>{staking ? "SIGNING..." : "🔒 STAKE NOW"}</button>
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
            <h2 style={{ fontSize: 20, fontWeight: 900, fontFamily: "monospace", letterSpacing: 2, color: T.white, marginBottom: 6 }}>$CUM STORE</h2>
            <p style={{ fontSize: 11, fontFamily: "monospace", color: T.grayD, marginBottom: 20 }}>Spend your $CUM tickets on WL spots.</p>
            {isConnected && <div style={{ ...PS, display: "flex", gap: 16, alignItems: "center" }}><span style={{ fontSize: 22, fontWeight: 900, fontFamily: "monospace", color: T.cum }}>{cumBalance}</span><span style={{ fontSize: 10, color: T.cum, opacity: 0.6 }}>$CUM available</span></div>}
            {listings.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60 }}><div style={{ fontSize: 36 }}>🔮</div><div style={{ fontSize: 16, fontWeight: 900, fontFamily: "monospace", color: T.accent, letterSpacing: 2, marginTop: 10 }}>SOONBRIA!</div><div style={{ fontSize: 10, color: T.grayD, fontFamily: "monospace", marginTop: 6 }}>No listings yet.</div></div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
                {listings.filter(l => l.is_active && !isExpired(l.expires_at)).map(l => (
                  <div key={l.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden" }}>
                    {l.image_url && <img src={l.image_url} alt={l.title} style={{ width: "100%", height: 140, objectFit: "cover" }} />}
                    <div style={{ padding: 14 }}>
                      <h3 style={{ fontSize: 15, fontWeight: 800, fontFamily: "monospace", color: T.white, marginBottom: 4 }}>{l.title}</h3>
                      {l.description && <p style={{ fontSize: 10, color: T.gray, lineHeight: 1.6, marginBottom: 10 }}>{l.description}</p>}
                      {l.expires_at && <Countdown expiresAt={l.expires_at} />}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "10px 0" }}>
                        <div style={{ fontSize: 18, fontWeight: 900, fontFamily: "monospace", color: T.cum }}>{l.price_cum} <span style={{ fontSize: 10, opacity: 0.6 }}>$CUM</span></div>
                        <div style={{ fontSize: 10, fontFamily: "monospace", color: l.remaining_spots <= 3 ? T.burn : T.grayD }}>{l.remaining_spots}/{l.total_spots} left</div>
                      </div>
                      <div style={{ height: 3, background: T.grayK, borderRadius: 2, marginBottom: 12, overflow: "hidden" }}><div style={{ height: "100%", width: `${((l.total_spots - l.remaining_spots) / l.total_spots) * 100}%`, background: l.remaining_spots <= 3 ? T.burn : T.accent, borderRadius: 2 }} /></div>
                      {buyingId === l.id ? (
                        <div>
                          <label style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD }}>WL WALLET ADDRESS</label>
                          <input type="text" placeholder="0x..." value={wlWalletInput} onChange={e => setWlWalletInput(e.target.value)} style={{ ...inputStyle, marginBottom: 8, marginTop: 4 }} />
                          {isConnected && <button onClick={() => setWlWalletInput(address!)} style={{ background: "none", border: "none", color: T.accent, fontSize: 8, fontFamily: "monospace", cursor: "pointer", padding: 0, marginBottom: 8 }}>↑ Use connected wallet</button>}
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => handleBuy(l.id)} disabled={staking || !wlWalletInput} style={{ flex: 1, background: T.cum, color: T.bg, border: "none", borderRadius: 8, padding: "8px", fontSize: 11, fontWeight: 800, fontFamily: "monospace", cursor: "pointer" }}>CONFIRM</button>
                            <button onClick={() => { setBuyingId(null); setWlWalletInput(""); }} style={{ background: T.grayK, color: T.white, border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 11, fontFamily: "monospace", cursor: "pointer" }}>✕</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { if (!isConnected) { showMsg("Connect wallet first", "err"); return; } if (cumBalance < l.price_cum) { showMsg(`Need ${l.price_cum} $CUM`, "err"); return; } setBuyingId(l.id); }} disabled={l.remaining_spots <= 0} style={{ width: "100%", background: l.remaining_spots <= 0 ? T.grayK : T.accent, color: T.bg, border: "none", borderRadius: 8, padding: "10px", fontSize: 12, fontWeight: 900, fontFamily: "monospace", letterSpacing: 1, cursor: l.remaining_spots <= 0 ? "not-allowed" : "pointer" }}>{l.remaining_spots <= 0 ? "SOLD OUT" : "BUY WL SPOT"}</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {myPurchases.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <h3 style={{ fontSize: 13, fontWeight: 900, fontFamily: "monospace", color: T.white, letterSpacing: 2, marginBottom: 10 }}>YOUR PURCHASES</h3>
                <div style={PS}>{myPurchases.map((p, i) => (<div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < myPurchases.length - 1 ? `1px solid ${T.border}` : "none", fontSize: 10, fontFamily: "monospace", flexWrap: "wrap", gap: 6 }}><span style={{ color: T.white, fontWeight: 700 }}>{(p as any).store_listings?.title || `#${p.listing_id}`}</span><span style={{ color: T.grayD }}>WL: {shortAddr(p.wl_wallet)}</span><span style={{ color: T.cum, fontWeight: 700 }}>{p.cum_spent} $CUM</span></div>))}</div>
              </div>
            )}
          </>
        )}

        {/* ═══════════════ BURN TAB ═══════════════ */}
        {tab === "burn" && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 900, fontFamily: "monospace", letterSpacing: 2, color: T.white, marginBottom: 6 }}>🔥 BURN REWARDS</h2>
            <p style={{ fontSize: 11, fontFamily: "monospace", color: T.grayD, marginBottom: 16 }}>Burn Cambrilios permanently for exclusive rewards. Supports bulk transfers.</p>
            <div style={{ ...PS, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, fontFamily: "monospace", color: T.grayD }}>BURN ADDRESS:</span>
              <code style={{ fontSize: 11, fontFamily: "monospace", color: T.burn, background: `${T.burn}10`, padding: "3px 8px", borderRadius: 6, border: `1px solid ${T.burn}20`, wordBreak: "break-all" }}>0x000000000000000000000000000000000000dEaD</code>
              <button onClick={() => navigator.clipboard.writeText("0x000000000000000000000000000000000000dEaD")} style={{ background: `${T.burn}15`, border: `1px solid ${T.burn}30`, borderRadius: 6, padding: "3px 8px", color: T.burn, fontSize: 8, fontFamily: "monospace", fontWeight: 700, cursor: "pointer" }}>COPY</button>
            </div>
            {burnRewards.filter(r => r.is_active && !isExpired(r.expires_at)).length === 0 ? (
              <div style={{ textAlign: "center", padding: 60 }}><div style={{ fontSize: 36 }}>🔮</div><div style={{ fontSize: 16, fontWeight: 900, fontFamily: "monospace", color: T.accent, letterSpacing: 2, marginTop: 10 }}>SOONBRIA!</div></div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
                {burnRewards.filter(r => r.is_active && !isExpired(r.expires_at)).map(reward => {
                  const isActive = activeBurnId === reward.id;
                  const myClaim = burnClaims.find(c => c.reward_id === reward.id);
                  const txInputs = burnTxInputs[reward.id] || [""];
                  const isSoldOut = reward.remaining_supply <= 0;
                  const isClaimed = !!myClaim;
                  return (
                    <div key={reward.id} style={{ background: T.card, border: `1px solid ${isClaimed ? T.success + "40" : T.border}`, borderRadius: 14, overflow: "hidden" }}>
                      {reward.image_url && <img src={reward.image_url} alt={reward.title} style={{ width: "100%", height: 180, objectFit: "cover" }} />}
                      <div style={{ padding: 16 }}>
                        <h3 style={{ fontSize: 15, fontWeight: 900, fontFamily: "monospace", color: T.white, marginBottom: 6 }}>{reward.title}</h3>
                        {reward.description && <p style={{ fontSize: 10, color: T.gray, lineHeight: 1.6, marginBottom: 10 }}>{reward.description}</p>}
                        {reward.expires_at && <div style={{ marginBottom: 10 }}><Countdown expiresAt={reward.expires_at} /></div>}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                          <div><div style={{ fontSize: 8, fontFamily: "monospace", color: T.grayD }}>BURN COST</div><div style={{ fontSize: 20, fontWeight: 900, fontFamily: "monospace", color: T.burn }}>{reward.burn_cost} <span style={{ fontSize: 10, opacity: 0.7 }}>NFTs</span></div></div>
                          <div style={{ textAlign: "right" }}><div style={{ fontSize: 8, fontFamily: "monospace", color: T.grayD }}>AVAILABLE</div><div style={{ fontSize: 14, fontWeight: 900, fontFamily: "monospace", color: reward.remaining_supply <= 1 ? T.burn : T.accent }}>{reward.remaining_supply}/{reward.total_supply}</div></div>
                        </div>
                        <div style={{ height: 3, background: T.grayK, borderRadius: 2, marginBottom: 14, overflow: "hidden" }}><div style={{ height: "100%", width: `${((reward.total_supply - reward.remaining_supply) / reward.total_supply) * 100}%`, background: reward.remaining_supply <= 1 ? T.burn : T.accent, borderRadius: 2 }} /></div>
                        {isClaimed && <div style={{ padding: "8px 12px", borderRadius: 8, marginBottom: 10, background: myClaim.status === "delivered" ? `${T.success}15` : `${T.sweep}15`, border: `1px solid ${myClaim.status === "delivered" ? T.success : T.sweep}30` }}><div style={{ fontSize: 10, fontWeight: 800, fontFamily: "monospace", color: myClaim.status === "delivered" ? T.success : T.sweep }}>{myClaim.status === "delivered" ? "✅ DELIVERED" : "⏳ AWAITING DELIVERY"}</div><div style={{ fontSize: 8, fontFamily: "monospace", color: T.grayD, marginTop: 3 }}>Burned: {myClaim.token_ids.map(id => `#${id}`).join(", ")}</div></div>}
                        {!isClaimed && !isSoldOut && isConnected && (
                          isActive ? (
                            <div>
                              <div style={{ fontSize: 9, fontFamily: "monospace", color: T.gray, marginBottom: 8, padding: "6px 8px", background: T.bgS, borderRadius: 6, border: `1px solid ${T.border}`, lineHeight: 1.7 }}>1. Transfer {reward.burn_cost} NFTs to <span style={{ color: T.burn }}>0x...dEaD</span><br />2. Paste TX hash(es) below (bulk OK)</div>
                              {txInputs.map((val, i) => (
                                <div key={i} style={{ display: "flex", gap: 4, marginBottom: 4, alignItems: "center" }}>
                                  <input type="text" placeholder={`0x... (TX #${i + 1})`} value={val} onChange={e => updateBurnTxInput(reward.id, i, e.target.value)} style={{ ...inputStyle, border: `1px solid ${val && val.startsWith("0x") && val.length === 66 ? T.success + "40" : T.border}` }} />
                                  {txInputs.length > 1 && <button onClick={() => removeTxField(reward.id, i)} style={{ background: `${T.burn}15`, border: `1px solid ${T.burn}30`, borderRadius: 6, padding: "6px 8px", color: T.burn, fontSize: 10, cursor: "pointer", fontFamily: "monospace" }}>✕</button>}
                                </div>
                              ))}
                              <button onClick={() => addTxField(reward.id)} style={{ background: "none", border: `1px dashed ${T.border}`, borderRadius: 6, padding: "5px", width: "100%", color: T.grayD, fontSize: 8, fontFamily: "monospace", cursor: "pointer", marginBottom: 10 }}>+ Add TX hash</button>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button onClick={() => handleBurnSubmit(reward.id)} disabled={submittingBurn} style={{ flex: 1, background: T.burn, color: T.white, border: "none", borderRadius: 8, padding: "9px", fontSize: 11, fontWeight: 800, fontFamily: "monospace", cursor: "pointer", opacity: submittingBurn ? 0.6 : 1 }}>{submittingBurn ? "VERIFYING..." : "🔥 SUBMIT PROOF"}</button>
                                <button onClick={() => setActiveBurnId(null)} style={{ background: T.grayK, color: T.white, border: "none", borderRadius: 8, padding: "9px 14px", fontSize: 11, fontFamily: "monospace", cursor: "pointer" }}>✕</button>
                              </div>
                            </div>
                          ) : (
                            <button onClick={() => { setActiveBurnId(reward.id); setBurnTxInputs(p => ({ ...p, [reward.id]: p[reward.id] || [""] })); }} style={{ width: "100%", background: `${T.burn}15`, border: `1px solid ${T.burn}40`, borderRadius: 8, padding: "10px", fontSize: 12, fontWeight: 900, fontFamily: "monospace", color: T.burn, cursor: "pointer", letterSpacing: 1 }}>🔥 BURN {reward.burn_cost} NFTs TO CLAIM</button>
                          )
                        )}
                        {!isConnected && !isSoldOut && !isClaimed && <div style={{ textAlign: "center", padding: 8, fontSize: 10, fontFamily: "monospace", color: T.grayD }}>Connect wallet to claim</div>}
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
            <h2 style={{ fontSize: 20, fontWeight: 900, fontFamily: "monospace", letterSpacing: 2, color: T.white, marginBottom: 6 }}>STAKING LEADERBOARD</h2>
            <p style={{ fontSize: 11, fontFamily: "monospace", color: T.grayD, marginBottom: 20 }}>More staked = more $CUM/day</p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20, padding: "14px 16px", background: T.bgS, border: `1px solid ${T.border}`, borderRadius: 12 }}>
              {[{ label: "STAKERS", value: globalStats.totalStakers, color: T.white }, { label: "NFTs STAKED", value: globalStats.totalNFTsStaked, color: T.accent }, { label: "$CUM/DAY", value: globalStats.totalNFTsStaked, color: T.cum }].map((s, i) => (<div key={i}><div style={{ fontSize: 8, fontFamily: "monospace", color: T.grayD, letterSpacing: 1.5, fontWeight: 700 }}>{s.label}</div><div style={{ fontSize: 20, fontWeight: 900, fontFamily: "monospace", color: s.color }}>{s.value}</div></div>))}
            </div>
            {leaderboard.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60 }}><div style={{ fontSize: 36 }}>🔮</div><div style={{ fontSize: 16, fontWeight: 900, fontFamily: "monospace", color: T.accent, letterSpacing: 2, marginTop: 10 }}>SOONBRIA!</div></div>
            ) : (
              <div style={{ background: T.bgS, border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "40px 1fr 70px 70px", padding: "10px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 8, fontFamily: "monospace", color: T.grayD, letterSpacing: 1.5, fontWeight: 700 }}><span>#</span><span>WALLET</span><span style={{ textAlign: "right" }}>STAKED</span><span style={{ textAlign: "right" }}>$CUM/D</span></div>
                {leaderboard.map((e, i) => { const isMe = address && e.wallet.toLowerCase() === address.toLowerCase(); return (
                  <div key={e.wallet} style={{ display: "grid", gridTemplateColumns: "40px 1fr 70px 70px", padding: "10px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontFamily: "monospace", background: isMe ? `${T.accent}08` : "transparent" }}>
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

        {/* ═══════════════ ADMIN TAB ═══════════════ */}
        {tab === "admin" && isAdmin && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 900, fontFamily: "monospace", letterSpacing: 2, color: T.white, marginBottom: 20 }}>ADMIN PANEL</h2>

            {/* Stake toggle */}
            <div style={{ ...PS, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div><div style={{ fontSize: 12, fontWeight: 800, fontFamily: "monospace", color: T.white }}>STAKING</div><div style={{ fontSize: 9, color: T.grayD, fontFamily: "monospace" }}>Enable or disable new stakes</div></div>
              <button onClick={toggleStakeEnabled} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: stakeEnabled ? T.success : T.burn, color: T.bg, fontSize: 11, fontWeight: 900, fontFamily: "monospace", cursor: "pointer", letterSpacing: 1 }}>{stakeEnabled ? "ON ✓" : "OFF ✕"}</button>
            </div>

            {/* Create store listing */}
            <div style={PS}>
              <h3 style={{ fontSize: 13, fontWeight: 800, fontFamily: "monospace", color: T.accent, letterSpacing: 2, marginBottom: 12 }}>CREATE STORE LISTING</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><label style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD }}>TITLE *</label><input value={newListing.title} onChange={e => setNewListing(p => ({ ...p, title: e.target.value }))} style={inputStyle} placeholder="Project WL" /></div>
                <div><label style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD }}>PROJECT URL</label><input value={newListing.projectUrl} onChange={e => setNewListing(p => ({ ...p, projectUrl: e.target.value }))} style={inputStyle} placeholder="https://..." /></div>
                <div style={{ gridColumn: "1 / -1" }}><label style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD }}>DESCRIPTION</label><input value={newListing.description} onChange={e => setNewListing(p => ({ ...p, description: e.target.value }))} style={inputStyle} /></div>
                <div><label style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD }}>IMAGE URL</label><input value={newListing.imageUrl} onChange={e => setNewListing(p => ({ ...p, imageUrl: e.target.value }))} style={inputStyle} /></div>
                <div><label style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD }}>EXPIRES AT</label><input type="datetime-local" value={newListing.expiresAt} onChange={e => setNewListing(p => ({ ...p, expiresAt: e.target.value }))} style={inputStyle} /></div>
                <div><label style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD }}>PRICE ($CUM) *</label><input type="number" value={newListing.priceCum} onChange={e => setNewListing(p => ({ ...p, priceCum: e.target.value }))} style={inputStyle} /></div>
                <div><label style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD }}>SPOTS *</label><input type="number" value={newListing.totalSpots} onChange={e => setNewListing(p => ({ ...p, totalSpots: e.target.value }))} style={inputStyle} /></div>
              </div>
              <button onClick={handleCreateListing} disabled={!newListing.title} style={{ marginTop: 12, background: T.accent, color: T.bg, border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 11, fontWeight: 800, fontFamily: "monospace", cursor: "pointer" }}>CREATE LISTING</button>
            </div>

            {/* Manage store listings */}
            {adminData?.listings?.length > 0 && (
              <div style={PS}>
                <h3 style={{ fontSize: 13, fontWeight: 800, fontFamily: "monospace", color: T.white, letterSpacing: 2, marginBottom: 12 }}>STORE LISTINGS</h3>
                {adminData.listings.map((l: any) => (
                  <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${T.border}`, fontSize: 10, fontFamily: "monospace", flexWrap: "wrap", gap: 6 }}>
                    <div><span style={{ color: T.white, fontWeight: 700 }}>{l.title}</span>{!l.is_active && <span style={{ color: T.burn, fontSize: 8, marginLeft: 6 }}>(OFF)</span>}<div style={{ fontSize: 8, color: T.grayD }}>Price: {l.price_cum} $CUM • {l.remaining_spots}/{l.total_spots} left</div></div>
                    {l.is_active && <button onClick={() => handleDeleteListing(l.id, l.title)} style={{ background: `${T.burn}15`, border: `1px solid ${T.burn}40`, borderRadius: 6, padding: "4px 10px", color: T.burn, fontSize: 8, fontFamily: "monospace", fontWeight: 700, cursor: "pointer" }}>🗑 DELETE</button>}
                  </div>
                ))}
              </div>
            )}

            {/* Create burn reward */}
            <div style={PS}>
              <h3 style={{ fontSize: 13, fontWeight: 800, fontFamily: "monospace", color: T.burn, letterSpacing: 2, marginBottom: 12 }}>🔥 CREATE BURN REWARD</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><label style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD }}>TITLE *</label><input value={newBurnReward.title} onChange={e => setNewBurnReward(p => ({ ...p, title: e.target.value }))} style={inputStyle} placeholder="White Party Hat 1/1" /></div>
                <div><label style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD }}>IMAGE URL</label><input value={newBurnReward.imageUrl} onChange={e => setNewBurnReward(p => ({ ...p, imageUrl: e.target.value }))} style={inputStyle} /></div>
                <div style={{ gridColumn: "1 / -1" }}><label style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD }}>DESCRIPTION</label><input value={newBurnReward.description} onChange={e => setNewBurnReward(p => ({ ...p, description: e.target.value }))} style={inputStyle} /></div>
                <div><label style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD }}>EXPIRES AT</label><input type="datetime-local" value={newBurnReward.expiresAt} onChange={e => setNewBurnReward(p => ({ ...p, expiresAt: e.target.value }))} style={inputStyle} /></div>
                <div><label style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD }}>BURN COST (NFTs) *</label><input type="number" value={newBurnReward.burnCost} onChange={e => setNewBurnReward(p => ({ ...p, burnCost: e.target.value }))} style={inputStyle} /></div>
                <div><label style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD }}>SUPPLY *</label><input type="number" value={newBurnReward.totalSupply} onChange={e => setNewBurnReward(p => ({ ...p, totalSupply: e.target.value }))} style={inputStyle} /></div>
              </div>
              <button onClick={handleCreateBurnReward} disabled={!newBurnReward.title} style={{ marginTop: 12, background: T.burn, color: T.white, border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 11, fontWeight: 800, fontFamily: "monospace", cursor: "pointer" }}>🔥 CREATE BURN REWARD</button>
            </div>

            {/* Manage burn rewards */}
            {burnRewards.length > 0 && (
              <div style={PS}>
                <h3 style={{ fontSize: 13, fontWeight: 800, fontFamily: "monospace", color: T.white, letterSpacing: 2, marginBottom: 12 }}>BURN REWARDS</h3>
                {burnRewards.map(r => (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${T.border}`, fontSize: 10, fontFamily: "monospace", flexWrap: "wrap", gap: 6 }}>
                    <div><span style={{ color: T.white, fontWeight: 700 }}>{r.title}</span>{!r.is_active && <span style={{ color: T.burn, fontSize: 8, marginLeft: 6 }}>(OFF)</span>}<div style={{ fontSize: 8, color: T.grayD }}>Cost: {r.burn_cost} NFTs • {r.remaining_supply}/{r.total_supply} left</div></div>
                    {r.is_active && <button onClick={() => handleDeleteBurnReward(r.id, r.title)} style={{ background: `${T.burn}15`, border: `1px solid ${T.burn}40`, borderRadius: 6, padding: "4px 10px", color: T.burn, fontSize: 8, fontFamily: "monospace", fontWeight: 700, cursor: "pointer" }}>🗑 DELETE</button>}
                  </div>
                ))}
              </div>
            )}

            {/* All burn claims */}
            {allBurnClaims.length > 0 && (
              <div style={PS}>
                <h3 style={{ fontSize: 13, fontWeight: 800, fontFamily: "monospace", color: T.white, letterSpacing: 2, marginBottom: 12 }}>BURN CLAIMS ({allBurnClaims.length})</h3>
                {allBurnClaims.map(claim => (
                  <div key={claim.id} style={{ padding: "12px 0", borderBottom: `1px solid ${T.border}`, fontSize: 10, fontFamily: "monospace" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexWrap: "wrap", gap: 6 }}>
                      <span style={{ color: T.white, fontWeight: 700 }}>{(claim as any).burn_rewards?.title || `#${claim.reward_id}`}</span>
                      <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 8, fontWeight: 800, background: claim.status === "delivered" ? `${T.success}20` : claim.status === "rejected" ? `${T.burn}20` : `${T.sweep}20`, color: claim.status === "delivered" ? T.success : claim.status === "rejected" ? T.burn : T.sweep }}>{claim.status.toUpperCase()}</span>
                    </div>
                    <div style={{ fontSize: 8, color: T.grayD }}>Wallet: <span style={{ color: T.accent }}>{claim.wallet_address}</span> <button onClick={() => navigator.clipboard.writeText(claim.wallet_address)} style={{ background: "none", border: "none", color: T.grayD, fontSize: 8, cursor: "pointer" }}>📋</button></div>
                    <div style={{ fontSize: 8, color: T.grayD }}>Burned: {claim.token_ids.map(id => `#${id}`).join(", ")}</div>
                    <div style={{ fontSize: 8, color: T.grayD }}>TXs: {claim.tx_hashes.map(h => <a key={h} href={`https://basescan.org/tx/${h}`} target="_blank" rel="noopener noreferrer" style={{ color: T.sweep, marginRight: 6 }}>{h.slice(0, 12)}...↗</a>)}</div>
                    {(claim.status === "verified" || claim.status === "pending") && (
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <button onClick={() => handleUpdateBurnClaim(claim.id, "delivered")} style={{ background: `${T.success}15`, border: `1px solid ${T.success}40`, borderRadius: 6, padding: "4px 10px", color: T.success, fontSize: 8, fontFamily: "monospace", fontWeight: 700, cursor: "pointer" }}>✅ DELIVERED</button>
                        <button onClick={() => handleUpdateBurnClaim(claim.id, "rejected")} style={{ background: `${T.burn}15`, border: `1px solid ${T.burn}40`, borderRadius: 6, padding: "4px 10px", color: T.burn, fontSize: 8, fontFamily: "monospace", fontWeight: 700, cursor: "pointer" }}>❌ REJECT</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* WL Export */}
            {adminData?.purchases?.length > 0 && (
              <div style={PS}>
                <h3 style={{ fontSize: 13, fontWeight: 800, fontFamily: "monospace", color: T.white, letterSpacing: 2, marginBottom: 12 }}>WL PURCHASES ({adminData.purchases.length})</h3>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "monospace" }}>
                    <thead><tr style={{ borderBottom: `1px solid ${T.border}` }}><th style={{ textAlign: "left", padding: 6, color: T.grayD, fontWeight: 700 }}>LISTING</th><th style={{ textAlign: "left", padding: 6, color: T.grayD, fontWeight: 700 }}>WL WALLET</th><th style={{ textAlign: "right", padding: 6, color: T.grayD, fontWeight: 700 }}>$CUM</th></tr></thead>
                    <tbody>{adminData.purchases.map((p: any) => (<tr key={p.id} style={{ borderBottom: `1px solid ${T.border}` }}><td style={{ padding: 6, color: T.white }}>{p.store_listings?.title || p.listing_id}</td><td style={{ padding: 6, color: T.accent, fontWeight: 700, wordBreak: "break-all" }}>{p.wl_wallet}</td><td style={{ padding: 6, color: T.cum, textAlign: "right" }}>{p.cum_spent}</td></tr>))}</tbody>
                  </table>
                </div>
                <button onClick={() => { const csv = "Listing,Buyer,WL Wallet,$CUM,Date\n" + adminData.purchases.map((p: any) => `"${p.store_listings?.title || p.listing_id}","${p.buyer_wallet}","${p.wl_wallet}",${p.cum_spent},"${new Date(p.purchased_at).toISOString()}"`).join("\n"); const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "cambrilio-wl-export.csv"; a.click(); }} style={{ marginTop: 10, background: `${T.accent}15`, border: `1px solid ${T.accent}40`, borderRadius: 6, padding: "6px 14px", color: T.accent, fontSize: 9, fontFamily: "monospace", fontWeight: 700, cursor: "pointer" }}>📥 EXPORT CSV</button>
              </div>
            )}
          </>
        )}

        {/* FOOTER */}
        <div style={{ textAlign: "center", padding: "30px 0 0", borderTop: `1px solid ${T.border}`, marginTop: 24 }}>
          <div style={{ fontSize: 8, fontFamily: "monospace", color: T.grayD, letterSpacing: 2, lineHeight: 2 }}>CAMBRILIO SOFT STAKE • BASE • 1 NFT = 1 $CUM/DAY<br />NFTs never leave your wallet</div>
        </div>
      </div>
    </div>
  );
}
