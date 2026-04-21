// Locked 2026-04-24. Do not modify without a `joint/aesthetic-*` PR.
export const PALETTE = {
  background: 0x07080d,
  nodeBase: 0xffc477, // warm amber
  nodeHighlight: 0xffffff,
  edgeMemory: 0xffb366, // warm amber
  edgeSearch: 0x66d9ef, // cool cyan
  edgeOverlap: 0xb089ff, // muted violet
} as const;

export const SIZES = {
  nodeBase: 0.04,
  nodeToolScale: 0.01, // per log1p(tool_count)
  edgeOpacity: 0.6,
  edgeOpacityByKind: {
    "memory-share": 0.55,
    "cross-search": 0.50,
    "tool-overlap": 0.12,
  },
} as const;
