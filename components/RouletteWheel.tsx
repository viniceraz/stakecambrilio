"use client";

import { useEffect, useRef } from "react";

// ─── Roulette layout: 31 slots ────────────────────────────────────────────────
// slot  0       = GREEN  (house)
// slots 1-15    = RED
// slots 16-30   = BLACK
//
// DISPLAY_ORDER interleaves RED and BLACK visually (like a real roulette strip).
// The slot numbers still map to the correct colors per the contract.
const DISPLAY_ORDER = [
  0,
  1, 16, 2, 17, 3, 18, 4, 19, 5, 20,
  6, 21, 7, 22, 8, 23, 9, 24, 10, 25,
  11, 26, 12, 27, 13, 28, 14, 29, 15, 30,
];

const TILE_W       = 68;   // px per tile
const VISIBLE      = 9;    // how many tiles visible at once (odd = clean center)
const COPIES       = 40;   // how many times we duplicate the strip
const STRIP_LEN    = DISPLAY_ORDER.length;                    // 31
const CENTER_OFFSET = Math.floor(VISIBLE / 2) * TILE_W;      // 4 * 68 = 272px

// Build the full static strip array once
const FULL_STRIP = Array.from({ length: COPIES }, () => DISPLAY_ORDER).flat();

// ─── Color helpers ────────────────────────────────────────────────────────────
const tileBg = (slot: number) => {
  if (slot === 0)   return "#15803d"; // green-700
  if (slot <= 15)   return "#b91c1c"; // red-700
  return "#18181b";                    // zinc-900 (black)
};

const tileBorder = (slot: number) => {
  if (slot === 0)   return "#16a34a";
  if (slot <= 15)   return "#ef4444";
  return "#3f3f46";
};

// ─── Easing curve (strong deceleration) ──────────────────────────────────────
const STOP_DURATION = "3.8s";
const STOP_EASING   = "cubic-bezier(0.04, 0.60, 0.06, 1.00)";

// ─── Types ────────────────────────────────────────────────────────────────────
export type SpinResult = { slot: number; color: "red" | "black" | "green" };

interface RouletteWheelProps {
  /** true while waiting for VRF result */
  spinning: boolean;
  /** set when VRF result arrives (0-30); undefined while spinning */
  targetSlot?: number;
  /** called after the stop animation finishes */
  onDone?: (result: SpinResult) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function RouletteWheel({ spinning, targetSlot, onDone }: RouletteWheelProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const posRef   = useRef(0);   // current translateX in px
  const rafRef   = useRef<number>(0);

  // ── Phase 1: fast spin via RAF while waiting for VRF ──────────────────────
  useEffect(() => {
    const el = stripRef.current;
    if (!el || !spinning) return;

    const SPEED = 22; // px per frame @ 60 fps ≈ 1320 px/s
    let running = true;

    const tick = () => {
      posRef.current -= SPEED;

      // Seamless wrap: jump forward one strip copy so the strip never runs out
      const wrapThreshold = -(12 * STRIP_LEN * TILE_W);
      if (posRef.current < wrapThreshold) {
        posRef.current += STRIP_LEN * TILE_W;
      }

      el.style.transform = `translateX(${posRef.current}px)`;
      if (running) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [spinning]);

  // ── Phase 2: deceleration to landing slot ────────────────────────────────
  useEffect(() => {
    if (spinning || targetSlot === undefined) return;

    const el = stripRef.current;
    if (!el) return;

    // Cancel any running RAF
    cancelAnimationFrame(rafRef.current);

    const currentX = posRef.current;

    // Find the visual index of targetSlot in DISPLAY_ORDER
    const displayIdx = DISPLAY_ORDER.indexOf(targetSlot);

    // Land on copy #28 (deep in the strip = always enough room)
    let landingX = -(28 * STRIP_LEN * TILE_W + displayIdx * TILE_W - CENTER_OFFSET);

    // Guarantee we always scroll *forward* (more negative) from currentX
    // and that there's at least 4 full copies of "spin" before stopping
    while (landingX > currentX - 4 * STRIP_LEN * TILE_W) {
      landingX -= STRIP_LEN * TILE_W;
    }

    // Anchor the strip at currentX first (force reflow so the transition starts from here)
    el.style.transition = "none";
    el.style.transform  = `translateX(${currentX}px)`;
    void el.offsetHeight; // force reflow

    // Apply deceleration transition
    el.style.transition = `transform ${STOP_DURATION} ${STOP_EASING}`;
    el.style.transform  = `translateX(${landingX}px)`;
    posRef.current      = landingX;

    const stopMs = parseFloat(STOP_DURATION) * 1000 + 100;
    const timer = setTimeout(() => {
      el.style.transition = "none";

      const color: SpinResult["color"] =
        targetSlot === 0 ? "green" : targetSlot <= 15 ? "red" : "black";

      onDone?.({ slot: targetSlot, color });
    }, stopMs);

    return () => clearTimeout(timer);
  }, [spinning, targetSlot, onDone]);

  // ─── Render ─────────────────────────────────────────────────────────────────
  const containerW = VISIBLE * TILE_W;
  const tileH      = 88;

  return (
    <div
      style={{
        position:     "relative",
        width:        containerW,
        height:       tileH,
        overflow:     "hidden",
        borderRadius: 14,
        border:       "2px solid #1e1e35",
        background:   "#080a12",
        boxShadow:    "0 4px 32px rgba(0,0,0,0.6)",
        userSelect:   "none",
      }}
    >
      {/* ── Center-slot highlight (gold indicator) ───────────────────────── */}
      <div
        style={{
          position:     "absolute",
          left:         CENTER_OFFSET,
          top:          0,
          width:        TILE_W,
          height:       "100%",
          border:       "3px solid #c8ff00",
          borderRadius: 8,
          zIndex:       10,
          pointerEvents:"none",
          boxShadow:    "0 0 24px #c8ff0055, inset 0 0 12px #c8ff0022",
        }}
      />

      {/* ── Top/bottom edge markers ──────────────────────────────────────── */}
      <div style={{
        position:   "absolute",
        left:       CENTER_OFFSET + TILE_W / 2 - 6,
        top:        -4,
        width:      0,
        height:     0,
        borderLeft: "6px solid transparent",
        borderRight:"6px solid transparent",
        borderTop:  "10px solid #c8ff00",
        zIndex:     11,
      }} />
      <div style={{
        position:      "absolute",
        left:          CENTER_OFFSET + TILE_W / 2 - 6,
        bottom:        -4,
        width:         0,
        height:        0,
        borderLeft:    "6px solid transparent",
        borderRight:   "6px solid transparent",
        borderBottom:  "10px solid #c8ff00",
        zIndex:        11,
      }} />

      {/* ── Edge fade overlay ────────────────────────────────────────────── */}
      <div
        style={{
          position:     "absolute",
          inset:        0,
          zIndex:       9,
          pointerEvents:"none",
          background:   `linear-gradient(
            90deg,
            #080a12 0%,
            rgba(8,10,18,0.85) 8%,
            transparent 22%,
            transparent 78%,
            rgba(8,10,18,0.85) 92%,
            #080a12 100%
          )`,
        }}
      />

      {/* ── The scrolling strip ──────────────────────────────────────────── */}
      <div
        ref={stripRef}
        style={{
          display:    "flex",
          height:     tileH,
          willChange: "transform",
        }}
      >
        {FULL_STRIP.map((slot, i) => (
          <div
            key={i}
            style={{
              width:          TILE_W,
              height:         tileH,
              flexShrink:     0,
              background:     tileBg(slot),
              border:         `1px solid ${tileBorder(slot)}`,
              display:        "flex",
              flexDirection:  "column",
              alignItems:     "center",
              justifyContent: "center",
              gap:            3,
              color:          "#fff",
              fontWeight:     700,
              fontSize:       20,
              letterSpacing:  1,
            }}
          >
            {/* Color dot */}
            <div
              style={{
                width:        10,
                height:       10,
                borderRadius: "50%",
                background:
                  slot === 0 ? "#4ade80"
                  : slot <= 15 ? "#f87171"
                  : "#a1a1aa",
                boxShadow: "0 0 6px rgba(255,255,255,0.3)",
              }}
            />
            <span>{slot}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Standalone result badge (use after onDone fires) ────────────────────────
export function RouletteResultBadge({ result }: { result: SpinResult | null }) {
  if (!result) return null;

  const cfg = {
    red:   { label: "RED WINS",   bg: "#7f1d1d", border: "#ef4444", glow: "#ef444466", dot: "#f87171" },
    black: { label: "BLACK WINS", bg: "#18181b", border: "#71717a", glow: "#71717a44", dot: "#a1a1aa" },
    green: { label: "HOUSE WINS", bg: "#14532d", border: "#22c55e", glow: "#22c55e55", dot: "#4ade80" },
  }[result.color];

  return (
    <div
      style={{
        display:       "flex",
        alignItems:    "center",
        gap:           10,
        padding:       "10px 22px",
        borderRadius:  10,
        background:    cfg.bg,
        border:        `2px solid ${cfg.border}`,
        boxShadow:     `0 0 24px ${cfg.glow}`,
        fontWeight:    800,
        fontSize:      18,
        color:         "#fff",
        letterSpacing: 2,
        marginTop:     12,
      }}
    >
      <div style={{
        width: 14, height: 14, borderRadius: "50%",
        background: cfg.dot, boxShadow: `0 0 8px ${cfg.dot}`,
      }} />
      {cfg.label}
      <span style={{ opacity: 0.6, fontSize: 14, fontWeight: 500 }}>
        #{result.slot}
      </span>
    </div>
  );
}
