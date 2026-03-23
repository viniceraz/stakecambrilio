import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export async function GET() {
  try {
    const sb = getServiceSupabase();

    // Source of truth: count active stakes directly from the stakes table
    let allStakes: { wallet_address: string; token_id: string }[] = [];
    let page = 0;
    const pageSize = 1000;

    while (true) {
      const { data: batch } = await sb
        .from("stakes")
        .select("wallet_address, token_id")
        .eq("is_active", true)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (!batch || batch.length === 0) break;
      allStakes = allStakes.concat(batch);
      if (batch.length < pageSize) break;
      page++;
    }

    const totalNFTsStaked = allStakes.length;

    // Group by wallet to get per-wallet stake count
    const walletMap = new Map<string, number>();
    for (const s of allStakes) {
      walletMap.set(s.wallet_address, (walletMap.get(s.wallet_address) || 0) + 1);
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
