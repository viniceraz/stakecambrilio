import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

const BURN_ADDRESSES = [
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
  "0x0000000000000000000000000000000000000001",
];
const NFT_CONTRACT = (process.env.NEXT_PUBLIC_NFT_CONTRACT || "").toLowerCase();
const ALC_RPC = "https://base-mainnet.g.alchemy.com/v2/Th1sSdMq3_Pi8ukOmUwyw";

// ERC721 Transfer(address,address,uint256) event signature
const TRANSFER_SIG = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Verify burn transactions — supports BULK (single tx with multiple transfers)
// Returns ALL burned token IDs found across all provided tx hashes
async function verifyBurnTxs(
  txHashes: string[],
  wallet: string,
  requiredCount: number
): Promise<{ valid: boolean; tokenIds: string[]; error?: string }> {
  const allTokenIds: string[] = [];
  const seenTokenIds = new Set<string>();

  for (const txHash of txHashes) {
    try {
      const res = await fetch(ALC_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getTransactionReceipt",
          params: [txHash],
        }),
      });
      const data = await res.json();
      const receipt = data.result;

      if (!receipt || receipt.status !== "0x1") {
        return { valid: false, tokenIds: [], error: `Transaction ${txHash.slice(0, 12)}... failed or not found` };
      }

      // Scan ALL logs for ERC721 Transfer events from our contract
      for (const log of receipt.logs || []) {
        if (
          log.address?.toLowerCase() === NFT_CONTRACT &&
          log.topics?.[0] === TRANSFER_SIG &&
          log.topics?.length >= 4
        ) {
          const from = "0x" + (log.topics[1] || "").slice(26).toLowerCase();
          const to = "0x" + (log.topics[2] || "").slice(26).toLowerCase();
          const tokenId = parseInt(log.topics[3] || "0", 16).toString();

          // Verify: from = user wallet, to = burn address
          if (from === wallet.toLowerCase() && BURN_ADDRESSES.includes(to)) {
            if (!seenTokenIds.has(tokenId)) {
              seenTokenIds.add(tokenId);
              allTokenIds.push(tokenId);
            }
          }
        }
      }
    } catch (err: any) {
      return { valid: false, tokenIds: [], error: `Error verifying ${txHash.slice(0, 12)}...: ${err.message}` };
    }
  }

  if (allTokenIds.length < requiredCount) {
    return {
      valid: false,
      tokenIds: allTokenIds,
      error: `Found ${allTokenIds.length} valid burn(s) but need ${requiredCount}. Make sure you sent Cambrilio NFTs to a burn address (0x...dead or 0x...0000).`,
    };
  }

  return { valid: true, tokenIds: allTokenIds };
}

async function isAdmin(wallet: string): Promise<boolean> {
  const sb = getServiceSupabase();
  const { data } = await sb
    .from("admins")
    .select("wallet_address")
    .eq("wallet_address", wallet.toLowerCase())
    .single();
  return !!data;
}

// GET: list burn rewards + user claims
export async function GET(req: NextRequest) {
  try {
    const sb = getServiceSupabase();
    const wallet = req.nextUrl.searchParams.get("wallet");
    const admin = req.nextUrl.searchParams.get("admin");

    // Get all active rewards (or all rewards for admin)
    let rewardsQuery = sb.from("burn_rewards").select("*").order("created_at", { ascending: false });
    if (!admin) rewardsQuery = rewardsQuery.eq("is_active", true);
    const { data: rewards } = await rewardsQuery;

    // User claims
    let claims: any[] = [];
    if (wallet) {
      const { data } = await sb
        .from("burn_claims")
        .select("*, burn_rewards(title, image_url)")
        .eq("wallet_address", wallet.toLowerCase())
        .order("submitted_at", { ascending: false });
      claims = data || [];
    }

    // All claims for admin
    let allClaims: any[] = [];
    if (admin && wallet && (await isAdmin(wallet))) {
      const { data } = await sb
        .from("burn_claims")
        .select("*, burn_rewards(title, image_url)")
        .order("submitted_at", { ascending: false });
      allClaims = data || [];
    }

    return NextResponse.json({ rewards: rewards || [], claims, allClaims });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: submit burn claim OR admin create reward
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sb = getServiceSupabase();

    // ═══ Admin: create reward ═══
    if (body.action === "create_reward") {
      if (!body.wallet || !(await isAdmin(body.wallet))) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }

      const { data, error } = await sb
        .from("burn_rewards")
        .insert({
          title: body.title,
          description: body.description || "",
          image_url: body.imageUrl || "",
          burn_cost: parseInt(body.burnCost),
          total_supply: parseInt(body.totalSupply),
          remaining_supply: parseInt(body.totalSupply),
          expires_at: body.expiresAt || null,
          starts_at: body.startsAt || null,
        })
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ success: true, reward: data });
    }

    // ═══ User: submit burn claim ═══
    const { wallet, rewardId, txHashes } = body;

    if (!wallet || !rewardId || !txHashes?.length) {
      return NextResponse.json({ error: "Missing wallet, rewardId, or txHashes" }, { status: 400 });
    }

    const w = wallet.toLowerCase();

    // Get reward info
    const { data: reward } = await sb
      .from("burn_rewards")
      .select("*")
      .eq("id", rewardId)
      .eq("is_active", true)
      .single();

    if (!reward) {
      return NextResponse.json({ error: "Reward not found or inactive" }, { status: 404 });
    }

    if (reward.remaining_supply <= 0) {
      return NextResponse.json({ error: "No more rewards available" }, { status: 400 });
    }

    // Check if burn has started yet
    if (reward.starts_at && new Date(reward.starts_at).getTime() > Date.now()) {
      return NextResponse.json({ error: "This burn reward has not opened yet" }, { status: 400 });
    }

    // Check if burn has expired
    if (reward.expires_at && new Date(reward.expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ error: "This burn reward has expired" }, { status: 400 });
    }

    // Check if wallet already claimed this reward
    const { data: existingClaim } = await sb
      .from("burn_claims")
      .select("id")
      .eq("wallet_address", w)
      .eq("reward_id", rewardId)
      .not("status", "eq", "rejected")
      .single();

    if (existingClaim) {
      return NextResponse.json({ error: "You already submitted a claim for this reward" }, { status: 400 });
    }

    // Clean tx hashes
    const cleanHashes = txHashes
      .map((h: string) => h.trim())
      .filter((h: string) => h.startsWith("0x") && h.length === 66);

    if (cleanHashes.length === 0) {
      return NextResponse.json({ error: "No valid transaction hashes provided" }, { status: 400 });
    }

    // Verify ALL burn transactions on-chain (supports bulk: 1 tx = many burns)
    const result = await verifyBurnTxs(cleanHashes, w, reward.burn_cost);

    if (!result.valid) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Take only the required amount of token IDs
    const claimedTokenIds = result.tokenIds.slice(0, reward.burn_cost);

    // Submit claim
    const { data: claim, error } = await sb
      .from("burn_claims")
      .insert({
        reward_id: rewardId,
        wallet_address: w,
        token_ids: claimedTokenIds,
        tx_hashes: cleanHashes,
        status: "verified",
      })
      .select()
      .single();

    if (error) throw error;

    // Reduce remaining supply
    await sb
      .from("burn_rewards")
      .update({ remaining_supply: reward.remaining_supply - 1 })
      .eq("id", rewardId);

    return NextResponse.json({
      success: true,
      claim,
      burnedTokenIds: claimedTokenIds,
      totalBurnsFound: result.tokenIds.length,
      message: `Verified ${claimedTokenIds.length} burn(s) from ${cleanHashes.length} transaction(s). Reward will be delivered!`,
    });
  } catch (err: any) {
    console.error("Burn error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT: admin update claim status
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { wallet, claimId, status, notes } = body;

    if (!wallet || !(await isAdmin(wallet))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const sb = getServiceSupabase();
    const updates: any = { status, admin_notes: notes || null };
    if (status === "verified") updates.verified_at = new Date().toISOString();
    if (status === "delivered") updates.delivered_at = new Date().toISOString();

    // If rejecting, restore supply
    if (status === "rejected") {
      const { data: claim } = await sb
        .from("burn_claims")
        .select("reward_id")
        .eq("id", claimId)
        .single();
      if (claim) {
        const { data: reward } = await sb
          .from("burn_rewards")
          .select("remaining_supply")
          .eq("id", claim.reward_id)
          .single();
        if (reward) {
          await sb
            .from("burn_rewards")
            .update({ remaining_supply: reward.remaining_supply + 1 })
            .eq("id", claim.reward_id);
        }
      }
    }

    await sb.from("burn_claims").update(updates).eq("id", claimId);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE: admin delete a burn reward
export async function DELETE(req: NextRequest) {
  try {
    const { wallet, rewardId } = await req.json();

    if (!wallet || !(await isAdmin(wallet))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const sb = getServiceSupabase();

    // Check if there are any non-rejected claims
    const { data: claims } = await sb
      .from("burn_claims")
      .select("id")
      .eq("reward_id", rewardId)
      .not("status", "eq", "rejected");

    if (claims && claims.length > 0) {
      // Soft delete — just deactivate (has claims attached)
      await sb
        .from("burn_rewards")
        .update({ is_active: false })
        .eq("id", rewardId);
      return NextResponse.json({ success: true, method: "deactivated", reason: "Has active claims" });
    } else {
      // Hard delete — no claims, safe to remove
      await sb
        .from("burn_claims")
        .delete()
        .eq("reward_id", rewardId);
      await sb
        .from("burn_rewards")
        .delete()
        .eq("id", rewardId);
      return NextResponse.json({ success: true, method: "deleted" });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
