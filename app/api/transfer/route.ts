import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const { from, to, amount } = await req.json();

    if (!from || !to || !amount) {
      return NextResponse.json({ error: "Missing from, to, or amount" }, { status: 400 });
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
      return NextResponse.json({ error: "Invalid recipient wallet address" }, { status: 400 });
    }

    const fromW = from.toLowerCase();
    const toW = to.toLowerCase();
    const amt = parseInt(amount);

    if (isNaN(amt) || amt <= 0) {
      return NextResponse.json({ error: "Amount must be a positive integer" }, { status: 400 });
    }

    if (fromW === toW) {
      return NextResponse.json({ error: "Cannot send to yourself" }, { status: 400 });
    }

    const sb = getServiceSupabase();

    // Get sender balance
    const { data: sender } = await sb
      .from("stakers")
      .select("cum_balance, cum_total_spent")
      .eq("wallet_address", fromW)
      .single();

    if (!sender) {
      return NextResponse.json({ error: "Sender not found" }, { status: 400 });
    }

    const senderBalance = parseFloat(sender.cum_balance) || 0;

    if (senderBalance < amt) {
      return NextResponse.json({ error: `Not enough $CUM. You have ${senderBalance}, need ${amt}` }, { status: 400 });
    }

    // Deduct from sender
    await sb.from("stakers").update({
      cum_balance: senderBalance - amt,
      cum_total_spent: (parseFloat(sender.cum_total_spent) || 0) + amt,
    }).eq("wallet_address", fromW);

    // Add to recipient (create staker profile if doesn't exist)
    const { data: recipient } = await sb
      .from("stakers")
      .select("cum_balance, cum_total_earned")
      .eq("wallet_address", toW)
      .single();

    if (recipient) {
      await sb.from("stakers").update({
        cum_balance: (parseFloat(recipient.cum_balance) || 0) + amt,
        cum_total_earned: (parseFloat(recipient.cum_total_earned) || 0) + amt,
      }).eq("wallet_address", toW);
    } else {
      // Create new staker profile for recipient
      await sb.from("stakers").insert({
        wallet_address: toW,
        total_staked: 0,
        cum_balance: amt,
        cum_total_earned: amt,
        cum_total_spent: 0,
        is_active: false,
      });
    }

    return NextResponse.json({
      success: true,
      sent: amt,
      newBalance: senderBalance - amt,
      to: toW,
    });
  } catch (err: any) {
    console.error("Transfer error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
