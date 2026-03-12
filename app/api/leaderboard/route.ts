import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export async function GET() {
  try {
    const sb = getServiceSupabase();

   const { data: leaders, error } = await sb
  .from("stakers")
  .select("*")
  .eq("is_active", true)
  .gt("total_staked", 0)
  .order("total_staked", { ascending: false })
  .limit(100);

console.log("leaders:", leaders);
console.log("error:", error);
    const { data: allActive } = await sb
      .from("stakes")
      .select("token_id")
      .eq("is_active", true);

    const totalStakers = leaders?.length || 0;
    const totalNFTsStaked = allActive?.length || 0;

    const leaderboard = (leaders || []).map((s) => ({
      wallet: s.wallet_address,
      staked: s.total_staked,
      balance: parseFloat(s.cum_balance) || 0,
      earned: parseFloat(s.cum_total_earned) || 0,
      firstStaked: s.first_staked_at,
      lastVerified: s.last_verified_at,
    }));

    return NextResponse.json({
      leaderboard,
      stats: { totalStakers, totalNFTsStaked, totalTickets: totalNFTsStaked },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
