/**
 * CambrilioFlip contract — ABI and address config.
 * Set NEXT_PUBLIC_BET_CONTRACT in .env.local after deploying.
 */

export const BET_CONTRACT_ADDRESS = (
  process.env.NEXT_PUBLIC_BET_CONTRACT || "0x0000000000000000000000000000000000000000"
) as `0x${string}`;

export const NFT_CONTRACT_ADDRESS = (
  process.env.NEXT_PUBLIC_NFT_CONTRACT || "0x0000000000000000000000000000000000000000"
) as `0x${string}`;

// ─── CambrilioFlip ABI ────────────────────────────────────────────────────────
export const BET_ABI = [
  // ── Write ──
  {
    name: "createRoom",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIds", type: "uint256[]" },
      { name: "choice",   type: "uint8" },
    ],
    outputs: [],
  },
  {
    name: "joinRoom",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roomId",   type: "uint256" },
      { name: "tokenIds", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    name: "flip",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "roomId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "cancelRoom",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "roomId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "refundExpired",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "roomId", type: "uint256" }],
    outputs: [],
  },
  // ── Read ──
  {
    name: "roomCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "FLIP_TIMEOUT",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getRoom",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "roomId", type: "uint256" }],
    outputs: [
      { name: "creator",       type: "address" },
      { name: "challenger",    type: "address" },
      { name: "nftCount",      type: "uint8"   },
      { name: "status",        type: "uint8"   }, // 0=Waiting 1=Active 2=Flipping 3=Complete 4=Cancelled 5=Expired
      { name: "winner",        type: "address" },
      { name: "coinResult",    type: "uint8"   },
      { name: "creatorChoice", type: "uint8"   },
      { name: "createdAt",     type: "uint256" },
      { name: "activatedAt",   type: "uint256" },
    ],
  },
  {
    name: "getRoomTokenIds",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "roomId", type: "uint256" }],
    outputs: [
      { name: "creatorTokenIds",    type: "uint256[]" },
      { name: "challengerTokenIds", type: "uint256[]" },
    ],
  },
  {
    name: "getRecentRooms",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "count", type: "uint256" }],
    outputs: [
      { name: "ids",            type: "uint256[]" },
      { name: "creators",       type: "address[]" },
      { name: "challengers",    type: "address[]" },
      { name: "nftCounts",      type: "uint8[]"   },
      { name: "statuses",       type: "uint8[]"   },
      { name: "winners",        type: "address[]" },
      { name: "coinResults",    type: "uint8[]"   },
      { name: "creatorChoices", type: "uint8[]"   },
      { name: "createdAts",     type: "uint256[]" },
    ],
  },
  {
    name: "paused",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  // ── Events ──
  {
    name: "RoomCreated",
    type: "event",
    inputs: [
      { name: "roomId",   type: "uint256", indexed: true  },
      { name: "creator",  type: "address", indexed: true  },
      { name: "tokenIds", type: "uint256[]", indexed: false },
      { name: "choice",   type: "uint8",   indexed: false },
    ],
  },
  {
    name: "RoomJoined",
    type: "event",
    inputs: [
      { name: "roomId",     type: "uint256", indexed: true  },
      { name: "challenger", type: "address", indexed: true  },
      { name: "tokenIds",   type: "uint256[]", indexed: false },
    ],
  },
  {
    name: "FlipRequested",
    type: "event",
    inputs: [
      { name: "roomId",    type: "uint256", indexed: true },
      { name: "requestId", type: "uint256", indexed: true },
    ],
  },
  {
    name: "FlipResult",
    type: "event",
    inputs: [
      { name: "roomId",         type: "uint256",   indexed: true  },
      { name: "result",         type: "uint8",     indexed: false },
      { name: "winner",         type: "address",   indexed: true  },
      { name: "winnerTokenIds", type: "uint256[]", indexed: false },
    ],
  },
  {
    name: "RoomCancelled",
    type: "event",
    inputs: [
      { name: "roomId",  type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
    ],
  },
  {
    name: "RoomExpired",
    type: "event",
    inputs: [
      { name: "roomId", type: "uint256", indexed: true },
    ],
  },
] as const;

// ─── ERC-721 minimal ABI (for approval calls) ────────────────────────────────
export const ERC721_ABI = [
  {
    name: "isApprovedForAll",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner",    type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "setApprovalForAll",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────
// Status enum: 0=Waiting 1=Active 2=Flipping 3=Complete 4=Cancelled 5=Expired
export const STATUS_MAP: Record<number, "waiting" | "active" | "flipping" | "complete" | "cancelled" | "expired"> = {
  0: "waiting",
  1: "active",
  2: "flipping",
  3: "complete",
  4: "cancelled",
  5: "expired",
};

export const choiceToSide = (c: number): "heads" | "tails" => (c === 0 ? "heads" : "tails");
export const sideToChoice = (s: "heads" | "tails"): number => (s === "heads" ? 0 : 1);
export const ZERO_ADDRESS  = "0x0000000000000000000000000000000000000000";
