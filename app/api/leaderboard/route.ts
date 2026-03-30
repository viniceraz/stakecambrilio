import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export async function GET() {
  try {
    const sb = getServiceSupabase();

    // Source of truth: group active stakes by wallet directly in the database
    const { data: grouped, error } = await sb
      .rpc("get_active_stakes_by_wallet");

    if (error) throw new Error(error.message);

    const walletMap = new Map<string, number>();
    let totalNFTsStaked = 0;
    for (const row of grouped || []) {
      walletMap.set(row.wallet_address, row.stake_count);
      totalNFTsStaked += row.stake_count;
    }

    // Get stakers balance data for wallets that have active stakes
    const wallets = [...walletMap.keys()];
    let stakersData: any[] = [];

    if (wallets.length > 0) {
      // Fetch in batches of 100 to avoid URL length limits
      for (let i = 0; i < wallets.length; i += 100) {
        const batch = wallets.slice(i, i + 100);
        const { data } = await sb
          .from("stakers")
          .select("wallet_address, cum_balance, cum_total_earned")
          .in("wallet_address", batch);
        if (data) stakersData = stakersData.concat(data);
      }
    }

    const stakersMap = new Map(stakersData.map((s) => [s.wallet_address, s]));

    // Build leaderboard sorted by stake count desc
    const leaderboard = [...walletMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 100)
      .map(([wallet, staked]) => {
        const staker = stakersMap.get(wallet);
        return {
          wallet,
          staked,
          balance: parseFloat(staker?.cum_balance) || 0,
          earned: parseFloat(staker?.cum_total_earned) || 0,
        };
      });

    const totalStakers = walletMap.size;

    return NextResponse.json({
      leaderboard,
      stats: { totalStakers, totalNFTsStaked, totalTickets: totalNFTsStaked },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
