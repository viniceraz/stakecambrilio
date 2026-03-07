"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSignMessage } from "wagmi";
import { getOwnedCambrilios, checkListedClient, OwnedNFT } from "@/lib/blockchain";
import { supabase } from "@/lib/supabase";

const T = {
  bg: "#06060b", bgS: "#0b0b14", card: "#0e0e18",
  border: "#1a1a2c", accent: "#c8ff00", burn: "#ff4444",
  sweep: "#00e5ff", gold: "#ffd700", weth: "#627eea",
  listed: "#ff6b6b", white: "#f0f0f5", gray: "#8888a0",
  grayD: "#55556a", grayK: "#333345", success: "#00ff88",
};

interface StakeInfo {
  token_id: string;
  staked_at: string;
  is_active: boolean;
}

interface LeaderEntry {
  wallet: string;
  staked: number;
  winChance: string;
  firstStaked: string;
}

export default function StakePage() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [tab, setTab] = useState<"stake" | "dashboard">("stake");
  const [ownedNfts, setOwnedNfts] = useState<OwnedNFT[]>([]);
  const [listedIds, setListedIds] = useState<Set<string>>(new Set());
  const [stakedIds, setStakedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [staking, setStaking] = useState(false);
  const [msg, setMsg] = useState("");
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>([]);
  const [globalStats, setGlobalStats] = useState({ totalStakers: 0, totalNFTsStaked: 0, totalTickets: 0 });

  // Load user NFTs + staked status
  const loadUserData = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const [nfts, { data: stakes }] = await Promise.all([
        getOwnedCambrilios(address),
        supabase.from("stakes").select("token_id, staked_at, is_active").eq("wallet_address", address.toLowerCase()).eq("is_active", true),
      ]);
      setOwnedNfts(nfts);
      setStakedIds(new Set((stakes || []).map((s: StakeInfo) => s.token_id)));

      // Check which are listed
      const ids = nfts.map((n) => n.tokenId);
      if (ids.length > 0) {
        const listed = await checkListedClient(ids);
        setListedIds(listed);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [address]);

  // Load leaderboard
  const loadLeaderboard = useCallback(async () => {
    try {
      const res = await fetch("/api/leaderboard");
      const data = await res.json();
      setLeaderboard(data.leaderboard || []);
      setGlobalStats(data.stats || { totalStakers: 0, totalNFTsStaked: 0, totalTickets: 0 });
    } catch (err) {
      console.error(err);
    }
  }, []);

  // Trigger verification on page load
  useEffect(() => {
    loadLeaderboard();
    // Run verify in background (non-blocking)
    fetch("/api/verify", { method: "POST" }).catch(() => {});
  }, [loadLeaderboard]);

  useEffect(() => {
    if (isConnected && address) loadUserData();
    else {
      setOwnedNfts([]);
      setStakedIds(new Set());
      setSelectedIds(new Set());
    }
  }, [isConnected, address, loadUserData]);

  // Toggle selection
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Select all stakeable
  const selectAll = () => {
    const stakeable = ownedNfts.filter((n) => !stakedIds.has(n.tokenId) && !listedIds.has(n.tokenId));
    setSelectedIds(new Set(stakeable.map((n) => n.tokenId)));
  };

  // Stake selected NFTs
  const handleStake = async () => {
    if (!address || selectedIds.size === 0) return;
    setStaking(true);
    setMsg("");
    try {
      const ids = Array.from(selectedIds);
      const message = `I confirm soft staking ${ids.length} Cambrilio NFT(s): ${ids.join(", ")}\n\nI understand that moving or listing these NFTs will remove them from the stake.\n\nWallet: ${address}\nTimestamp: ${new Date().toISOString()}`;

      const signature = await signMessageAsync({ message });

      const res = await fetch("/api/stake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, tokenIds: ids, signature }),
      });
      const data = await res.json();

      if (data.success) {
        setMsg(`Successfully staked ${data.staked} NFT(s)! Total: ${data.total}`);
        setSelectedIds(new Set());
        await loadUserData();
        await loadLeaderboard();
      } else {
        setMsg(`Error: ${data.error}`);
      }
    } catch (err: any) {
      if (err.message?.includes("rejected")) setMsg("Signature rejected by user");
      else setMsg(`Error: ${err.message}`);
    } finally {
      setStaking(false);
    }
  };

  // Unstake
  const handleUnstake = async (tokenIds: string[]) => {
    if (!address) return;
    setStaking(true);
    try {
      const res = await fetch("/api/unstake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, tokenIds }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg(`Unstaked. ${data.remaining} NFTs remaining.`);
        await loadUserData();
        await loadLeaderboard();
      }
    } catch (err: any) {
      setMsg(`Error: ${err.message}`);
    } finally {
      setStaking(false);
    }
  };

  const stakeableNfts = ownedNfts.filter((n) => !stakedIds.has(n.tokenId) && !listedIds.has(n.tokenId));
  const stakedNfts = ownedNfts.filter((n) => stakedIds.has(n.tokenId));
  const listedNfts = ownedNfts.filter((n) => listedIds.has(n.tokenId));

  const myWinChance = globalStats.totalTickets > 0
    ? ((stakedIds.size / globalStats.totalTickets) * 100).toFixed(2)
    : "0";

  return (
    <div style={{ minHeight: "100vh", background: T.bg }}>
      {/* NAV */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 100, background: `${T.bg}ee`,
        backdropFilter: "blur(12px)", borderBottom: `1px solid ${T.border}`, padding: "0 24px",
      }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Image src="/logo 2.png" alt="Cambrilio Logo" width={22} height={22} style={{ objectFit: "contain" }} />
            <span style={{ fontSize: 18, fontWeight: 900, fontFamily: "monospace", letterSpacing: 3, color: T.accent }}>CAMBRILIO</span>
            <span style={{ fontSize: 11, fontFamily: "monospace", color: T.grayD }}>SOFT STAKE</span>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <button onClick={() => setTab("stake")} style={{
              background: "none", border: "none", cursor: "pointer",
              color: tab === "stake" ? T.accent : T.grayD,
              fontSize: 11, fontWeight: 800, fontFamily: "monospace", letterSpacing: 2,
              borderBottom: tab === "stake" ? `2px solid ${T.accent}` : "2px solid transparent",
              padding: "8px 0",
            }}>▸STAKE</button>
            <button onClick={() => setTab("dashboard")} style={{
              background: "none", border: "none", cursor: "pointer",
              color: tab === "dashboard" ? T.accent : T.grayD,
              fontSize: 11, fontWeight: 800, fontFamily: "monospace", letterSpacing: 2,
              borderBottom: tab === "dashboard" ? `2px solid ${T.accent}` : "2px solid transparent",
              padding: "8px 0",
            }}>▸DASHBOARD</button>
            <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
          </div>
        </div>
      </nav>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "30px 20px 60px" }}>

        {/* GLOBAL STATS */}
        <div style={{
          display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 30,
          padding: "16px 20px", background: T.bgS, border: `1px solid ${T.border}`, borderRadius: 12,
        }}>
          {[
            { label: "TOTAL STAKERS", value: globalStats.totalStakers, color: T.white },
            { label: "NFTs STAKED", value: globalStats.totalNFTsStaked, color: T.accent },
            { label: "RAFFLE TICKETS", value: globalStats.totalTickets, color: T.gold },
            ...(isConnected ? [
              { label: "YOUR STAKED", value: stakedIds.size, color: T.sweep },
              { label: "YOUR WIN %", value: `${myWinChance}%`, color: T.success },
            ] : []),
          ].map((s, i) => (
            <div key={i}>
              <div style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD, letterSpacing: 1.5, fontWeight: 700 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 900, fontFamily: "monospace", color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* ═══ STAKE TAB ═══ */}
        {tab === "stake" && (
          <>
            {!isConnected ? (
              <div style={{ textAlign: "center", padding: "80px 20px" }}>
                <div style={{ marginBottom: 20, display: "flex", justifyContent: "center" }}>
                  <Image src="/logo 2.png" alt="Cambrilio Logo" width={48} height={48} style={{ objectFit: "contain" }} />
                </div>
                <h1 style={{ fontSize: 32, fontWeight: 900, fontFamily: "monospace", letterSpacing: 3, marginBottom: 12 }}>
                  <span style={{ color: T.accent }}>SOFT STAKE</span>
                </h1>
                <p style={{ fontSize: 14, color: T.gray, maxWidth: 500, margin: "0 auto 24px", lineHeight: 1.8 }}>
                  Stake your Cambrilios without leaving your wallet. Keep your NFTs, earn WL entries for upcoming projects. More staked = more chances to win.
                </p>
                <div style={{ fontSize: 12, color: T.grayD, fontFamily: "monospace", marginBottom: 30 }}>
                  1 staked NFT = 1 raffle ticket
                </div>
                <ConnectButton />
              </div>
            ) : loading ? (
              <div style={{ textAlign: "center", padding: 60, fontSize: 11, fontFamily: "monospace", color: T.grayD }}>⏳ Loading your Cambrilios...</div>
            ) : ownedNfts.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60 }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>😔</div>
                <div style={{ fontSize: 14, fontFamily: "monospace", color: T.gray }}>No Cambrilios found in this wallet</div>
                <a href="https://opensea.io/collection/cambrilio" target="_blank" rel="noopener noreferrer" style={{
                  display: "inline-block", marginTop: 16, padding: "10px 24px",
                  background: T.accent, color: T.bg, borderRadius: 8,
                  fontSize: 12, fontWeight: 800, fontFamily: "monospace",
                  textDecoration: "none", letterSpacing: 1,
                }}>BUY ON OPENSEA →</a>
              </div>
            ) : (
              <>
                {/* Message */}
                {msg && (
                  <div style={{
                    padding: "12px 16px", marginBottom: 16, borderRadius: 8,
                    background: msg.includes("Error") || msg.includes("rejected") ? `${T.burn}15` : `${T.success}15`,
                    border: `1px solid ${msg.includes("Error") || msg.includes("rejected") ? T.burn : T.success}30`,
                    color: msg.includes("Error") || msg.includes("rejected") ? T.burn : T.success,
                    fontSize: 12, fontFamily: "monospace",
                  }}>{msg}</div>
                )}

                {/* YOUR STAKED NFTs */}
                {stakedNfts.length > 0 && (
                  <div style={{ marginBottom: 30 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                      <h2 style={{ fontSize: 16, fontWeight: 900, fontFamily: "monospace", color: T.sweep, letterSpacing: 2 }}>
                        🔒 STAKED ({stakedNfts.length})
                      </h2>
                      <button onClick={() => handleUnstake(stakedNfts.map((n) => n.tokenId))} disabled={staking} style={{
                        background: `${T.burn}15`, border: `1px solid ${T.burn}40`, borderRadius: 6,
                        padding: "6px 14px", color: T.burn, fontSize: 10, fontFamily: "monospace",
                        fontWeight: 700, cursor: "pointer", letterSpacing: 1,
                      }}>UNSTAKE ALL</button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
                      {stakedNfts.map((nft) => (
                        <div key={nft.tokenId} style={{
                          background: T.card, border: `1px solid ${T.sweep}40`, borderRadius: 12, overflow: "hidden",
                        }}>
                          <div style={{ aspectRatio: "1", position: "relative", background: T.bg }}>
                            {nft.image ? <img src={nft.image} alt={nft.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30 }}>🎨</div>}
                            <div style={{ position: "absolute", top: 4, right: 4, background: T.sweep, borderRadius: 4, padding: "2px 6px", fontSize: 7, fontWeight: 900, fontFamily: "monospace", color: T.bg }}>STAKED 🔒</div>
                          </div>
                          <div style={{ padding: "6px 8px" }}>
                            <div style={{ fontSize: 9, fontWeight: 700, fontFamily: "monospace", color: T.sweep, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nft.name}</div>
                            <button onClick={() => handleUnstake([nft.tokenId])} disabled={staking} style={{
                              width: "100%", marginTop: 4, padding: "4px", background: `${T.burn}10`,
                              border: `1px solid ${T.burn}30`, borderRadius: 4, color: T.burn,
                              fontSize: 8, fontFamily: "monospace", fontWeight: 700, cursor: "pointer",
                            }}>UNSTAKE</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* LISTED (can't stake) */}
                {listedNfts.length > 0 && (
                  <div style={{ marginBottom: 30 }}>
                    <h2 style={{ fontSize: 14, fontWeight: 900, fontFamily: "monospace", color: T.listed, letterSpacing: 2, marginBottom: 10 }}>
                      ⚠️ LISTED — DELIST TO STAKE ({listedNfts.length})
                    </h2>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
                      {listedNfts.map((nft) => (
                        <div key={nft.tokenId} style={{
                          background: T.card, border: `1px solid ${T.listed}30`, borderRadius: 12, overflow: "hidden", opacity: 0.5,
                        }}>
                          <div style={{ aspectRatio: "1", position: "relative", background: T.bg }}>
                            {nft.image ? <img src={nft.image} alt={nft.name} style={{ width: "100%", height: "100%", objectFit: "cover", filter: "grayscale(0.5)" }} /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30 }}>🎨</div>}
                            <div style={{ position: "absolute", top: 4, right: 4, background: T.listed, borderRadius: 4, padding: "2px 6px", fontSize: 7, fontWeight: 900, fontFamily: "monospace", color: T.bg }}>LISTED</div>
                          </div>
                          <div style={{ padding: "6px 8px" }}>
                            <div style={{ fontSize: 9, fontWeight: 700, fontFamily: "monospace", color: T.listed }}>{nft.name}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* AVAILABLE TO STAKE */}
                {stakeableNfts.length > 0 && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                      <h2 style={{ fontSize: 16, fontWeight: 900, fontFamily: "monospace", color: T.accent, letterSpacing: 2 }}>
                        AVAILABLE TO STAKE ({stakeableNfts.length})
                      </h2>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={selectAll} style={{
                          background: `${T.accent}15`, border: `1px solid ${T.accent}40`, borderRadius: 6,
                          padding: "6px 14px", color: T.accent, fontSize: 10, fontFamily: "monospace",
                          fontWeight: 700, cursor: "pointer",
                        }}>SELECT ALL</button>
                        <button onClick={() => setSelectedIds(new Set())} style={{
                          background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6,
                          padding: "6px 14px", color: T.grayD, fontSize: 10, fontFamily: "monospace",
                          fontWeight: 700, cursor: "pointer",
                        }}>CLEAR</button>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
                      {stakeableNfts.map((nft) => {
                        const selected = selectedIds.has(nft.tokenId);
                        return (
                          <div key={nft.tokenId} onClick={() => toggleSelect(nft.tokenId)} style={{
                            background: T.card, borderRadius: 12, overflow: "hidden", cursor: "pointer",
                            border: `2px solid ${selected ? T.accent : T.border}`,
                            transition: "all 0.15s", transform: selected ? "scale(1.02)" : "none",
                          }}>
                            <div style={{ aspectRatio: "1", position: "relative", background: T.bg }}>
                              {nft.image ? <img src={nft.image} alt={nft.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30 }}>🎨</div>}
                              {selected && (
                                <div style={{ position: "absolute", inset: 0, background: `${T.accent}20`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  <span style={{ fontSize: 32, textShadow: `0 0 20px ${T.accent}` }}>✓</span>
                                </div>
                              )}
                            </div>
                            <div style={{ padding: "6px 8px" }}>
                              <div style={{ fontSize: 9, fontWeight: 700, fontFamily: "monospace", color: selected ? T.accent : T.white, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nft.name}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* STAKE BUTTON */}
                    {selectedIds.size > 0 && (
                      <div style={{
                        position: "sticky", bottom: 20, marginTop: 20,
                        background: `${T.bg}ee`, backdropFilter: "blur(12px)",
                        border: `1px solid ${T.accent}40`, borderRadius: 12,
                        padding: "16px 20px", display: "flex", justifyContent: "space-between",
                        alignItems: "center",
                      }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 900, fontFamily: "monospace", color: T.accent }}>
                            {selectedIds.size} NFT{selectedIds.size > 1 ? "s" : ""} selected
                          </div>
                          <div style={{ fontSize: 10, color: T.grayD, fontFamily: "monospace", marginTop: 2 }}>
                            = {selectedIds.size} raffle ticket{selectedIds.size > 1 ? "s" : ""}
                          </div>
                        </div>
                        <button onClick={handleStake} disabled={staking} style={{
                          background: T.accent, color: T.bg, border: "none", borderRadius: 8,
                          padding: "12px 32px", fontSize: 14, fontWeight: 900,
                          fontFamily: "monospace", letterSpacing: 2, cursor: staking ? "wait" : "pointer",
                          opacity: staking ? 0.6 : 1,
                        }}>
                          {staking ? "SIGNING..." : "🔒 STAKE NOW"}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {stakeableNfts.length === 0 && stakedNfts.length > 0 && listedNfts.length === 0 && (
                  <div style={{ textAlign: "center", padding: 40, fontSize: 12, fontFamily: "monospace", color: T.success }}>
                    ✅ All your Cambrilios are staked!
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ═══ DASHBOARD TAB ═══ */}
        {tab === "dashboard" && (
          <>
            <h2 style={{ fontSize: 22, fontWeight: 900, fontFamily: "monospace", letterSpacing: 2, color: T.white, marginBottom: 6 }}>LEADERBOARD</h2>
            <p style={{ fontSize: 11, fontFamily: "monospace", color: T.grayD, marginBottom: 20 }}>
              More staked NFTs = higher chance of winning WL. 1 NFT = 1 raffle ticket.
            </p>

            {leaderboard.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60 }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🔮</div>
                <div style={{ fontSize: 18, fontWeight: 900, fontFamily: "monospace", color: T.accent, letterSpacing: 2 }}>SOONBRIA!</div>
                <div style={{ fontSize: 11, color: T.grayD, fontFamily: "monospace", marginTop: 8 }}>No stakers yet. Be the first!</div>
              </div>
            ) : (
              <div style={{ background: T.bgS, border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden" }}>
                {/* Header */}
                <div style={{
                  display: "grid", gridTemplateColumns: "50px 1fr 100px 100px 80px",
                  padding: "12px 16px", borderBottom: `1px solid ${T.border}`,
                  fontSize: 9, fontFamily: "monospace", color: T.grayD, letterSpacing: 1.5, fontWeight: 700,
                }}>
                  <span>#</span>
                  <span>WALLET</span>
                  <span style={{ textAlign: "right" }}>STAKED</span>
                  <span style={{ textAlign: "right" }}>TICKETS</span>
                  <span style={{ textAlign: "right" }}>WIN %</span>
                </div>

                {/* Rows */}
                {leaderboard.map((entry, i) => {
                  const isMe = address && entry.wallet.toLowerCase() === address.toLowerCase();
                  return (
                    <div key={entry.wallet} style={{
                      display: "grid", gridTemplateColumns: "50px 1fr 100px 100px 80px",
                      padding: "12px 16px", borderBottom: `1px solid ${T.border}`,
                      fontSize: 12, fontFamily: "monospace",
                      background: isMe ? `${T.accent}08` : "transparent",
                    }}>
                      <span style={{
                        fontWeight: 900,
                        color: i === 0 ? T.gold : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : T.grayD,
                      }}>
                        {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`}
                      </span>
                      <span style={{ color: isMe ? T.accent : T.white }}>
                        {entry.wallet.slice(0, 6)}...{entry.wallet.slice(-4)}
                        {isMe && <span style={{ color: T.accent, fontSize: 9, marginLeft: 6 }}>YOU</span>}
                      </span>
                      <span style={{ textAlign: "right", color: T.sweep, fontWeight: 700 }}>{entry.staked}</span>
                      <span style={{ textAlign: "right", color: T.gold, fontWeight: 700 }}>{entry.staked}</span>
                      <span style={{ textAlign: "right", color: T.success, fontWeight: 700 }}>{entry.winChance}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* FOOTER */}
        <div style={{ textAlign: "center", padding: "40px 0 0", borderTop: `1px solid ${T.border}`, marginTop: 30 }}>
          <div style={{ fontSize: 9, fontFamily: "monospace", color: T.grayD, letterSpacing: 2, lineHeight: 2 }}>
            CAMBRILIO SOFT STAKE • BASE NETWORK<br />
            NFTs never leave your wallet • 1 staked NFT = 1 raffle ticket
          </div>
        </div>
      </div>
    </div>
  );
}
