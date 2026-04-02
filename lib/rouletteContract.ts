/**
 * CambrilioRoulette contract — ABI and address config.
 * Set NEXT_PUBLIC_ROULETTE_CONTRACT in .env.local after deploying.
 */

export const ROULETTE_CONTRACT_ADDRESS = (
  process.env.NEXT_PUBLIC_ROULETTE_CONTRACT || "0x0000000000000000000000000000000000000000"
) as `0x${string}`;

export const NFT_CONTRACT_ADDRESS = (
  process.env.NEXT_PUBLIC_NFT_CONTRACT || "0x0000000000000000000000000000000000000000"
) as `0x${string}`;

// Fee de protocolo por jogador (espelha PROTOCOL_FEE no contrato)
export const PROTOCOL_FEE = 240_000_000_000_000n; // 0.00024 ETH em wei

// ─── Color helpers ────────────────────────────────────────────────────────────
// slot  0       = GREEN  (house)
// slots 1-15    = RED
// slots 16-30   = BLACK
export const RED   = 0 as const;
export const BLACK = 1 as const;
export const GREEN = 2 as const;

export type RouletteColor = "red" | "black" | "green";

export const slotToColor = (slot: number): RouletteColor => {
  if (slot === 0)   return "green";
  if (slot <= 15)   return "red";
  return "black";
};

export const colorLabelFromResult = (result: number): RouletteColor => {
  if (result === 0) return "red";
  if (result === 1) return "black";
  return "green";
};

// ─── Status map ───────────────────────────────────────────────────────────────
// 0=Waiting 1=Active 2=Spinning 3=Complete 4=Cancelled 5=Expired
export const ROULETTE_STATUS_MAP: Record<
  number,
  "waiting" | "active" | "spinning" | "complete" | "cancelled" | "expired"
> = {
  0: "waiting",
  1: "active",
  2: "spinning",
  3: "complete",
  4: "cancelled",
  5: "expired",
};

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ─── CambrilioRoulette ABI ────────────────────────────────────────────────────
export const ROULETTE_ABI = [
  // ── Write ──
  {
    name: "createRoom",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "tokenIds", type: "uint256[]" },
      { name: "color",    type: "uint8"     }, // 0=RED 1=BLACK
      { name: "name",     type: "string"    },
    ],
    outputs: [],
  },
  {
    name: "joinRoom",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "roomId",   type: "uint256"   },
      { name: "tokenIds", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    name: "spin",
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
  {
    name: "withdrawFees",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }],
    outputs: [],
  },
  {
    name: "emergencyWithdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIds", type: "uint256[]" },
      { name: "to",       type: "address"   },
    ],
    outputs: [],
  },
  {
    name: "setPaused",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_paused", type: "bool" }],
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
    name: "paused",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "pendingFees",
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
      { name: "redPlayer",   type: "address" },
      { name: "blackPlayer", type: "address" },
      { name: "nftCount",    type: "uint8"   },
      { name: "status",      type: "uint8"   }, // 0=Waiting 1=Active 2=Spinning 3=Complete 4=Cancelled 5=Expired
      { name: "winner",      type: "address" }, // address(0) if GREEN
      { name: "result",      type: "uint8"   }, // 0=RED 1=BLACK 2=GREEN — valid when Complete
      { name: "spinSlot",    type: "uint8"   }, // 0-30 actual roulette number
      { name: "createdAt",   type: "uint256" },
      { name: "activatedAt", type: "uint256" },
      { name: "ethAmount",   type: "uint256" },
      { name: "name",        type: "string"  },
    ],
  },
  {
    name: "getRoomTokenIds",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "roomId", type: "uint256" }],
    outputs: [
      { name: "redTokenIds",   type: "uint256[]" },
      { name: "blackTokenIds", type: "uint256[]" },
    ],
  },
  {
    name: "getRecentRooms",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "count", type: "uint256" }],
    outputs: [
      { name: "ids",          type: "uint256[]" },
      { name: "redPlayers",   type: "address[]" },
      { name: "blackPlayers", type: "address[]" },
      { name: "nftCounts",    type: "uint8[]"   },
      { name: "statuses",     type: "uint8[]"   },
      { name: "winners",      type: "address[]" },
      { name: "results",      type: "uint8[]"   },
      { name: "spinSlots",    type: "uint8[]"   },
      { name: "createdAts",   type: "uint256[]" },
    ],
  },
  {
    name: "getRecentRoomsExtra",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "count", type: "uint256" }],
    outputs: [
      { name: "ids",        type: "uint256[]" },
      { name: "ethAmounts", type: "uint256[]" },
      { name: "names",      type: "string[]"  },
    ],
  },
  {
    name: "vrfRequestToRoom",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  // ── Events ──
  {
    name: "RoomCreated",
    type: "event",
    inputs: [
      { name: "roomId",   type: "uint256",   indexed: true  },
      { name: "creator",  type: "address",   indexed: true  },
      { name: "color",    type: "uint8",     indexed: false }, // 0=RED 1=BLACK
      { name: "tokenIds", type: "uint256[]", indexed: false },
    ],
  },
  {
    name: "RoomJoined",
    type: "event",
    inputs: [
      { name: "roomId",     type: "uint256",   indexed: true  },
      { name: "challenger", type: "address",   indexed: true  },
      { name: "color",      type: "uint8",     indexed: false }, // 0=RED 1=BLACK
      { name: "tokenIds",   type: "uint256[]", indexed: false },
    ],
  },
  {
    name: "SpinRequested",
    type: "event",
    inputs: [
      { name: "roomId",    type: "uint256", indexed: true },
      { name: "requestId", type: "uint256", indexed: true },
    ],
  },
  {
    name: "SpinResult",
    type: "event",
    inputs: [
      { name: "roomId",         type: "uint256",   indexed: true  },
      { name: "slot",           type: "uint8",     indexed: false }, // 0-30 for animation
      { name: "result",         type: "uint8",     indexed: false }, // 0=RED 1=BLACK 2=GREEN
      { name: "winner",         type: "address",   indexed: true  }, // address(0) on GREEN
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

// ─── ERC-721 minimal ABI (approval) ──────────────────────────────────────────
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
      { name: "approved", type: "bool"    },
    ],
    outputs: [],
  },
] as const;
