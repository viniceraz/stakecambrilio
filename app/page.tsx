"use client";

import { useState, useEffect, useCallback } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSignMessage } from "wagmi";
import { getOwnedCambrilios, checkListedClient, OwnedNFT } from "@/lib/blockchain";
import { supabase } from "@/lib/supabase";

const T = {
  bg: "#06060b", bgS: "#0b0b14", card: "#0e0e18", cardH: "#121220",
  border: "#1a1a2c", accent: "#c8ff00", burn: "#ff4444",
  sweep: "#00e5ff", gold: "#ffd700", weth: "#627eea",
  listed: "#ff6b6b", white: "#f0f0f5", gray: "#8888a0",
  grayD: "#55556a", grayK: "#333345", success: "#00ff88",
  cum: "#f0c040",
};

interface LeaderEntry { wallet: string; staked: number; winChance: string; balance: number; earned: number; }
interface StoreListing { id: number; title: string; description: string; image_url: string; project_url: string; price_cum: number; total_spots: number; remaining_spots: number; is_active: boolean; created_at: string; }
interface Purchase { id: number; listing_id: number; buyer_wallet: string; wl_wallet: string; cum_spent: number; purchased_at: string; store_listings?: { title: string }; }

interface BurnReward {
  id: number;
  title: string;
  description: string;
  image_url: string;
  burn_cost: number;
  total_supply: number;
  remaining_supply: number;
  is_active: boolean;
}

interface BurnClaim {
  id: number;
  reward_id: number;
  wallet_address: string;
  token_ids: string[];
  tx_hashes: string[];
  status: string;
  admin_notes: string;
  submitted_at: string;
  verified_at: string;
  delivered_at: string;
  burn_rewards?: { title: string; image_url: string };
}

export default function StakePage() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [tab, setTab] = useState<"store" | "burn" | "dashboard" | "admin">("store");
  const [ownedNfts, setOwnedNfts] = useState<OwnedNFT[]>([]);
  const [listedIds, setListedIds] = useState<Set<string>>(new Set());
  const [stakedIds, setStakedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [staking, setStaking] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState<"ok" | "err">("ok");

  // $CUM balance
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

  // Dashboard
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>([]);
  const [globalStats, setGlobalStats] = useState({ totalStakers: 0, totalNFTsStaked: 0, totalTickets: 0 });

  // Admin
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminData, setAdminData] = useState<any>(null);
  const [newListing, setNewListing] = useState({ title: "", description: "", imageUrl: "", projectUrl: "", priceCum: "5", totalSpots: "20" });

  // Burn
  const [burnRewards, setBurnRewards] = useState<BurnReward[]>([]);
  const [burnClaims, setBurnClaims] = useState<BurnClaim[]>([]);
  const [burnTxInputs, setBurnTxInputs] = useState<Record<number, string[]>>({});
  const [activeBurnId, setActiveBurnId] = useState<number | null>(null);
  const [submittingBurn, setSubmittingBurn] = useState(false);
  // Admin burn
  const [newBurnReward, setNewBurnReward] = useState({ title: "", description: "", imageUrl: "", burnCost: "10", totalSupply: "1" });
  const [allBurnClaims, setAllBurnClaims] = useState<BurnClaim[]>([]);

  const showMsg = (text: string, type: "ok" | "err" = "ok") => { setMsg(text); setMsgType(type); setTimeout(() => setMsg(""), 5000); };

  // Load user data
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
      if (nfts.length > 0) {
        const listed = await checkListedClient(nfts.map(n => n.tokenId));
        setListedIds(listed);
      }
      // Load balance
      const balRes = await fetch(`/api/balance?wallet=${address}`);
      const bal = await balRes.json();
      setCumBalance(bal.balance || 0);
      setCumPending(bal.pendingCum || 0);
      setCumEarned(bal.totalEarned || 0);
      setCumSpent(bal.totalSpent || 0);
      setCumRate(bal.ratePerDay || 0);
      setMyPurchases(bal.purchases || []);
      // Check admin
      const { data: adm } = await supabase.from("admins").select("wallet_address").eq("wallet_address", address.toLowerCase()).single();
      setIsAdmin(!!adm);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [address]);

  const loadLeaderboard = useCallback(async () => {
    try {
      const res = await fetch("/api/leaderboard");
      const data = await res.json();
      setLeaderboard(data.leaderboard || []);
      setGlobalStats(data.stats || { totalStakers: 0, totalNFTsStaked: 0, totalTickets: 0 });
    } catch {}
  }, []);

  const loadStore = useCallback(async () => {
    try {
      const res = await fetch("/api/store");
      const data = await res.json();
      setListings(data.listings || []);
    } catch {}
  }, []);

  const loadAdminData = useCallback(async () => {
    if (!address || !isAdmin) return;
    try {
      const res = await fetch(`/api/admin?wallet=${address}`);
      const data = await res.json();
      setAdminData(data);
    } catch {}
  }, [address, isAdmin]);

  const loadBurnData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (address) params.set("wallet", address);
      if (isAdmin) params.set("admin", "true");
      const res = await fetch(`/api/burn?${params}`);
      const data = await res.json();
      setBurnRewards(data.rewards || []);
      setBurnClaims(data.claims || []);
      setAllBurnClaims(data.allClaims || []);
    } catch {}
  }, [address, isAdmin]);

  useEffect(() => { loadLeaderboard(); loadStore(); loadBurnData(); fetch("/api/verify", { method: "POST" }).catch(() => {}); }, [loadBurnData]);
  useEffect(() => { if (isConnected && address) loadUserData(); }, [isConnected, address, loadUserData]);
  useEffect(() => { 
    if (isAdmin && tab === "admin") {
      loadAdminData();
      loadBurnData();
    }
  }, [isAdmin, tab, loadAdminData, loadBurnData]);

  // Stake
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
    if (!address) return;
    setStaking(true);
    try {
      const res = await fetch("/api/unstake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: address, tokenIds }) });
      const data = await res.json();
      if (data.success) { showMsg(`Unstaked. ${data.remaining} remaining.`); await loadUserData(); await loadLeaderboard(); }
    } catch (err: any) { showMsg(err.message, "err"); }
    finally { setStaking(false); }
  };

  // Claim $CUM
  const handleClaim = async () => {
    if (!address) return;
    setClaiming(true);
    try {
      const res = await fetch("/api/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: address }) });
      const data = await res.json();
      if (data.success) { showMsg(`Claimed ${data.claimed} $CUM! Balance: ${data.balance}`); await loadUserData(); }
      else showMsg(data.error, "err");
    } catch (err: any) { showMsg(err.message, "err"); }
    finally { setClaiming(false); }
  };

  // Buy WL
  const handleBuy = async (listingId: number) => {
    if (!address || !wlWalletInput) return;
    setStaking(true);
    try {
      const res = await fetch("/api/store", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: address, listingId, wlWallet: wlWalletInput }) });
      const data = await res.json();
      if (data.success) { showMsg(`WL purchased for ${data.wlWallet}! Spent ${data.spent} $CUM`); setBuyingId(null); setWlWalletInput(""); await loadUserData(); await loadStore(); }
      else showMsg(data.error, "err");
    } catch (err: any) { showMsg(err.message, "err"); }
    finally { setStaking(false); }
  };

  // Admin: create listing
  const handleCreateListing = async () => {
    if (!address) return;
    try {
      const res = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: address, ...newListing }) });
      const data = await res.json();
      if (data.success) { showMsg(`Listing "${data.listing.title}" created!`); setNewListing({ title: "", description: "", imageUrl: "", projectUrl: "", priceCum: "5", totalSpots: "20" }); await loadStore(); await loadAdminData(); }
      else showMsg(data.error, "err");
    } catch (err: any) { showMsg(err.message, "err"); }
  };

  // Burn
  const handleBurnSubmit = async (rewardId: number) => {
    if (!address) return;
    const txs = (burnTxInputs[rewardId] || []).filter(t => t.trim().length > 0);

    if (txs.length === 0) {
      showMsg("Paste at least one transaction hash", "err");
      return;
    }

    // Validate format
    const invalid = txs.find(t => !t.trim().startsWith("0x") || t.trim().length !== 66);
    if (invalid) {
      showMsg("Invalid TX hash format. Must start with 0x and be 66 characters.", "err");
      return;
    }

    setSubmittingBurn(true);
    try {
      const res = await fetch("/api/burn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: address,
          rewardId,
          txHashes: txs.map(t => t.trim()),
        }),
      });
      const data = await res.json();
      if (data.success) {
        showMsg(data.message || "Burn verified!");
        setActiveBurnId(null);
        setBurnTxInputs(p => ({ ...p, [rewardId]: [] }));
        await loadBurnData();
      } else {
        showMsg(data.error, "err");
      }
    } catch (err: any) { showMsg(err.message, "err"); }
    finally { setSubmittingBurn(false); }
  };

  const handleCreateBurnReward = async () => {
    if (!address) return;
    try {
      const res = await fetch("/api/burn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_reward",
          wallet: address,
          ...newBurnReward,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showMsg(`Burn reward "${data.reward.title}" created!`);
        setNewBurnReward({ title: "", description: "", imageUrl: "", burnCost: "10", totalSupply: "1" });
        await loadBurnData();
      } else showMsg(data.error, "err");
    } catch (err: any) { showMsg(err.message, "err"); }
  };

  const handleDeleteBurnReward = async (rewardId: number, title: string) => {
    if (!address || !confirm(`Delete "${title}"? This cannot be undone.`)) return;
    try {
      const res = await fetch("/api/burn", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, rewardId }),
      });
      const data = await res.json();
      if (data.success) {
        showMsg(`Reward ${data.method === "deleted" ? "deleted" : "deactivated"}`);
        await loadBurnData();
      } else showMsg(data.error, "err");
    } catch (err: any) { showMsg(err.message, "err"); }
  };

  const handleUpdateBurnClaim = async (claimId: number, status: string) => {
    if (!address) return;
    try {
      const res = await fetch("/api/burn", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, claimId, status }),
      });
      const data = await res.json();
      if (data.success) { showMsg(`Claim updated to ${status}`); await loadBurnData(); }
      else showMsg(data.error, "err");
    } catch (err: any) { showMsg(err.message, "err"); }
  };

  const addTxField = (rewardId: number) => {
    setBurnTxInputs(prev => {
      const arr = [...(prev[rewardId] || [""])];
      arr.push("");
      return { ...prev, [rewardId]: arr };
    });
  };

  const removeTxField = (rewardId: number, index: number) => {
    setBurnTxInputs(prev => {
      const arr = [...(prev[rewardId] || [])];
      arr.splice(index, 1);
      if (arr.length === 0) arr.push("");
      return { ...prev, [rewardId]: arr };
    });
  };

  const updateBurnTxInput = (rewardId: number, index: number, value: string) => {
    setBurnTxInputs(prev => {
      const arr = [...(prev[rewardId] || [""])];
      arr[index] = value;
      return { ...prev, [rewardId]: arr };
    });
  };

  const toggleSelect = (id: string) => setSelectedIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = () => setSelectedIds(new Set(ownedNfts.filter(n => !stakedIds.has(n.tokenId) && !listedIds.has(n.tokenId)).map(n => n.tokenId)));
  const stakeableNfts = ownedNfts.filter(n => !stakedIds.has(n.tokenId) && !listedIds.has(n.tokenId));
  const stakedNfts = ownedNfts.filter(n => stakedIds.has(n.tokenId));
  const listedNfts = ownedNfts.filter(n => listedIds.has(n.tokenId));

  const PS = { background: T.bgS, border: `1px solid ${T.border}`, borderRadius: 14, padding: 20, marginBottom: 20 };
  const inputStyle = { width: "100%", background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px", color: T.white, fontSize: 12, fontFamily: "monospace", outline: "none" };

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.white, fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* NAV */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: `${T.bg}ee`, backdropFilter: "blur(12px)", borderBottom: `1px solid ${T.border}`, padding: "0 24px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60, gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src="/logo 2.png" alt="Logo" style={{ height: 22, width: 'auto' }} />
            <span style={{ fontSize: 18, fontWeight: 900, fontFamily: "monospace", letterSpacing: 3, color: T.accent }}>CAMBRILIO</span>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            {["store", "burn", "dashboard", ...(isAdmin ? ["admin"] : [])].map(t => (
              <button key={t} onClick={() => setTab(t as any)} style={{
                background: "none", border: "none", cursor: "pointer",
                color: tab === t ? T.accent : T.grayD, fontSize: 11, fontWeight: 800,
                fontFamily: "monospace", letterSpacing: 2,
                borderBottom: tab === t ? `2px solid ${T.accent}` : "2px solid transparent", padding: "8px 0",
              }}>▸{t.toUpperCase()}</button>
            ))}
            {isConnected && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 12px", background: `${T.cum}15`, border: `1px solid ${T.cum}30`, borderRadius: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 900, fontFamily: "monospace", color: T.cum }}>{cumBalance}</span>
                <span style={{ fontSize: 9, fontFamily: "monospace", color: T.cum, opacity: 0.7 }}>$CUM</span>
              </div>
            )}
            <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
          </div>
        </div>
      </nav>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "30px 20px 60px" }}>
        {/* Message */}
        {msg && (
          <div style={{ padding: "12px 16px", marginBottom: 16, borderRadius: 8, background: msgType === "err" ? `${T.burn}15` : `${T.success}15`, border: `1px solid ${msgType === "err" ? T.burn : T.success}30`, color: msgType === "err" ? T.burn : T.success, fontSize: 12, fontFamily: "monospace" }}>{msg}</div>
        )}

        {/* Welcome section when not connected */}
        {!isConnected && (
          <div style={{ textAlign: "center", padding: "80px 20px", marginBottom: 40 }}>
            <div style={{ fontSize: 48, marginBottom: 20 }}>🔥</div>
            <h1 style={{ fontSize: 32, fontWeight: 900, fontFamily: "monospace", letterSpacing: 3, marginBottom: 12, color: T.accent }}>WELCOME TO CAMBRILIO</h1>
            <p style={{ fontSize: 14, color: T.gray, maxWidth: 500, margin: "0 auto 16px", lineHeight: 1.8 }}>
              Connect your wallet to access the store, burn rewards, and dashboard.
            </p>
            <p style={{ fontSize: 12, color: T.grayD, fontFamily: "monospace", marginBottom: 30 }}>Stake your NFTs to earn $CUM tickets!</p>
            <ConnectButton />
          </div>
        )}

        {/* ═══ STAKE TAB ═══ */}
        {false && (
          <>
            {!isConnected ? (
              <div style={{ textAlign: "center", padding: "80px 20px" }}>
                <div style={{ fontSize: 48, marginBottom: 20 }}>🔥</div>
                <h1 style={{ fontSize: 32, fontWeight: 900, fontFamily: "monospace", letterSpacing: 3, marginBottom: 12, color: T.accent }}>SOFT STAKE</h1>
                <p style={{ fontSize: 14, color: T.gray, maxWidth: 500, margin: "0 auto 16px", lineHeight: 1.8 }}>
                  Stake your Cambrilios without leaving your wallet. Earn <span style={{ color: T.cum, fontWeight: 700 }}>$CUM tickets</span> every 24 hours. Spend them in the store for WL spots.
                </p>
                <p style={{ fontSize: 12, color: T.grayD, fontFamily: "monospace", marginBottom: 30 }}>1 staked NFT = 1 $CUM / day</p>
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
                <div style={{ ...PS, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 10, fontFamily: "monospace", color: T.grayD, letterSpacing: 2, fontWeight: 700, marginBottom: 6 }}>YOUR $CUM BALANCE</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                      <span style={{ fontSize: 36, fontWeight: 900, fontFamily: "monospace", color: T.cum }}>{cumBalance}</span>
                      <span style={{ fontSize: 14, fontFamily: "monospace", color: T.cum, opacity: 0.6 }}>$CUM</span>
                    </div>
                    <div style={{ fontSize: 10, fontFamily: "monospace", color: T.grayD, marginTop: 6 }}>
                      Rate: {cumRate} $CUM/day • Pending: ~{cumPending} • Earned: {cumEarned} • Spent: {cumSpent}
                    </div>
                  </div>
                  <button onClick={handleClaim} disabled={claiming || cumPending < 1} style={{
                    background: cumPending >= 1 ? T.cum : T.grayK, color: T.bg, border: "none", borderRadius: 8,
                    padding: "12px 28px", fontSize: 13, fontWeight: 900, fontFamily: "monospace", letterSpacing: 2,
                    cursor: cumPending >= 1 ? "pointer" : "not-allowed", opacity: claiming ? 0.6 : 1,
                  }}>{claiming ? "CLAIMING..." : cumPending >= 1 ? `CLAIM ${cumPending} $CUM` : "ACCUMULATING..."}</button>
                </div>

                {/* Staked NFTs */}
                {stakedNfts.length > 0 && (
                  <div style={{ marginBottom: 30 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                      <h2 style={{ fontSize: 16, fontWeight: 900, fontFamily: "monospace", color: T.sweep, letterSpacing: 2 }}>🔒 STAKED ({stakedNfts.length})</h2>
                      <button onClick={() => handleUnstake(stakedNfts.map(n => n.tokenId))} disabled={staking} style={{ background: `${T.burn}15`, border: `1px solid ${T.burn}40`, borderRadius: 6, padding: "6px 14px", color: T.burn, fontSize: 10, fontFamily: "monospace", fontWeight: 700, cursor: "pointer" }}>UNSTAKE ALL</button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
                      {stakedNfts.map(nft => (
                        <div key={nft.tokenId} style={{ background: T.card, border: `1px solid ${T.sweep}40`, borderRadius: 12, overflow: "hidden" }}>
                          <div style={{ aspectRatio: "1", position: "relative", background: T.bg }}>
                            {nft.image ? <img src={nft.image} alt={nft.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30 }}>🎨</div>}
                            <div style={{ position: "absolute", top: 4, right: 4, background: T.sweep, borderRadius: 4, padding: "2px 6px", fontSize: 7, fontWeight: 900, fontFamily: "monospace", color: T.bg }}>STAKED 🔒</div>
                          </div>
                          <div style={{ padding: "6px 8px" }}>
                            <div style={{ fontSize: 9, fontWeight: 700, fontFamily: "monospace", color: T.sweep, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nft.name}</div>
                            <div style={{ fontSize: 8, fontFamily: "monospace", color: T.cum, marginTop: 2 }}>+1 $CUM/day</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Listed */}
                {listedNfts.length > 0 && (
                  <div style={{ marginBottom: 30 }}>
                    <h2 style={{ fontSize: 14, fontWeight: 900, fontFamily: "monospace", color: T.listed, letterSpacing: 2, marginBottom: 10 }}>⚠️ LISTED — DELIST TO STAKE ({listedNfts.length})</h2>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
                      {listedNfts.map(nft => (
                        <div key={nft.tokenId} style={{ background: T.card, border: `1px solid ${T.listed}30`, borderRadius: 12, overflow: "hidden", opacity: 0.4 }}>
                          <div style={{ aspectRatio: "1", background: T.bg }}>{nft.image ? <img src={nft.image} alt={nft.name} style={{ width: "100%", height: "100%", objectFit: "cover", filter: "grayscale(0.5)" }} /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30 }}>🎨</div>}</div>
                          <div style={{ padding: "6px 8px" }}><div style={{ fontSize: 9, fontWeight: 700, fontFamily: "monospace", color: T.listed }}>{nft.name}</div></div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Available to stake */}
                {stakeableNfts.length > 0 && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                      <h2 style={{ fontSize: 16, fontWeight: 900, fontFamily: "monospace", color: T.accent, letterSpacing: 2 }}>AVAILABLE ({stakeableNfts.length})</h2>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={selectAll} style={{ background: `${T.accent}15`, border: `1px solid ${T.accent}40`, borderRadius: 6, padding: "6px 14px", color: T.accent, fontSize: 10, fontFamily: "monospace", fontWeight: 700, cursor: "pointer" }}>SELECT ALL</button>
                        <button onClick={() => setSelectedIds(new Set())} style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 14px", color: T.grayD, fontSize: 10, fontFamily: "monospace", fontWeight: 700, cursor: "pointer" }}>CLEAR</button>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
                      {stakeableNfts.map(nft => {
                        const sel = selectedIds.has(nft.tokenId);
                        return (
                          <div key={nft.tokenId} onClick={() => toggleSelect(nft.tokenId)} style={{ background: T.card, borderRadius: 12, overflow: "hidden", cursor: "pointer", border: `2px solid ${sel ? T.accent : T.border}`, transition: "all 0.15s", transform: sel ? "scale(1.02)" : "none" }}>
                            <div style={{ aspectRatio: "1", position: "relative", background: T.bg }}>
                              {nft.image ? <img src={nft.image} alt={nft.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30 }}>🎨</div>}
                              {sel && <div style={{ position: "absolute", inset: 0, background: `${T.accent}20`, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontSize: 32 }}>✓</span></div>}
                            </div>
                            <div style={{ padding: "6px 8px" }}><div style={{ fontSize: 9, fontWeight: 700, fontFamily: "monospace", color: sel ? T.accent : T.white, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nft.name}</div></div>
                          </div>
                        );
                      })}
                    </div>
                    {selectedIds.size > 0 && (
                      <div style={{ position: "sticky", bottom: 20, marginTop: 20, background: `${T.bg}ee`, backdropFilter: "blur(12px)", border: `1px solid ${T.accent}40`, borderRadius: 12, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 900, fontFamily: "monospace", color: T.accent }}>{selectedIds.size} NFT{selectedIds.size > 1 ? "s" : ""} selected</div>
                          <div style={{ fontSize: 10, color: T.cum, fontFamily: "monospace", marginTop: 2 }}>= {selectedIds.size} $CUM/day</div>
                        </div>
                        <button onClick={handleStake} disabled={staking} style={{ background: T.accent, color: T.bg, border: "none", borderRadius: 8, padding: "12px 32px", fontSize: 14, fontWeight: 900, fontFamily: "monospace", letterSpacing: 2, cursor: staking ? "wait" : "pointer", opacity: staking ? 0.6 : 1 }}>{staking ? "SIGNING..." : "🔒 STAKE NOW"}</button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ═══ STORE TAB ═══ */}
        {tab === "store" && (
          <>
            <h2 style={{ fontSize: 22, fontWeight: 900, fontFamily: "monospace", letterSpacing: 2, color: T.white, marginBottom: 6 }}>$CUM STORE</h2>
            <p style={{ fontSize: 11, fontFamily: "monospace", color: T.grayD, marginBottom: 20 }}>Spend your $CUM tickets on WL spots for upcoming projects.</p>

            {isConnected && (
              <div style={{ ...PS, display: "flex", gap: 20, alignItems: "center" }}>
                <div><span style={{ fontSize: 24, fontWeight: 900, fontFamily: "monospace", color: T.cum }}>{cumBalance}</span><span style={{ fontSize: 11, color: T.cum, opacity: 0.6, marginLeft: 6 }}>$CUM available</span></div>
              </div>
            )}

            {listings.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60 }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🔮</div>
                <div style={{ fontSize: 18, fontWeight: 900, fontFamily: "monospace", color: T.accent, letterSpacing: 2 }}>SOONBRIA!</div>
                <div style={{ fontSize: 11, color: T.grayD, fontFamily: "monospace", marginTop: 8 }}>No listings yet. Check back soon!</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
                {listings.map(l => (
                  <div key={l.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden" }}>
                    {l.image_url && <img src={l.image_url} alt={l.title} style={{ width: "100%", height: 160, objectFit: "cover" }} />}
                    <div style={{ padding: 16 }}>
                      <h3 style={{ fontSize: 16, fontWeight: 800, fontFamily: "monospace", color: T.white, marginBottom: 6 }}>{l.title}</h3>
                      {l.description && <p style={{ fontSize: 11, color: T.gray, lineHeight: 1.6, marginBottom: 12 }}>{l.description}</p>}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                        <div style={{ fontSize: 20, fontWeight: 900, fontFamily: "monospace", color: T.cum }}>{l.price_cum} <span style={{ fontSize: 11, opacity: 0.6 }}>$CUM</span></div>
                        <div style={{ fontSize: 11, fontFamily: "monospace", color: l.remaining_spots <= 3 ? T.burn : T.grayD }}>{l.remaining_spots}/{l.total_spots} spots left</div>
                      </div>

                      {/* Progress bar */}
                      <div style={{ height: 4, background: T.grayK, borderRadius: 2, marginBottom: 14, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${((l.total_spots - l.remaining_spots) / l.total_spots) * 100}%`, background: l.remaining_spots <= 3 ? T.burn : T.accent, borderRadius: 2 }} />
                      </div>

                      {buyingId === l.id ? (
                        <div>
                          <label style={{ fontSize: 10, fontFamily: "monospace", color: T.grayD, marginBottom: 4, display: "block" }}>WL WALLET ADDRESS</label>
                          <input type="text" placeholder="0x..." value={wlWalletInput} onChange={e => setWlWalletInput(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }} />
                          <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => handleBuy(l.id)} disabled={staking || !wlWalletInput} style={{ flex: 1, background: T.cum, color: T.bg, border: "none", borderRadius: 8, padding: "10px", fontSize: 12, fontWeight: 800, fontFamily: "monospace", cursor: "pointer" }}>CONFIRM PURCHASE</button>
                            <button onClick={() => { setBuyingId(null); setWlWalletInput(""); }} style={{ background: T.grayK, color: T.white, border: "none", borderRadius: 8, padding: "10px 16px", fontSize: 12, fontFamily: "monospace", cursor: "pointer" }}>✕</button>
                          </div>
                          {isConnected && <button onClick={() => setWlWalletInput(address!)} style={{ background: "none", border: "none", color: T.accent, fontSize: 9, fontFamily: "monospace", marginTop: 6, cursor: "pointer", padding: 0 }}>↑ Use connected wallet</button>}
                        </div>
                      ) : (
                        <button onClick={() => { if (!isConnected) { showMsg("Connect wallet first", "err"); return; } if (cumBalance < l.price_cum) { showMsg(`Need ${l.price_cum} $CUM, have ${cumBalance}`, "err"); return; } setBuyingId(l.id); }} disabled={l.remaining_spots <= 0} style={{
                          width: "100%", background: l.remaining_spots <= 0 ? T.grayK : T.accent, color: T.bg, border: "none", borderRadius: 8, padding: "12px", fontSize: 13, fontWeight: 900, fontFamily: "monospace", letterSpacing: 1, cursor: l.remaining_spots <= 0 ? "not-allowed" : "pointer",
                        }}>{l.remaining_spots <= 0 ? "SOLD OUT" : "BUY WL SPOT"}</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* My purchases */}
            {myPurchases.length > 0 && (
              <div style={{ marginTop: 30 }}>
                <h3 style={{ fontSize: 14, fontWeight: 900, fontFamily: "monospace", color: T.white, letterSpacing: 2, marginBottom: 12 }}>YOUR PURCHASES</h3>
                <div style={{ ...PS, padding: 0, overflow: "hidden" }}>
                  {myPurchases.map((p, i) => (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: i < myPurchases.length - 1 ? `1px solid ${T.border}` : "none", fontSize: 11, fontFamily: "monospace" }}>
                      <div><span style={{ color: T.white, fontWeight: 700 }}>{(p as any).store_listings?.title || `Listing #${p.listing_id}`}</span></div>
                      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                        <span style={{ color: T.grayD }}>WL: {p.wl_wallet.slice(0, 6)}...{p.wl_wallet.slice(-4)}</span>
                        <span style={{ color: T.cum, fontWeight: 700 }}>{p.cum_spent} $CUM</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ═══ BURN TAB ═══ */}
        {tab === "burn" && (
          <>
            <h2 style={{ fontSize: 22, fontWeight: 900, fontFamily: "monospace", letterSpacing: 2, color: T.white, marginBottom: 6 }}>
              🔥 BURN REWARDS
            </h2>
            <p style={{ fontSize: 11, fontFamily: "monospace", color: T.grayD, marginBottom: 24 }}>
              Burn your Cambrilios permanently to earn exclusive rewards. Supports bulk transfers — burn multiple in a single transaction!
            </p>

            {/* Burn address info */}
            <div style={{ ...PS, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontFamily: "monospace", color: T.grayD }}>BURN ADDRESS:</span>
              <code style={{ fontSize: 12, fontFamily: "monospace", color: T.burn, background: `${T.burn}10`, padding: "4px 10px", borderRadius: 6, border: `1px solid ${T.burn}20` }}>
                0x000000000000000000000000000000000000dEaD
              </code>
              <button onClick={() => navigator.clipboard.writeText("0x000000000000000000000000000000000000dEaD")} style={{
                background: `${T.burn}15`, border: `1px solid ${T.burn}30`, borderRadius: 6,
                padding: "4px 10px", color: T.burn, fontSize: 9, fontFamily: "monospace",
                fontWeight: 700, cursor: "pointer",
              }}>COPY</button>
              <span style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD }}>
                Tip: You can burn multiple NFTs in one transaction (bulk transfer)
              </span>
            </div>

            {/* Available rewards */}
            {burnRewards.filter(r => r.is_active).length === 0 ? (
              <div style={{ textAlign: "center", padding: 60 }}>
                <div style={{ fontSize: 36 }}>🔮</div>
                <div style={{ fontSize: 18, fontWeight: 900, fontFamily: "monospace", color: T.accent, letterSpacing: 2, marginTop: 12 }}>SOONBRIA!</div>
                <div style={{ fontSize: 11, color: T.grayD, fontFamily: "monospace", marginTop: 8 }}>No burn rewards available yet.</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
                {burnRewards.filter(r => r.is_active).map(reward => {
                  const isActive = activeBurnId === reward.id;
                  const myClaim = burnClaims.find(c => c.reward_id === reward.id);
                  const txInputs = burnTxInputs[reward.id] || [""];
                  const isSoldOut = reward.remaining_supply <= 0;
                  const isClaimed = !!myClaim;

                  return (
                    <div key={reward.id} style={{
                      background: T.card, border: `1px solid ${isClaimed ? T.success + "40" : T.border}`,
                      borderRadius: 14, overflow: "hidden",
                    }}>
                      {/* Image */}
                      {reward.image_url && (
                        <div style={{ width: "100%", height: 200, overflow: "hidden", position: "relative" }}>
                          <img src={reward.image_url} alt={reward.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          {isSoldOut && (
                            <div style={{ position: "absolute", inset: 0, background: `${T.bg}cc`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <span style={{ fontSize: 24, fontWeight: 900, fontFamily: "monospace", color: T.burn, letterSpacing: 4 }}>SOLD OUT</span>
                            </div>
                          )}
                        </div>
                      )}

                      <div style={{ padding: 18 }}>
                        {/* Title + cost */}
                        <h3 style={{ fontSize: 16, fontWeight: 900, fontFamily: "monospace", color: T.white, marginBottom: 6 }}>
                          {reward.title}
                        </h3>
                        {reward.description && (
                          <p style={{ fontSize: 11, color: T.gray, lineHeight: 1.6, marginBottom: 12 }}>{reward.description}</p>
                        )}

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                          <div>
                            <div style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD, letterSpacing: 1 }}>BURN COST</div>
                            <div style={{ fontSize: 22, fontWeight: 900, fontFamily: "monospace", color: T.burn }}>
                              {reward.burn_cost} <span style={{ fontSize: 11, opacity: 0.7 }}>NFTs</span>
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD, letterSpacing: 1 }}>AVAILABLE</div>
                            <div style={{ fontSize: 16, fontWeight: 900, fontFamily: "monospace", color: reward.remaining_supply <= 1 ? T.burn : T.accent }}>
                              {reward.remaining_supply}/{reward.total_supply}
                            </div>
                          </div>
                        </div>

                        {/* Progress bar */}
                        <div style={{ height: 4, background: T.grayK, borderRadius: 2, marginBottom: 16, overflow: "hidden" }}>
                          <div style={{
                            height: "100%", borderRadius: 2,
                            width: `${((reward.total_supply - reward.remaining_supply) / reward.total_supply) * 100}%`,
                            background: reward.remaining_supply <= 1 ? T.burn : T.accent,
                          }} />
                        </div>

                        {/* Status badge if already claimed */}
                        {isClaimed && (
                          <div style={{
                            padding: "10px 14px", borderRadius: 8, marginBottom: 12,
                            background: myClaim.status === "delivered" ? `${T.success}15` : myClaim.status === "rejected" ? `${T.burn}15` : `${T.sweep}15`,
                            border: `1px solid ${myClaim.status === "delivered" ? T.success : myClaim.status === "rejected" ? T.burn : T.sweep}30`,
                          }}>
                            <div style={{ fontSize: 11, fontWeight: 800, fontFamily: "monospace", color: myClaim.status === "delivered" ? T.success : myClaim.status === "rejected" ? T.burn : T.sweep, letterSpacing: 1 }}>
                              {myClaim.status === "delivered" ? "✅ DELIVERED" : myClaim.status === "rejected" ? "❌ REJECTED" : myClaim.status === "verified" ? "⏳ VERIFIED — AWAITING DELIVERY" : "⏳ PENDING REVIEW"}
                            </div>
                            <div style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD, marginTop: 4 }}>
                              Burned: {myClaim.token_ids.map(id => `#${id}`).join(", ")}
                            </div>
                            {myClaim.admin_notes && (
                              <div style={{ fontSize: 9, fontFamily: "monospace", color: T.gray, marginTop: 4 }}>Note: {myClaim.admin_notes}</div>
                            )}
                          </div>
                        )}

                        {/* Burn form */}
                        {!isClaimed && !isSoldOut && isConnected && (
                          <>
                            {isActive ? (
                              <div>
                                <div style={{ fontSize: 10, fontFamily: "monospace", color: T.grayD, marginBottom: 6, letterSpacing: 1 }}>
                                  PASTE BURN TRANSACTION HASH{txInputs.length > 1 ? "ES" : ""}:
                                </div>
                                <div style={{
                                  fontSize: 9, fontFamily: "monospace", color: T.gray, marginBottom: 10, lineHeight: 1.7,
                                  padding: "8px 10px", background: `${T.bgS}`, borderRadius: 6, border: `1px solid ${T.border}`,
                                }}>
                                  1. Transfer {reward.burn_cost} Cambrilio(s) to <span style={{ color: T.burn }}>0x...dEaD</span><br />
                                  2. You can send all in one bulk transfer or separate TXs<br />
                                  3. Copy the TX hash(es) and paste below
                                </div>
                                {txInputs.map((val, i) => (
                                  <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                                    <div style={{ flex: 1 }}>
                                      <input
                                        type="text"
                                        placeholder={`0x... (TX hash ${i + 1})`}
                                        value={val}
                                        onChange={e => updateBurnTxInput(reward.id, i, e.target.value)}
                                        style={{
                                          width: "100%", background: T.bgS, border: `1px solid ${val && val.startsWith("0x") && val.length === 66 ? T.success + "40" : T.border}`,
                                          borderRadius: 6, padding: "8px 10px", color: T.white,
                                          fontSize: 11, fontFamily: "monospace", outline: "none",
                                        }}
                                      />
                                    </div>
                                    {txInputs.length > 1 && (
                                      <button onClick={() => removeTxField(reward.id, i)} style={{
                                        background: `${T.burn}15`, border: `1px solid ${T.burn}30`, borderRadius: 6,
                                        padding: "6px 8px", color: T.burn, fontSize: 10, cursor: "pointer",
                                        fontFamily: "monospace", lineHeight: 1,
                                      }}>✕</button>
                                    )}
                                  </div>
                                ))}

                                <button onClick={() => addTxField(reward.id)} style={{
                                  background: "none", border: `1px dashed ${T.border}`, borderRadius: 6,
                                  padding: "6px", width: "100%", color: T.grayD, fontSize: 9,
                                  fontFamily: "monospace", cursor: "pointer", marginBottom: 12,
                                }}>+ Add another TX hash (if burns were in separate transactions)</button>
                                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                                  <button
                                    onClick={() => handleBurnSubmit(reward.id)}
                                    disabled={submittingBurn}
                                    style={{
                                      flex: 1, background: T.burn, color: T.white, border: "none",
                                      borderRadius: 8, padding: "10px", fontSize: 12, fontWeight: 800,
                                      fontFamily: "monospace", cursor: "pointer", letterSpacing: 1,
                                      opacity: submittingBurn ? 0.6 : 1,
                                    }}
                                  >
                                    {submittingBurn ? "VERIFYING ON-CHAIN..." : "🔥 SUBMIT BURN PROOF"}
                                  </button>
                                  <button
                                    onClick={() => setActiveBurnId(null)}
                                    style={{
                                      background: T.grayK, color: T.white, border: "none",
                                      borderRadius: 8, padding: "10px 16px", fontSize: 12,
                                      fontFamily: "monospace", cursor: "pointer",
                                    }}
                                  >✕</button>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => setActiveBurnId(reward.id)}
                                style={{
                                  width: "100%", background: `${T.burn}15`, border: `1px solid ${T.burn}40`,
                                  borderRadius: 8, padding: "12px", fontSize: 13, fontWeight: 900,
                                  fontFamily: "monospace", color: T.burn, cursor: "pointer", letterSpacing: 1,
                                }}
                              >
                                🔥 BURN {reward.burn_cost} NFTs TO CLAIM
                              </button>
                            )}
                          </>
                        )}

                        {!isConnected && !isSoldOut && !isClaimed && (
                          <div style={{ textAlign: "center", padding: "10px", fontSize: 11, fontFamily: "monospace", color: T.grayD }}>
                            Connect wallet to claim
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* My burn history */}
            {burnClaims.length > 0 && (
              <div style={{ marginTop: 30 }}>
                <h3 style={{ fontSize: 14, fontWeight: 900, fontFamily: "monospace", color: T.white, letterSpacing: 2, marginBottom: 12 }}>YOUR BURN CLAIMS</h3>
                <div style={PS}>
                  {burnClaims.map(claim => (
                    <div key={claim.id} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "12px 0", borderBottom: `1px solid ${T.border}`,
                      fontSize: 11, fontFamily: "monospace", flexWrap: "wrap", gap: 8,
                    }}>
                      <div>
                        <span style={{ color: T.white, fontWeight: 700 }}>{(claim as any).burn_rewards?.title || `Reward #${claim.reward_id}`}</span>
                        <div style={{ fontSize: 9, color: T.grayD, marginTop: 2 }}>
                          Burned: {claim.token_ids.map(id => `#${id}`).join(", ")} • {claim.tx_hashes.length} TX(s)
                        </div>
                      </div>
                      <span style={{
                        padding: "3px 10px", borderRadius: 6, fontSize: 9, fontWeight: 800, fontFamily: "monospace",
                        background: claim.status === "delivered" ? `${T.success}20` : claim.status === "rejected" ? `${T.burn}20` : `${T.sweep}20`,
                        color: claim.status === "delivered" ? T.success : claim.status === "rejected" ? T.burn : T.sweep,
                      }}>
                        {claim.status.toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ═══ DASHBOARD TAB ═══ */}
        {tab === "dashboard" && (
          <>
            <h2 style={{ fontSize: 22, fontWeight: 900, fontFamily: "monospace", letterSpacing: 2, color: T.white, marginBottom: 6 }}>STAKING LEADERBOARD</h2>
            <p style={{ fontSize: 11, fontFamily: "monospace", color: T.grayD, marginBottom: 20 }}>More staked = more $CUM/day = more WL opportunities</p>

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24, padding: "16px 20px", background: T.bgS, border: `1px solid ${T.border}`, borderRadius: 12 }}>
              {[
                { label: "STAKERS", value: globalStats.totalStakers, color: T.white },
                { label: "NFTs STAKED", value: globalStats.totalNFTsStaked, color: T.accent },
                { label: "$CUM/DAY (TOTAL)", value: globalStats.totalNFTsStaked, color: T.cum },
              ].map((s, i) => (
                <div key={i}><div style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD, letterSpacing: 1.5, fontWeight: 700 }}>{s.label}</div><div style={{ fontSize: 22, fontWeight: 900, fontFamily: "monospace", color: s.color }}>{s.value}</div></div>
              ))}
            </div>

            {leaderboard.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60 }}><div style={{ fontSize: 36 }}>🔮</div><div style={{ fontSize: 18, fontWeight: 900, fontFamily: "monospace", color: T.accent, letterSpacing: 2, marginTop: 12 }}>SOONBRIA!</div></div>
            ) : (
              <div style={{ background: T.bgS, border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "50px 1fr 80px 80px", padding: "12px 16px", borderBottom: `1px solid ${T.border}`, fontSize: 9, fontFamily: "monospace", color: T.grayD, letterSpacing: 1.5, fontWeight: 700 }}>
                  <span>#</span><span>WALLET</span><span style={{ textAlign: "right" }}>STAKED</span><span style={{ textAlign: "right" }}>$CUM/DAY</span>
                </div>
                {leaderboard.map((e, i) => {
                  const isMe = address && e.wallet.toLowerCase() === address.toLowerCase();
                  return (
                    <div key={e.wallet} style={{ display: "grid", gridTemplateColumns: "50px 1fr 80px 80px", padding: "12px 16px", borderBottom: `1px solid ${T.border}`, fontSize: 12, fontFamily: "monospace", background: isMe ? `${T.accent}08` : "transparent" }}>
                      <span style={{ fontWeight: 900, color: i === 0 ? T.gold : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : T.grayD }}>{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`}</span>
                      <span style={{ color: isMe ? T.accent : T.white }}>{e.wallet.slice(0, 6)}...{e.wallet.slice(-4)} {isMe && <span style={{ color: T.accent, fontSize: 9 }}>YOU</span>}</span>
                      <span style={{ textAlign: "right", color: T.sweep, fontWeight: 700 }}>{e.staked}</span>
                      <span style={{ textAlign: "right", color: T.cum, fontWeight: 700 }}>{e.staked}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ═══ ADMIN TAB ═══ */}
        {tab === "admin" && isAdmin && (
          <>
            <h2 style={{ fontSize: 22, fontWeight: 900, fontFamily: "monospace", letterSpacing: 2, color: T.white, marginBottom: 20 }}>ADMIN PANEL</h2>

            {/* Create listing */}
            <div style={PS}>
              <h3 style={{ fontSize: 14, fontWeight: 800, fontFamily: "monospace", color: T.accent, letterSpacing: 2, marginBottom: 14 }}>CREATE STORE LISTING</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 10, fontFamily: "monospace", color: T.grayD }}>TITLE *</label><input value={newListing.title} onChange={e => setNewListing(p => ({ ...p, title: e.target.value }))} style={inputStyle} placeholder="Project Name WL" /></div>
                <div><label style={{ fontSize: 10, fontFamily: "monospace", color: T.grayD }}>PROJECT URL</label><input value={newListing.projectUrl} onChange={e => setNewListing(p => ({ ...p, projectUrl: e.target.value }))} style={inputStyle} placeholder="https://..." /></div>
                <div style={{ gridColumn: "1 / -1" }}><label style={{ fontSize: 10, fontFamily: "monospace", color: T.grayD }}>DESCRIPTION</label><input value={newListing.description} onChange={e => setNewListing(p => ({ ...p, description: e.target.value }))} style={inputStyle} placeholder="WL for..." /></div>
                <div><label style={{ fontSize: 10, fontFamily: "monospace", color: T.grayD }}>IMAGE URL</label><input value={newListing.imageUrl} onChange={e => setNewListing(p => ({ ...p, imageUrl: e.target.value }))} style={inputStyle} placeholder="https://..." /></div>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ flex: 1 }}><label style={{ fontSize: 10, fontFamily: "monospace", color: T.grayD }}>PRICE ($CUM) *</label><input type="number" value={newListing.priceCum} onChange={e => setNewListing(p => ({ ...p, priceCum: e.target.value }))} style={inputStyle} /></div>
                  <div style={{ flex: 1 }}><label style={{ fontSize: 10, fontFamily: "monospace", color: T.grayD }}>SPOTS *</label><input type="number" value={newListing.totalSpots} onChange={e => setNewListing(p => ({ ...p, totalSpots: e.target.value }))} style={inputStyle} /></div>
                </div>
              </div>
              <button onClick={handleCreateListing} disabled={!newListing.title || !newListing.priceCum || !newListing.totalSpots} style={{ marginTop: 14, background: T.accent, color: T.bg, border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 12, fontWeight: 800, fontFamily: "monospace", cursor: "pointer" }}>CREATE LISTING</button>
            </div>

            {/* WL Export */}
            {adminData?.purchases?.length > 0 && (
              <div style={PS}>
                <h3 style={{ fontSize: 14, fontWeight: 800, fontFamily: "monospace", color: T.white, letterSpacing: 2, marginBottom: 14 }}>WL PURCHASES ({adminData.purchases.length})</h3>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                        <th style={{ textAlign: "left", padding: 8, color: T.grayD, fontWeight: 700 }}>LISTING</th>
                        <th style={{ textAlign: "left", padding: 8, color: T.grayD, fontWeight: 700 }}>BUYER</th>
                        <th style={{ textAlign: "left", padding: 8, color: T.grayD, fontWeight: 700 }}>WL WALLET</th>
                        <th style={{ textAlign: "right", padding: 8, color: T.grayD, fontWeight: 700 }}>$CUM</th>
                        <th style={{ textAlign: "right", padding: 8, color: T.grayD, fontWeight: 700 }}>DATE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminData.purchases.map((p: any) => (
                        <tr key={p.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                          <td style={{ padding: 8, color: T.white }}>{p.store_listings?.title || p.listing_id}</td>
                          <td style={{ padding: 8, color: T.gray }}>{p.buyer_wallet.slice(0, 6)}...{p.buyer_wallet.slice(-4)}</td>
                          <td style={{ padding: 8, color: T.accent, fontWeight: 700 }}>{p.wl_wallet}</td>
                          <td style={{ padding: 8, color: T.cum, textAlign: "right" }}>{p.cum_spent}</td>
                          <td style={{ padding: 8, color: T.grayD, textAlign: "right" }}>{new Date(p.purchased_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button onClick={() => {
                  const csv = "Listing,Buyer,WL Wallet,$CUM,Date\n" + adminData.purchases.map((p: any) => `"${p.store_listings?.title || p.listing_id}","${p.buyer_wallet}","${p.wl_wallet}",${p.cum_spent},"${new Date(p.purchased_at).toISOString()}"`).join("\n");
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url; a.download = "cambrilio-wl-export.csv"; a.click();
                }} style={{ marginTop: 12, background: `${T.accent}15`, border: `1px solid ${T.accent}40`, borderRadius: 6, padding: "8px 16px", color: T.accent, fontSize: 10, fontFamily: "monospace", fontWeight: 700, cursor: "pointer" }}>📥 EXPORT CSV</button>
              </div>
            )}

            {/* Burn admin */}
            <div style={PS}>
              <h3 style={{ fontSize: 14, fontWeight: 800, fontFamily: "monospace", color: T.burn, letterSpacing: 2, marginBottom: 14 }}>🔥 CREATE BURN REWARD</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 10, fontFamily: "monospace", color: T.grayD }}>TITLE *</label>
                  <input value={newBurnReward.title} onChange={e => setNewBurnReward(p => ({ ...p, title: e.target.value }))} style={inputStyle} placeholder="White Party Hat 1/1" />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontFamily: "monospace", color: T.grayD }}>IMAGE URL</label>
                  <input value={newBurnReward.imageUrl} onChange={e => setNewBurnReward(p => ({ ...p, imageUrl: e.target.value }))} style={inputStyle} placeholder="https://..." />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ fontSize: 10, fontFamily: "monospace", color: T.grayD }}>DESCRIPTION</label>
                  <input value={newBurnReward.description} onChange={e => setNewBurnReward(p => ({ ...p, description: e.target.value }))} style={inputStyle} placeholder="Burn 10 Cambrilios to get this exclusive 1/1..." />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontFamily: "monospace", color: T.grayD }}>BURN COST (NFTs) *</label>
                  <input type="number" value={newBurnReward.burnCost} onChange={e => setNewBurnReward(p => ({ ...p, burnCost: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontFamily: "monospace", color: T.grayD }}>TOTAL SUPPLY *</label>
                  <input type="number" value={newBurnReward.totalSupply} onChange={e => setNewBurnReward(p => ({ ...p, totalSupply: e.target.value }))} style={inputStyle} />
                </div>
              </div>
              <button onClick={handleCreateBurnReward} disabled={!newBurnReward.title} style={{
                marginTop: 14, background: T.burn, color: T.white, border: "none", borderRadius: 8,
                padding: "10px 24px", fontSize: 12, fontWeight: 800, fontFamily: "monospace", cursor: "pointer",
              }}>🔥 CREATE BURN REWARD</button>
            </div>

            {/* Manage existing burn rewards */}
            {burnRewards.length > 0 && (
              <div style={{ background: T.bgS, border: `1px solid ${T.border}`, borderRadius: 14, padding: 20, marginBottom: 20 }}>
                <h3 style={{ fontSize: 14, fontWeight: 800, fontFamily: "monospace", color: T.white, letterSpacing: 2, marginBottom: 14 }}>MANAGE BURN REWARDS</h3>
                {burnRewards.map(r => (
                  <div key={r.id} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "12px 0", borderBottom: `1px solid ${T.border}`,
                    fontSize: 11, fontFamily: "monospace", flexWrap: "wrap", gap: 8,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {r.image_url && <img src={r.image_url} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover" }} />}
                      <div>
                        <span style={{ color: T.white, fontWeight: 700 }}>{r.title}</span>
                        {!r.is_active && <span style={{ color: T.burn, fontSize: 9, marginLeft: 6 }}>(INACTIVE)</span>}
                        <div style={{ fontSize: 9, color: T.grayD, marginTop: 2 }}>
                          Cost: {r.burn_cost} NFTs • Remaining: {r.remaining_supply}/{r.total_supply}
                        </div>
                      </div>
                    </div>
                    <button onClick={() => handleDeleteBurnReward(r.id, r.title)} style={{
                      background: `${T.burn}15`, border: `1px solid ${T.burn}40`, borderRadius: 6,
                      padding: "5px 12px", color: T.burn, fontSize: 9, fontFamily: "monospace",
                      fontWeight: 700, cursor: "pointer",
                    }}>🗑 DELETE</button>
                  </div>
                ))}
              </div>
            )}

            {/* All burn claims */}
            {allBurnClaims.length > 0 && (
              <div style={{ background: T.bgS, border: `1px solid ${T.border}`, borderRadius: 14, padding: 20, marginBottom: 20 }}>
                <h3 style={{ fontSize: 14, fontWeight: 800, fontFamily: "monospace", color: T.white, letterSpacing: 2, marginBottom: 14 }}>
                  ALL BURN CLAIMS ({allBurnClaims.length})
                </h3>
                {allBurnClaims.map(claim => (
                  <div key={claim.id} style={{
                    padding: "14px 0", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontFamily: "monospace",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
                      <div>
                        <span style={{ color: T.white, fontWeight: 700 }}>{(claim as any).burn_rewards?.title || `Reward #${claim.reward_id}`}</span>
                        <span style={{ color: T.grayD, marginLeft: 10 }}>{claim.wallet_address.slice(0, 6)}...{claim.wallet_address.slice(-4)}</span>
                      </div>
                      <span style={{
                        padding: "3px 10px", borderRadius: 6, fontSize: 9, fontWeight: 800,
                        background: claim.status === "delivered" ? `${T.success}20` : claim.status === "rejected" ? `${T.burn}20` : `${T.sweep}20`,
                        color: claim.status === "delivered" ? T.success : claim.status === "rejected" ? T.burn : T.sweep,
                      }}>{claim.status.toUpperCase()}</span>
                    </div>
                    <div style={{ fontSize: 9, color: T.grayD, marginBottom: 4 }}>
                      Burned: {claim.token_ids.map(id => `#${id}`).join(", ")}
                    </div>
                    <div style={{ fontSize: 9, color: T.grayD, marginBottom: 8 }}>
                      TXs: {claim.tx_hashes.map(h => (
                        <a key={h} href={`https://basescan.org/tx/${h}`} target="_blank" rel="noopener noreferrer" style={{ color: T.sweep, marginRight: 8 }}>{h.slice(0, 14)}...↗</a>
                      ))}
                    </div>
                    <div style={{ fontSize: 9, color: T.grayD, marginBottom: 8 }}>
                      Wallet: <span style={{ color: T.accent }}>{claim.wallet_address}</span>
                      <button onClick={() => navigator.clipboard.writeText(claim.wallet_address)} style={{ background: "none", border: "none", color: T.grayD, fontSize: 8, cursor: "pointer", marginLeft: 4 }}>📋</button>
                    </div>
                    {(claim.status === "verified" || claim.status === "pending") && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => handleUpdateBurnClaim(claim.id, "delivered")} style={{
                          background: `${T.success}15`, border: `1px solid ${T.success}40`, borderRadius: 6,
                          padding: "5px 12px", color: T.success, fontSize: 9, fontFamily: "monospace", fontWeight: 700, cursor: "pointer",
                        }}>✅ MARK DELIVERED</button>
                        <button onClick={() => handleUpdateBurnClaim(claim.id, "rejected")} style={{
                          background: `${T.burn}15`, border: `1px solid ${T.burn}40`, borderRadius: 6,
                          padding: "5px 12px", color: T.burn, fontSize: 9, fontFamily: "monospace", fontWeight: 700, cursor: "pointer",
                        }}>❌ REJECT</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div style={{ textAlign: "center", padding: "40px 0 0", borderTop: `1px solid ${T.border}`, marginTop: 30 }}>
          <div style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD, letterSpacing: 2, lineHeight: 2 }}>
            CAMBRILIO SOFT STAKE • BASE • 1 NFT = 1 $CUM/DAY<br />
            NFTs never leave your wallet
          </div>
        </div>
      </div>
    </div>
  );
}
