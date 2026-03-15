import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

// Treat timestamps saved via <input type="datetime-local" /> as local time,
// ignoring any timezone suffix that may have been added when stored.
const parseLocalTimestamp = (value: string | null) => {
  if (!value) return null;
  const cleaned = value.replace(/([+-]\d{2}:?\d{2}|Z)$/i, "");
  const d = new Date(cleaned);
  if (isNaN(d.getTime())) return null;
  return d;
};

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

    const w = wallet.toLowerCase();
    const sb = getServiceSupabase();

    // Get listing (includes WL metadata / chain)
    const { data: listing } = await sb
      .from("store_listings")
      .select("*")
      .eq("id", listingId)
      .eq("is_active", true)
      .single();

    if (!listing) {
      return NextResponse.json({ error: "Listing not found or inactive" }, { status: 404 });
    }

    const isWlProject = (listing as any).is_wl_project === true;
    const wlChain: string = (listing as any).wl_chain || "ETH";

    const validateWlAddress = (chain: string, addr: string): string | null => {
      const v = (addr || "").trim();
      if (!v) return "WL wallet address is required";
      if (chain === "SOL") {
        // Basic Solana base58 check (length + charset)
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) {
          return "Invalid SOL address format";
        }
        return null;
      }
      if (chain === "BTC") {
        // Simple bech32 Ordinals-style address (bc1...)
        if (!/^bc1[0-9a-z]{25,80}$/.test(v)) {
          return "Invalid BTC Ordinals address format";
        }
        return null;
      }
      // Default: ETH
      if (!/^0x[a-fA-F0-9]{40}$/.test(v)) {
        return "Invalid ETH address format";
      }
      return null;
    };

    const validationError = validateWlAddress(isWlProject ? wlChain : "ETH", wlWallet);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    // Normalize WL wallet for storage / uniqueness
    const rawWl = wlWallet.trim();
    const wlw = isWlProject && wlChain !== "ETH" ? rawWl : rawWl.toLowerCase();

    const now = Date.now();
    const startsAt = listing.starts_at ? parseLocalTimestamp(listing.starts_at as any) : null;
    const expiresAt = listing.expires_at ? parseLocalTimestamp(listing.expires_at as any) : null;
    if (startsAt && startsAt.getTime() > now) {
      return NextResponse.json({ error: "Sale has not started yet" }, { status: 400 });
    }
    if (expiresAt && expiresAt.getTime() <= now) {
      return NextResponse.json({ error: "Sale has ended" }, { status: 400 });
    }

    if (listing.remaining_spots <= 0) {
      return NextResponse.json({ error: "No spots remaining" }, { status: 400 });
    }

    // Check per-wallet purchase limit
    const maxPerWallet = listing.max_per_wallet || 1;
    const { data: existingPurchases } = await sb
      .from("store_purchases")
      .select("id")
      .eq("listing_id", listingId)
      .eq("buyer_wallet", w);

    const purchaseCount = existingPurchases?.length || 0;
    if (purchaseCount >= maxPerWallet) {
      return NextResponse.json({
        error: maxPerWallet === 1
          ? "You already purchased this WL"
          : `Limit reached (${purchaseCount}/${maxPerWallet} per wallet)`,
      }, { status: 400 });
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
