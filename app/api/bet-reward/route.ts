import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { readContractSafe } from "@/lib/viemClient";
import { BET_CONTRACT_ADDRESS, BET_ABI, ZERO_ADDRESS } from "@/lib/betContract";

const CUM_PER_NFT = 10;

export async function POST(req: NextRequest) {
  try {
    const { roomId } = await req.json();
    if (roomId === undefined || roomId === null) {
      return NextResponse.json({ error: "Missing roomId" }, { status: 400 });
    }

    const sb = getServiceSupabase();

    // Verify on-chain that the room is Complete (status === 3)
    const roomData = await readContractSafe<[string, string, number, number, string, number, number, bigint, bigint, bigint, string]>({
      address: BET_CONTRACT_ADDRESS,
      abi: BET_ABI,
      functionName: "getRoom",
      args: [BigInt(roomId)],
    });

    const [creator, challenger, nftCount, status] = roomData;

    if (status !== 3) {
      return NextResponse.json({ error: "Room is not complete yet" }, { status: 400 });
    }

    const creatorWallet = (creator as string).toLowerCase();
    const challengerWallet = (challenger as string).toLowerCase();

    if (challengerWallet === ZERO_ADDRESS.toLowerCase()) {
      return NextResponse.json({ error: "No challenger in this room" }, { status: 400 });
    }

    const roomIdStr = String(roomId);

    // Idempotency check — if already rewarded, return early
    const { data: existing } = await sb
      .from("bet_cum_rewards")
      .select("id")
      .eq("room_id", roomIdStr)
      .single();

    if (existing) {
      return NextResponse.json({ success: true, alreadyRewarded: true });
    }

    const reward = Number(nftCount) * CUM_PER_NFT;

    // Upsert both players into stakers (in case they never staked)
    for (const wallet of [creatorWallet, challengerWallet]) {
      const { data: staker } = await sb
        .from("stakers")
        .select("cum_balance, cum_total_earned")
        .eq("wallet_address", wallet)
        .single();

      if (staker) {
        await sb.from("stakers").update({
          cum_balance: (parseFloat(staker.cum_balance) || 0) + reward,
          cum_total_earned: (parseFloat(staker.cum_total_earned) || 0) + reward,
        }).eq("wallet_address", wallet);
      } else {
        // Player never staked — create a stakers row for them
        await sb.from("stakers").insert({
          wallet_address: wallet,
          total_staked: 0,
          is_active: false,
          cum_balance: reward,
          cum_total_earned: reward,
          first_staked_at: new Date().toISOString(),
          last_claim_at: new Date().toISOString(),
        });
      }
    }

    // Mark room as rewarded
    await sb.from("bet_cum_rewards").insert({ room_id: roomIdStr, nft_count: Number(nftCount), reward_per_player: reward });

    return NextResponse.json({ success: true, reward, nftCount: Number(nftCount) });
  } catch (err: any) {
    console.error("bet-reward error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
