import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

async function isAdmin(wallet: string): Promise<boolean> {
  const sb = getServiceSupabase();
  const { data } = await sb.from("admins").select("wallet_address").eq("wallet_address", wallet.toLowerCase()).single();
  return !!data;
}

// GET: admin data
export async function GET(req: NextRequest) {
  try {
    const wallet = req.nextUrl.searchParams.get("wallet");
    if (!wallet || !(await isAdmin(wallet))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    const sb = getServiceSupabase();
    const [{ data: listings }, { data: purchases }, { data: stakers }] = await Promise.all([
      sb.from("store_listings").select("*").order("created_at", { ascending: false }),
      sb.from("store_purchases").select("*, store_listings(title)").order("purchased_at", { ascending: false }),
      sb.from("stakers").select("*").eq("is_active", true).gt("total_staked", 0).order("total_staked", { ascending: false }),
    ]);
    return NextResponse.json({ listings, purchases, stakers });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: create new listing
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      wallet,
      title,
      description,
      imageUrl,
      projectUrl,
      priceCum,
      totalSpots,
      startsAt,
      expiresAt,
      maxPerWallet,
      // WL project metadata
      isWlProject,
      wlMintPrice,
      wlChain,
      wlSupply,
      wlDescription,
    } = body;
    if (!wallet || !(await isAdmin(wallet))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    if (!title || !priceCum || !totalSpots) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const sb = getServiceSupabase();

    const isWl = !!isWlProject;
    const chain = typeof wlChain === "string" && wlChain.length > 0 ? wlChain : null;

    const { data, error } = await sb.from("store_listings").insert({
      title,
      description: description || "",
      image_url: imageUrl || "",
      project_url: projectUrl || "",
      price_cum: parseInt(priceCum),
      total_spots: parseInt(totalSpots),
      remaining_spots: parseInt(totalSpots),
      starts_at: startsAt || null,
      expires_at: expiresAt || null,
      max_per_wallet: parseInt(maxPerWallet) || 1,
      // WL project metadata (optional, for WL listings)
      is_wl_project: isWl,
      wl_mint_price: isWl && wlMintPrice != null && wlMintPrice !== "" ? wlMintPrice : null,
      wl_chain: isWl ? chain : null,
      wl_supply: isWl && wlSupply != null && wlSupply !== "" ? parseInt(wlSupply) : null,
      wl_description: isWl && wlDescription ? wlDescription : null,
    }).select().single();
    if (error) throw error;
    return NextResponse.json({ success: true, listing: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT: update listing OR update settings
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { wallet, listingId, updates, setting } = body;
    if (!wallet || !(await isAdmin(wallet))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    const sb = getServiceSupabase();

    // Handle settings update
    if (setting) {
      await sb.from("settings").upsert({
        key: setting.key,
        value: setting.value,
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
      return NextResponse.json({ success: true });
    }

    // Handle listing update
    if (listingId && updates) {
      const { data, error } = await sb
        .from("store_listings")
        .update(updates)
        .eq("id", listingId)
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ success: true, listing: data });
    }

    return NextResponse.json({ error: "Missing listingId/updates or setting" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
