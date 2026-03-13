import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { refreshNFTMetadata } from "@/lib/blockchain";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { wallet, tokenIds } = body;

    const sb = getServiceSupabase();

    let idsToRefresh: string[] = [];

    if (tokenIds?.length) {
      // Refresh specific tokens
      idsToRefresh = tokenIds;
    } else if (wallet) {
      // Refresh all staked tokens for this wallet
      const { data: stakes } = await sb
        .from("stakes")
        .select("token_id")
        .eq("wallet_address", wallet.toLowerCase())
        .eq("is_active", true);
      idsToRefresh = (stakes || []).map((s: any) => s.token_id);
    } else {
      // Refresh ALL staked tokens
      const { data: stakes } = await sb
        .from("stakes")
        .select("token_id")
        .eq("is_active", true);
      idsToRefresh = (stakes || []).map((s: any) => s.token_id);
    }

    if (idsToRefresh.length === 0) {
      return NextResponse.json({ refreshed: 0, message: "No tokens to refresh" });
    }

    const refreshed = await refreshNFTMetadata(idsToRefresh);

    return NextResponse.json({
      success: true,
      refreshed,
      total: idsToRefresh.length,
      message: `Refreshed metadata for ${refreshed}/${idsToRefresh.length} tokens. Changes may take a few minutes to propagate.`,
    });
  } catch (err: any) {
    console.error("Refresh metadata error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
