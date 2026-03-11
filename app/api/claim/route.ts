import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

// Rate: 1 staked NFT = 1 $CUM per 24 hours
const CUM_PER_NFT_PER_HOUR = 1 / 24;
const MIN_HOURS_BETWEEN_CLAIMS = 24; // Must wait 24h between claims

export async function POST(req: NextRequest) {
  try {
    const { wallet } = await req.json();
    if (!wallet) return NextResponse.json({ error: "Missing wallet" }, { status: 400 });

    const w = wallet.toLowerCase();
    const sb = getServiceSupabase();

    // Get staker info
    const { data: staker } = await sb
      .from("stakers")
      .select("*")
      .eq("wallet_address", w)
      .eq("is_active", true)
      .single();

    if (!staker || staker.total_staked === 0) {
      return NextResponse.json({ error: "No active stakes found" }, { status: 400 });
    }

    // Calculate time since last claim (or first stake)
    const lastClaim = staker.last_claim_at
      ? new Date(staker.last_claim_at)
      : new Date(staker.first_staked_at);
    const now = new Date();
    const hoursElapsed = (now.getTime() - lastClaim.getTime()) / (1000 * 60 * 60);

    // Must wait at least 24 hours between claims
    if (hoursElapsed < MIN_HOURS_BETWEEN_CLAIMS) {
      const hoursLeft = Math.ceil(MIN_HOURS_BETWEEN_CLAIMS - hoursElapsed);
      const minsLeft = Math.ceil((MIN_HOURS_BETWEEN_CLAIMS - hoursElapsed) * 60);
      return NextResponse.json({
        error: `Next claim available in ~${hoursLeft > 1 ? hoursLeft + "h" : minsLeft + "min"}. Claims are every 24 hours.`,
        nextClaimIn: minsLeft,
      }, { status: 400 });
    }

    // Calculate $CUM earned
    const earned = Math.floor(staker.total_staked * hoursElapsed * CUM_PER_NFT_PER_HOUR);

    if (earned < 1) {
      return NextResponse.json({ error: "Not enough $CUM accumulated yet" }, { status: 400 });
    }

    // Update balance
    const newBalance = (parseFloat(staker.cum_balance) || 0) + earned;
    const newTotalEarned = (parseFloat(staker.cum_total_earned) || 0) + earned;

    await sb.from("stakers").update({
      cum_balance: newBalance,
      cum_total_earned: newTotalEarned,
      last_claim_at: now.toISOString(),
    }).eq("wallet_address", w);

    // Log the claim
    await sb.from("cum_claims").insert({
      wallet_address: w,
      amount: earned,
      staked_count: staker.total_staked,
      hours_elapsed: Math.floor(hoursElapsed),
    });

    return NextResponse.json({
      success: true,
      claimed: earned,
      balance: newBalance,
      totalEarned: newTotalEarned,
      stakedCount: staker.total_staked,
      hoursElapsed: Math.floor(hoursElapsed),
    });
  } catch (err: any) {
    console.error("Claim error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
