import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

// Rate: 1 staked NFT = 1 $CUM per 24 hours
const CUM_PER_NFT_PER_HOUR = 1 / 24;

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

    if (hoursElapsed < 1) {
      return NextResponse.json({
        error: "Too early to claim. Minimum 1 hour between claims.",
        nextClaimIn: Math.ceil(60 - (hoursElapsed * 60)),
      }, { status: 400 });
    }

    // Calculate $CUM earned
    const earned = Math.floor(staker.total_staked * hoursElapsed * CUM_PER_NFT_PER_HOUR * 100) / 100;

    if (earned < 0.01) {
      return NextResponse.json({ error: "Not enough $CUM accumulated yet" }, { status: 400 });
    }

    // Round down to integer for clean numbers
    const earnedInt = Math.floor(earned);
    if (earnedInt < 1) {
      const hoursNeeded = Math.ceil(24 / staker.total_staked);
      return NextResponse.json({
        error: `Need more time. With ${staker.total_staked} NFTs staked, claim every ${hoursNeeded}h+`,
        accumulated: earned.toFixed(2),
      }, { status: 400 });
    }

    // Update balance
    const newBalance = (parseFloat(staker.cum_balance) || 0) + earnedInt;
    const newTotalEarned = (parseFloat(staker.cum_total_earned) || 0) + earnedInt;

    await sb.from("stakers").update({
      cum_balance: newBalance,
      cum_total_earned: newTotalEarned,
      last_claim_at: now.toISOString(),
    }).eq("wallet_address", w);

    // Log the claim
    await sb.from("cum_claims").insert({
      wallet_address: w,
      amount: earnedInt,
      staked_count: staker.total_staked,
      hours_elapsed: Math.floor(hoursElapsed),
    });

    return NextResponse.json({
      success: true,
      claimed: earnedInt,
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
