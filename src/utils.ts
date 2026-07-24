// SPDX-License-Identifier: GPL-3.0-or-later

import type { AppState, MindNode } from './types.js';

/** Numeric clamp helper. */
export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Sanitize a filename so it is safe across Linux, Windows, and macOS.
 */
export function safeFilename(name: string, fallback = 'mindmap'): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_') || fallback;
}

/**
 * Derive a base filename for exports from the root node's label,
 * falling back to 'mindmap' for empty/whitespace labels.
 */
export function mapBasename(state: AppState): string {
  const label = state.nodes[state.rootId]?.label.trim();
  return label && label.length > 0 ? label : 'mindmap';
}

/**
 * Approximate width of a node pill given its label. We measure characters
 * with a fixed ratio so the renderer stays cheap; precise text metrics
 * would require off-screen rendering and are not worth the complexity here.
 */
const CHAR_WIDTH = 8;
const NODE_HORIZONTAL_PADDING = 16;
const NODE_HEIGHT = 36;
const MIN_NODE_WIDTH = 60;

/**
 * Compute the rendered size of a node based on its label.
 */
export function nodeSize(node: MindNode): { width: number; height: number } {
  const label = node.label.length === 0 ? ' ' : node.label;
  const width = Math.max(MIN_NODE_WIDTH, label.length * CHAR_WIDTH + NODE_HORIZONTAL_PADDING * 2);
  return { width, height: NODE_HEIGHT };
}

/**
 * Visit nodes from the root in a stable depth-first order, skipping
 * subtrees of collapsed nodes. Returns ids in render order.
 */
export function visibleNodeIds(state: AppState): string[] {
  const result: string[] = [];
  const stack: string[] = [state.rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const node = state.nodes[id];
    if (!node) continue;
    result.push(id);
    if (node.collapsed) continue;
    // Push in reverse so children are visited in declared order.
    for (let i = node.children.length - 1; i >= 0; i--) {
      const cid = node.children[i];
      if (cid !== undefined) stack.push(cid);
    }
  }
  return result;
}

/**
 * Collect the ids of `id` and all of its descendants in DFS order.
 * Used by subtree drags and the collapsed-subtree badge.
 */
export function subtreeIds(state: AppState, id: string): string[] {
  const out: string[] = [];
  const stack: string[] = [id];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const node = state.nodes[cur];
    if (!node) continue;
    out.push(cur);
    for (const child of node.children) stack.push(child);
  }
  return out;
}

/** Axis-aligned bounding box in world coordinates. */
export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Compute the world-space bounding box of the visible (non-collapsed)
 * subtree rooted at `state.rootId`, including node pill extents.
 * Returns `null` when no nodes are visible (should not happen in
 * practice, since the root always exists).
 */
export function visibleBounds(state: AppState): WorldBounds | null {
  const visible = visibleNodeIds(state);
  if (visible.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of visible) {
    const n = state.nodes[id];
    if (!n) continue;
    const { width, height } = nodeSize(n);
    minX = Math.min(minX, n.x - width / 2);
    maxX = Math.max(maxX, n.x + width / 2);
    minY = Math.min(minY, n.y - height / 2);
    maxY = Math.max(maxY, n.y + height / 2);
  }
  return { minX, minY, maxX, maxY };
}
