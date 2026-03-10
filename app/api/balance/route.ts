import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

const CUM_PER_NFT_PER_HOUR = 1 / 24;

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

    // Calculate pending (unclaimed) $CUM
    const lastClaim = staker.last_claim_at
      ? new Date(staker.last_claim_at)
      : new Date(staker.first_staked_at);
    const hoursElapsed = (Date.now() - lastClaim.getTime()) / (1000 * 60 * 60);
    const pending = Math.floor(staker.total_staked * hoursElapsed * CUM_PER_NFT_PER_HOUR * 100) / 100;

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
      ratePerDay: staker.total_staked,
      lastClaim: staker.last_claim_at,
      purchases: purchases || [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
