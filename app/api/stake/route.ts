import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { verifyOwnership } from "@/lib/blockchain";

export async function POST(req: NextRequest) {
  try {
    const { wallet, tokenIds, signature } = await req.json();

    if (!wallet || !tokenIds?.length || !signature) {
      return NextResponse.json({ error: "Missing wallet, tokenIds, or signature" }, { status: 400 });
    }

    const walletLower = wallet.toLowerCase();

    // Verify the wallet actually owns these NFTs
    const stillOwned = await verifyOwnership(walletLower, tokenIds);
    const validIds = tokenIds.filter((id: string) => stillOwned.has(id));

    if (validIds.length === 0) {
      return NextResponse.json({ error: "None of the specified NFTs are owned by this wallet" }, { status: 400 });
    }

    const sb = getServiceSupabase();

    // Upsert each stake
    for (const tokenId of validIds) {
      await sb.from("stakes").upsert(
        {
          wallet_address: walletLower,
          token_id: tokenId,
          staked_at: new Date().toISOString(),
          verified_at: new Date().toISOString(),
          is_active: true,
          removed_reason: null,
          removed_at: null,
          signature,
        },
        { onConflict: "wallet_address,token_id" }
      );
    }

    // Update staker profile
    const { data: activeStakes } = await sb
      .from("stakes")
      .select("token_id")
      .eq("wallet_address", walletLower)
      .eq("is_active", true);

   // Check if this is a new staker (no previous record)
const { data: existing } = await sb
  .from("stakers")
  .select("wallet_address, last_claim_at")
  .eq("wallet_address", walletLower)
  .single();

await sb.from("stakers").upsert(
  {
    wallet_address: walletLower,
    total_staked: activeStakes?.length || validIds.length,
    last_verified_at: new Date().toISOString(),
    is_active: true,
    // Reset claim timer on first stake so they must wait 24h
    ...(!existing?.last_claim_at ? { last_claim_at: new Date().toISOString() } : {}),
  },
  { onConflict: "wallet_address" }
);

    return NextResponse.json({
      success: true,
      staked: validIds.length,
      total: activeStakes?.length || validIds.length,
    });
  } catch (err: any) {
    console.error("Stake error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
