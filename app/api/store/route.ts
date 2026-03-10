import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

// GET: list active store items
export async function GET() {
  try {
    const sb = getServiceSupabase();
    const { data: listings } = await sb
      .from("store_listings")
      .select("*")
      .eq("is_active", true)
      .gt("remaining_spots", 0)
      .order("created_at", { ascending: false });

    return NextResponse.json({ listings: listings || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: purchase a WL spot
export async function POST(req: NextRequest) {
  try {
    const { wallet, listingId, wlWallet } = await req.json();

    if (!wallet || !listingId || !wlWallet) {
      return NextResponse.json({ error: "Missing wallet, listingId, or wlWallet" }, { status: 400 });
    }

    // Validate wlWallet format
    if (!/^0x[a-fA-F0-9]{40}$/.test(wlWallet)) {
      return NextResponse.json({ error: "Invalid WL wallet address format" }, { status: 400 });
    }

    const w = wallet.toLowerCase();
    const wlw = wlWallet.toLowerCase();
    const sb = getServiceSupabase();

    // Get listing
    const { data: listing } = await sb
      .from("store_listings")
      .select("*")
      .eq("id", listingId)
      .eq("is_active", true)
      .single();

    if (!listing) {
      return NextResponse.json({ error: "Listing not found or inactive" }, { status: 404 });
    }

    if (listing.remaining_spots <= 0) {
      return NextResponse.json({ error: "No spots remaining" }, { status: 400 });
    }

    // Check if already purchased this listing
    const { data: existing } = await sb
      .from("store_purchases")
      .select("id")
      .eq("listing_id", listingId)
      .eq("buyer_wallet", w)
      .single();

    if (existing) {
      return NextResponse.json({ error: "You already purchased this WL" }, { status: 400 });
    }

    // Check if wl_wallet already has a spot
    const { data: wlExisting } = await sb
      .from("store_purchases")
      .select("id")
      .eq("listing_id", listingId)
      .eq("wl_wallet", wlw)
      .single();

    if (wlExisting) {
      return NextResponse.json({ error: "This wallet already has a WL spot for this project" }, { status: 400 });
    }

    // Get buyer balance
    const { data: staker } = await sb
      .from("stakers")
      .select("cum_balance, cum_total_spent")
      .eq("wallet_address", w)
      .single();

    if (!staker) {
      return NextResponse.json({ error: "No staker profile found. Stake first!" }, { status: 400 });
    }

    const balance = parseFloat(staker.cum_balance) || 0;
    const price = listing.price_cum;

    if (balance < price) {
      return NextResponse.json({
        error: `Not enough $CUM. Need ${price}, have ${balance}`,
        balance,
        price,
      }, { status: 400 });
    }

    // Deduct balance
    const newBalance = balance - price;
    const newSpent = (parseFloat(staker.cum_total_spent) || 0) + price;

    await sb.from("stakers").update({
      cum_balance: newBalance,
      cum_total_spent: newSpent,
    }).eq("wallet_address", w);

    // Reduce spots
    await sb.from("store_listings").update({
      remaining_spots: listing.remaining_spots - 1,
    }).eq("id", listingId);

    // Record purchase
    await sb.from("store_purchases").insert({
      listing_id: listingId,
      buyer_wallet: w,
      wl_wallet: wlw,
      cum_spent: price,
    });

    return NextResponse.json({
      success: true,
      spent: price,
      newBalance,
      wlWallet: wlw,
      listing: listing.title,
      remainingSpots: listing.remaining_spots - 1,
    });
  } catch (err: any) {
    console.error("Purchase error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
