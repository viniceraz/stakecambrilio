import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getNFTTraits } from "@/lib/blockchain";

const BASE_CUM_PER_NFT_PER_HOUR = 1 / 24;

export async function GET(req: NextRequest) {
  try {
    const wallet = req.nextUrl.searchParams.get("wallet");
    if (!wallet) return NextResponse.json({ error: "Missing wallet" }, { status: 400 });

    const w = wallet.toLowerCase();
    const sb = getServiceSupabase();

    const { data: staker } = await sb
      .from("stakers")
      .select("*")
      .eq("wallet_address", w)
      .single();

    if (!staker) {
      return NextResponse.json({
        balance: 0, totalEarned: 0, totalSpent: 0,
        staked: 0, pendingCum: 0, nextClaimIn: 0,
      });
    }

    // Get all active staked token IDs
    const { data: activeStakes } = await sb
      .from("stakes")
      .select("token_id")
      .eq("wallet_address", w)
      .eq("is_active", true);

    const stakedTokenIds = (activeStakes || []).map((s: any) => s.token_id);

    // Fetch traits and calculate per-NFT boost
    const traitsMap = await getNFTTraits(stakedTokenIds);
    let totalEffectiveNfts = 0;
    const nftBoosts: { tokenId: string; boost: number }[] = [];
    for (const tokenId of stakedTokenIds) {
      const info = traitsMap.get(tokenId);
      const boost = info?.boost || 1;
      totalEffectiveNfts += boost;
      nftBoosts.push({ tokenId, boost });
    }

    // Calculate pending (unclaimed) $CUM with boosts
    const lastClaim = staker.last_claim_at
      ? new Date(staker.last_claim_at)
      : new Date(staker.first_staked_at);
    const hoursElapsed = (Date.now() - lastClaim.getTime()) / (1000 * 60 * 60);
    const pending = Math.floor(totalEffectiveNfts * hoursElapsed * BASE_CUM_PER_NFT_PER_HOUR * 100) / 100;

    // Get purchase history
    const { data: purchases } = await sb
      .from("store_purchases")
      .select("*, store_listings(title)")
      .eq("buyer_wallet", w)
      .order("purchased_at", { ascending: false });

    return NextResponse.json({
      balance: parseFloat(staker.cum_balance) || 0,
      totalEarned: parseFloat(staker.cum_total_earned) || 0,
      totalSpent: parseFloat(staker.cum_total_spent) || 0,
      staked: staker.total_staked,
      pendingCum: Math.floor(pending),
      ratePerDay: totalEffectiveNfts,
      effectiveRate: totalEffectiveNfts,
      lastClaim: staker.last_claim_at,
      purchases: purchases || [],
      nftBoosts: nftBoosts.filter((b) => b.boost > 1),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
