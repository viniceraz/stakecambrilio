const ALC_KEY = process.env.NEXT_PUBLIC_ALCHEMY_KEY || "";
const ALC_NFT = `https://base-mainnet.g.alchemy.com/nft/v3/${ALC_KEY}`;
const ALC_RPC = `https://base-mainnet.g.alchemy.com/v2/${ALC_KEY}`;
const OS_API = "https://api.opensea.io/api/v2";
const OS_KEY = process.env.OPENSEA_KEY || "";
const CONTRACT = process.env.NEXT_PUBLIC_NFT_CONTRACT || "";
const SLUG = process.env.NEXT_PUBLIC_COLLECTION_SLUG || "cambrilio";

export interface OwnedNFT {
  tokenId: string;
  name: string;
  image: string;
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

      const nfts = (data.ownedNfts || []).map((nft: any) => ({
        tokenId: nft.tokenId || String(parseInt(nft.id?.tokenId || "0", 16)),
        name: nft.name || nft.title || `Cambrilio #${nft.tokenId}`,
        image: nft.image?.cachedUrl || nft.image?.thumbnailUrl || nft.image?.originalUrl || "",
      }));

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
