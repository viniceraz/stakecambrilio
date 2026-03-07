import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { verifyOwnership, getListedTokenIds } from "@/lib/blockchain";

export async function POST(req: NextRequest) {
  try {
    const sb = getServiceSupabase();

    // Get all active stakes
    const { data: activeStakes } = await sb
      .from("stakes")
      .select("*")
      .eq("is_active", true);

    if (!activeStakes?.length) {
      return NextResponse.json({ verified: 0, removed: 0 });
    }

    // Group by wallet
    const walletMap = new Map<string, string[]>();
    activeStakes.forEach((s) => {
      const arr = walletMap.get(s.wallet_address) || [];
      arr.push(s.token_id);
      walletMap.set(s.wallet_address, arr);
    });

    // Get all listed token IDs
    const listedIds = await getListedTokenIds();

    let removed = 0;
    let verified = 0;

    // Check each wallet
    for (const [wallet, tokenIds] of walletMap) {
      const stillOwned = await verifyOwnership(wallet, tokenIds);

      for (const tokenId of tokenIds) {
        const owned = stillOwned.has(tokenId);
        const listed = listedIds.has(tokenId);

        if (!owned) {
          // NFT moved — deactivate
          await sb
            .from("stakes")
            .update({ is_active: false, removed_reason: "moved", removed_at: new Date().toISOString() })
            .eq("wallet_address", wallet)
            .eq("token_id", tokenId);
          removed++;
        } else if (listed) {
          // NFT listed — deactivate
          await sb
            .from("stakes")
            .update({ is_active: false, removed_reason: "listed", removed_at: new Date().toISOString() })
            .eq("wallet_address", wallet)
            .eq("token_id", tokenId);
          removed++;
        } else {
          // Still valid — update verification timestamp
          await sb
            .from("stakes")
            .update({ verified_at: new Date().toISOString() })
            .eq("wallet_address", wallet)
            .eq("token_id", tokenId);
          verified++;
        }
      }

      // Update staker profile
      const { data: remaining } = await sb
        .from("stakes")
        .select("token_id")
        .eq("wallet_address", wallet)
        .eq("is_active", true);

      const count = remaining?.length || 0;
      await sb.from("stakers").upsert(
        {
          wallet_address: wallet,
          total_staked: count,
          last_verified_at: new Date().toISOString(),
          is_active: count > 0,
        },
        { onConflict: "wallet_address" }
      );

      // Rate limit: small delay between wallets
      await new Promise((r) => setTimeout(r, 200));
    }

    return NextResponse.json({ verified, removed, total: activeStakes.length });
  } catch (err: any) {
    console.error("Verify error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
