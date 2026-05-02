// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Fixed 32-color palette offered to the user when overriding a node's
 * fill. Laid out as four rows of eight: vivid warm/cool, muted, pastel,
 * and soft tints — chosen to read well against both the dark and light
 * themes without relying on theme-specific lookups.
 *
 * The order is significant: the color picker renders the palette as a
 * 4-row × 8-column grid in this exact sequence.
 */
export const COLOR_PALETTE: readonly string[] = [
  // Row 1: vivid
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  // Row 2: cool / saturated
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  // Row 3: pastel warm-to-cool
  '#fca5a5', '#fdba74', '#fcd34d', '#fde68a',
  '#bef264', '#86efac', '#6ee7b7', '#5eead4',
  // Row 4: pastel cool-to-pink
  '#67e8f9', '#7dd3fc', '#93c5fd', '#a5b4fc',
  '#c4b5fd', '#d8b4fe', '#f0abfc', '#f9a8d4'
] as const;

export const COLOR_PALETTE_COLUMNS = 8;
export const COLOR_PALETTE_ROWS = 4;
