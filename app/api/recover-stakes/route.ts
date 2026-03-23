import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

async function isAdmin(wallet: string): Promise<boolean> {
  const sb = getServiceSupabase();
  const { data } = await sb
    .from("admins")
    .select("wallet_address")
    .eq("wallet_address", wallet.toLowerCase())
    .single();
  return !!data;
}

// POST: restore all stakes wrongly deactivated by a broken Alchemy API key
// Only accessible by admins
export async function POST(req: NextRequest) {
  try {
    const { wallet } = await req.json();

    if (!wallet || !(await isAdmin(wallet))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const sb = getServiceSupabase();

    // Find all stakes marked as "moved" (false positives from broken API)
    const { data: removedStakes, error: fetchError } = await sb
      .from("stakes")
      .select("*")
      .eq("is_active", false)
      .eq("removed_reason", "moved");

    if (fetchError) throw fetchError;

    if (!removedStakes?.length) {
      return NextResponse.json({ restored: 0, message: "No removed stakes found to recover" });
    }

    // Restore all of them to active
    const { error: updateError } = await sb
      .from("stakes")
      .update({
        is_active: true,
        removed_reason: null,
        removed_at: null,
        verified_at: new Date().toISOString(),
      })
      .eq("is_active", false)
      .eq("removed_reason", "moved");

    if (updateError) throw updateError;

    // Recalculate total_staked for each affected wallet
    const wallets = [...new Set(removedStakes.map((s) => s.wallet_address))];
    let updated = 0;

    for (const w of wallets) {
      const { data: activeStakes } = await sb
        .from("stakes")
        .select("token_id")
        .eq("wallet_address", w)
        .eq("is_active", true);

      const count = activeStakes?.length || 0;

      await sb.from("stakers").upsert(
        {
          wallet_address: w,
          total_staked: count,
          last_verified_at: new Date().toISOString(),
          is_active: count > 0,
        },
        { onConflict: "wallet_address" }
      );

      updated++;
    }

    return NextResponse.json({
      success: true,
      restored: removedStakes.length,
      walletsUpdated: updated,
      message: `Restored ${removedStakes.length} stakes across ${updated} wallets. Now call /api/verify to re-check real ownership.`,
    });
  } catch (err: any) {
    console.error("Recovery error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
