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
    // Count total active stakes with pagination to bypass 1000 row limit
    let totalNFTsStaked = 0;
    let page = 0;
    const pageSize = 1000;
    while (true) {
      const { data: batch } = await sb
        .from("stakes")
        .select("token_id")
        .eq("is_active", true)
        .range(page * pageSize, (page + 1) * pageSize - 1);
      if (!batch || batch.length === 0) break;
      totalNFTsStaked += batch.length;
      if (batch.length < pageSize) break;
      page++;
    }

    const totalStakers = (leaders || []).length;

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
