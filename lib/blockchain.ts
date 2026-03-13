const ALC_KEY = process.env.NEXT_PUBLIC_ALCHEMY_KEY || "";
const ALC_NFT = `https://base-mainnet.g.alchemy.com/nft/v3/${ALC_KEY}`;
const ALC_RPC = `https://base-mainnet.g.alchemy.com/v2/${ALC_KEY}`;
const OS_API = "https://api.opensea.io/api/v2";
const OS_KEY = process.env.OPENSEA_KEY || "";
const CONTRACT = process.env.NEXT_PUBLIC_NFT_CONTRACT || "";
const SLUG = process.env.NEXT_PUBLIC_COLLECTION_SLUG || "cambrilio";

export interface NFTTrait {
  trait_type: string;
  value: string;
}

export interface OwnedNFT {
  tokenId: string;
  name: string;
  image: string;
  traits: NFTTrait[];
  boostMultiplier: number;
}

// ═══ BOOST CONFIG ═══
const PARTY_HAT_TRAITS = [
  "white_party_hat",
  "blue_party_hat",
  "red_party_hat",
  "green_party_hat",
  "purple_party_hat",
];

export function getBoostMultiplier(traits: NFTTrait[]): number {
  let boost = 1;
  for (const t of traits) {
    const val = String(t.value).toLowerCase().trim();
    const traitType = String(t.trait_type).toLowerCase().trim();
    // 5x for 1/1 trait (highest priority)
    if (val === "1/1" || traitType === "1/1") return 5;
    // 3x for party hat traits
    if (PARTY_HAT_TRAITS.includes(val) || PARTY_HAT_TRAITS.includes(traitType)) {
      boost = Math.max(boost, 3);
    }
  }
  return boost;
}

function parseTraits(nft: any): NFTTrait[] {
  const raw =
    nft.raw?.metadata?.attributes ||
    nft.metadata?.attributes ||
    nft.rawMetadata?.attributes ||
    [];
  const attrs = Array.isArray(raw) ? raw : [];
  return attrs
    .filter((a: any) => a && a.trait_type !== undefined && a.value !== undefined)
    .map((a: any) => ({ trait_type: String(a.trait_type), value: String(a.value) }));
}

// Get ALL Cambrilio NFTs owned by a wallet (paginated, handles 200+ NFTs)
export async function getOwnedCambrilios(wallet: string): Promise<OwnedNFT[]> {
  const all: OwnedNFT[] = [];
  let pageKey: string | undefined = undefined;

  try {
    do {
      const url = `${ALC_NFT}/getNFTsForOwner?owner=${wallet}&contractAddresses[]=${CONTRACT}&withMetadata=true&pageSize=100${pageKey ? `&pageKey=${pageKey}` : ""}`;
      const r = await fetch(url);
      const data = await r.json();

      const nfts = (data.ownedNfts || []).map((nft: any) => {
        try {
          const traits = parseTraits(nft);
          return {
            tokenId: nft.tokenId || String(parseInt(nft.id?.tokenId || "0", 16)),
            name: nft.name || nft.title || `Cambrilio #${nft.tokenId}`,
            image: nft.image?.cachedUrl || nft.image?.thumbnailUrl || nft.image?.originalUrl || "",
            traits,
            boostMultiplier: getBoostMultiplier(traits),
          };
        } catch {
          return {
            tokenId: nft.tokenId || String(parseInt(nft.id?.tokenId || "0", 16)),
            name: nft.name || nft.title || `Cambrilio #${nft.tokenId}`,
            image: nft.image?.cachedUrl || nft.image?.thumbnailUrl || nft.image?.originalUrl || "",
            traits: [],
            boostMultiplier: 1,
          };
        }
      });

      all.push(...nfts);
      pageKey = data.pageKey || undefined;
    } while (pageKey);
  } catch (err) {
    console.error("Alchemy getNFTs error:", err);
  }

  return all;
}

// Check if specific token IDs are still owned by the wallet
export async function verifyOwnership(wallet: string, tokenIds: string[]): Promise<Set<string>> {
  const owned = await getOwnedCambrilios(wallet);
  const ownedIds = new Set(owned.map((n) => n.tokenId));
  return new Set(tokenIds.filter((id) => ownedIds.has(id)));
}

// Check which token IDs are listed on OpenSea (server-side only)
export async function getListedTokenIds(): Promise<Set<string>> {
  const listed = new Set<string>();
  try {
    let cursor: string | null = null;
    do {
      const ep = `/listings/collection/${SLUG}/all?limit=100${cursor ? `&next=${cursor}` : ""}`;
      const res = await fetch(`${OS_API}${ep}`, {
        headers: { "x-api-key": OS_KEY, Accept: "application/json" },
      });
      if (!res.ok) break;
      const data = await res.json();
      (data.listings || []).forEach((l: any) => {
        const offer = (l.protocol_data || l)?.parameters?.offer?.[0];
        if (offer) {
          const id = offer.identifierOrCriteria || "";
          if (id) listed.add(id);
        }
      });
      cursor = data.next || null;
      if (cursor) await new Promise((r) => setTimeout(r, 300));
    } while (cursor);
  } catch (err) {
    console.error("OpenSea listings error:", err);
  }
  return listed;
}

// Server-side: get traits + boost for specific token IDs via Alchemy batch
export async function getNFTTraits(tokenIds: string[]): Promise<Map<string, { traits: NFTTrait[]; boost: number }>> {
  const result = new Map<string, { traits: NFTTrait[]; boost: number }>();
  try {
    // Alchemy getNFTMetadataBatch (v3)
    const tokens = tokenIds.map((id) => ({ contractAddress: CONTRACT, tokenId: id }));
    // Process in batches of 100
    for (let i = 0; i < tokens.length; i += 100) {
      const batch = tokens.slice(i, i + 100);
      const res = await fetch(`${ALC_NFT}/getNFTMetadataBatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokens: batch }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const nfts = data.nfts || data;
      if (Array.isArray(nfts)) {
        for (const nft of nfts) {
          const tid = nft.tokenId || String(parseInt(nft.id?.tokenId || "0", 16));
          const traits = parseTraits(nft);
          result.set(tid, { traits, boost: getBoostMultiplier(traits) });
        }
      }
    }
  } catch (err) {
    console.error("getNFTTraits error:", err);
  }
  // Default boost 1 for tokens we couldn't fetch
  for (const id of tokenIds) {
    if (!result.has(id)) result.set(id, { traits: [], boost: 1 });
  }
  return result;
}

// Force Alchemy to refresh cached metadata for specific tokens
export async function refreshNFTMetadata(tokenIds: string[]): Promise<number> {
  let refreshed = 0;
  try {
    for (const tokenId of tokenIds) {
      // Use getNFTMetadata with refreshCache=true to force Alchemy to re-fetch from source
      const url = `${ALC_NFT}/getNFTMetadata?contractAddress=${CONTRACT}&tokenId=${tokenId}&refreshCache=true`;
      const res = await fetch(url);
      if (res.ok) refreshed++;
      // Rate limit
      if (tokenIds.length > 1) await new Promise((r) => setTimeout(r, 300));
    }
  } catch (err) {
    console.error("refreshNFTMetadata error:", err);
  }
  return refreshed;
}

// Client-side: check listings (through our API route to hide OS key)
export async function checkListedClient(tokenIds: string[]): Promise<Set<string>> {
  try {
    const res = await fetch("/api/check-listed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenIds }),
    });
    const data = await res.json();
    return new Set(data.listed || []);
  } catch {
    return new Set();
  }
}
