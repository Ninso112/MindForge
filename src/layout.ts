// SPDX-License-Identifier: GPL-3.0-or-later

import type { AppState, MindNode } from './types.js';

/**
 * Distance from a parent to the ring of its children, in pixels.
 * Increases slowly with depth so deep maps don't overlap.
 */
const BASE_RADIUS = 220;
const RADIUS_GROWTH = 60;

/**
 * Count how many leaf descendants a node has. Leaves get a weight of 1;
 * internal nodes get the sum of their children's weights, with a floor
 * of 1 so a tiny branch doesn't collapse to zero arc width.
 */
function leafWeight(nodes: Record<string, MindNode>, id: string, cache: Map<string, number>): number {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  const node = nodes[id];
  if (!node || node.children.length === 0) {
    cache.set(id, 1);
    return 1;
  }
  let total = 0;
  for (const c of node.children) total += leafWeight(nodes, c, cache);
  if (total < 1) total = 1;
  cache.set(id, total);
  return total;
}

/**
 * Compute a radial-tree layout for the mind map. The root is placed at
 * the origin; each subtree is allocated an angular wedge proportional to
 * its leaf weight, and children are positioned at increasing radius.
 *
 * Pinned nodes (manually moved by the user) keep their existing
 * coordinates and are skipped when assigning positions.
 *
 * @returns A map from node id to new (x, y) coordinates. Includes the
 *          root (always at 0, 0) and all unpinned descendants.
 */
export function radialLayout(state: AppState): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  const root = state.nodes[state.rootId];
  if (!root) return out;

  out[root.id] = { x: 0, y: 0 };
  const weights = new Map<string, number>();

  /**
   * Recursively place children of `id` within an angular wedge
   * `[startAngle, endAngle]` (radians) at `depth`.
   */
  const place = (id: string, startAngle: number, endAngle: number, depth: number): void => {
    const node = state.nodes[id];
    if (!node || node.children.length === 0) return;

    const radius = BASE_RADIUS + RADIUS_GROWTH * (depth - 1);
    const totalWeight = leafWeight(state.nodes, id, weights) - 1;
    let cursor = startAngle;
    const span = endAngle - startAngle;

    for (const childId of node.children) {
      const child = state.nodes[childId];
      if (!child) continue;
      const w = leafWeight(state.nodes, childId, weights);
      const portion = totalWeight > 0 ? (w / totalWeight) * span : span / node.children.length;
      const childAngle = cursor + portion / 2;
      if (!child.pinned) {
        out[childId] = {
          x: Math.cos(childAngle) * radius,
          y: Math.sin(childAngle) * radius
        };
      }
      // Children of `child` get a sub-wedge centered on their angle.
      place(childId, cursor, cursor + portion, depth + 1);
      cursor += portion;
    }
  };

  // Distribute the root's children across the full circle.
  place(state.rootId, -Math.PI, Math.PI, 1);
  return out;
}
