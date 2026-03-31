import { NextResponse } from "next/server";
import { readContractSafe } from "@/lib/viemClient";
import { BET_CONTRACT_ADDRESS, BET_ABI, STATUS_MAP, choiceToSide, ZERO_ADDRESS } from "@/lib/betContract";

export async function GET() {
  try {
    const COUNT = 200n;

    const [raw, rawExtra] = await Promise.all([
      readContractSafe<[bigint[], `0x${string}`[], `0x${string}`[], number[], number[], `0x${string}`[], number[], number[], bigint[]]>({
        address: BET_CONTRACT_ADDRESS,
        abi: BET_ABI,
        functionName: "getRecentRooms",
        args: [COUNT],
      }),
      readContractSafe<[bigint[], bigint[], string[]]>({
        address: BET_CONTRACT_ADDRESS,
        abi: BET_ABI,
        functionName: "getRecentRoomsExtra",
        args: [COUNT],
      }),
    ]);

    const [ids, creators, challengers, nftCounts, statuses, winners, , ,] = raw;
    const [, ethAmounts] = rawExtra;

    // Only count completed rooms
    interface WalletStats {
      wins: number; losses: number;
      nftsWon: number; nftsLost: number;
      ethWon: bigint; ethLost: bigint;
    }
    const statsMap = new Map<string, WalletStats>();

    const getOrCreate = (w: string): WalletStats => {
      if (!statsMap.has(w)) statsMap.set(w, { wins: 0, losses: 0, nftsWon: 0, nftsLost: 0, ethWon: 0n, ethLost: 0n });
      return statsMap.get(w)!;
    };

    for (let i = 0; i < ids.length; i++) {
      const status = STATUS_MAP[statuses[i]];
      if (status !== "complete") continue;

      const winner = (winners[i] as string).toLowerCase();
      const creator = (creators[i] as string).toLowerCase();
      const challenger = (challengers[i] as string).toLowerCase();
      if (challenger === ZERO_ADDRESS.toLowerCase() || winner === ZERO_ADDRESS.toLowerCase()) continue;

      const nftCount = nftCounts[i];
      const ethAmt = ethAmounts[i] as bigint;

      // Winner
      const ws = getOrCreate(winner);
      ws.wins++;
      ws.nftsWon += nftCount;
      ws.ethWon += ethAmt;

      // Loser
      const loser = winner === creator ? challenger : creator;
      const ls = getOrCreate(loser);
      ls.losses++;
      ls.nftsLost += nftCount;
      ls.ethLost += ethAmt;
    }

    const leaderboard = [...statsMap.entries()]
      .map(([wallet, s]) => ({
        wallet,
        totalBets: s.wins + s.losses,
        wins: s.wins,
        losses: s.losses,
        winRate: s.wins + s.losses > 0 ? Math.round((s.wins / (s.wins + s.losses)) * 100) : 0,
        nftsWon: s.nftsWon,
        nftsLost: s.nftsLost,
        netNfts: s.nftsWon - s.nftsLost,
        ethWon: Number(s.ethWon) / 1e18,
        ethLost: Number(s.ethLost) / 1e18,
        netEth: Number(s.ethWon - s.ethLost) / 1e18,
      }))
      .sort((a, b) => b.netNfts - a.netNfts);

    return NextResponse.json({ leaderboard });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
