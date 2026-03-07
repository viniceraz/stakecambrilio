import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export async function GET() {
  try {
    const sb = getServiceSupabase();

    // Leaderboard
    const { data: leaders, error } = await sb
      .from("stakers")
      .select("wallet_address,total_staked,first_staked_at,last_verified_at")
      .gt("total_staked", 0)
      .order("total_staked", { ascending: false })
      .limit(100);

    if (error) throw error;

    // Total NFTs staked
    const { count } = await sb
      .from("stakes")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true);

    const totalNFTsStaked = count || 0;
    const totalStakers = leaders?.length || 0;
    const totalTickets = totalNFTsStaked;

    const leaderboard = (leaders || []).map((s) => ({
      wallet: s.wallet_address,
      staked: s.total_staked,
      firstStaked: s.first_staked_at,
      lastVerified: s.last_verified_at,
      winChance:
        totalTickets > 0
          ? ((s.total_staked / totalTickets) * 100).toFixed(2)
          : "0",
    }));

    return NextResponse.json({
      leaderboard,
      stats: { totalStakers, totalNFTsStaked, totalTickets },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}