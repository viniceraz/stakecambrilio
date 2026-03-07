import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const { wallet, tokenIds } = await req.json();
    if (!wallet || !tokenIds?.length) {
      return NextResponse.json({ error: "Missing wallet or tokenIds" }, { status: 400 });
    }

    const walletLower = wallet.toLowerCase();
    const sb = getServiceSupabase();

    for (const tokenId of tokenIds) {
      await sb
        .from("stakes")
        .update({
          is_active: false,
          removed_reason: "unstaked",
          removed_at: new Date().toISOString(),
        })
        .eq("wallet_address", walletLower)
        .eq("token_id", tokenId)
        .eq("is_active", true);
    }

    // Update staker count
    const { data: remaining } = await sb
      .from("stakes")
      .select("token_id")
      .eq("wallet_address", walletLower)
      .eq("is_active", true);

    const count = remaining?.length || 0;
    await sb.from("stakers").upsert(
      {
        wallet_address: walletLower,
        total_staked: count,
        last_verified_at: new Date().toISOString(),
        is_active: count > 0,
      },
      { onConflict: "wallet_address" }
    );

    return NextResponse.json({ success: true, remaining: count });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
