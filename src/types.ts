// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Core data types for MindForge.
 *
 * The mind map is stored as a flat collection of nodes referenced by id.
 * Edges are derived from the parent/children relationships rather than
 * stored independently, but a derived `Edge` type is exported for the
 * renderer.
 */

/**
 * A single node in the mind map.
 *
 * - `id`           Stable unique identifier (UUID v4 hex).
 * - `label`        Plain-text label shown on the node.
 * - `parentId`     `null` only for the root node. All other nodes have a parent.
 * - `children`     Ordered list of child node ids. Order is preserved across saves.
 * - `x`, `y`       World-space coordinates (pixels at zoom = 1).
 * - `collapsed`    When true, descendants are hidden in the renderer.
 * - `pinned`       When true, the auto-layout will leave the node where it is.
 *                  Set automatically the first time a user drags the node.
 * - `color`        Optional override for the depth-based palette.
 * - `note`         Optional free-text note attached to the node.
 */
export interface MindNode {
  id: string;
  label: string;
  parentId: string | null;
  children: string[];
  x: number;
  y: number;
  collapsed: boolean;
  pinned: boolean;
  color?: string;
  note?: string;
}

/**
 * Viewport pan/zoom state in world space.
 *
 * - `x`, `y`  Translation applied to the SVG root group.
 * - `zoom`    Uniform scale, clamped to [0.1, 3.0] in the input layer.
 */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Top-level application state. Everything that should be persisted
 * lives here; everything ephemeral (drag in progress, hover state)
 * lives in the input/renderer modules.
 */
export interface AppState {
  nodes: Record<string, MindNode>;
  rootId: string;
  selectedId: string | null;
  editingId: string | null;
  viewport: Viewport;
  theme: 'light' | 'dark';
}

/**
 * Disk format for `.mindforge` files. Versioned so we can migrate
 * older exports forward without breaking compatibility.
 */
export interface SerializedMap {
  version: '1';
  nodes: MindNode[];
  rootId: string;
  viewport: Viewport;
}

/**
 * Listener signature for the reactive store.
 */
export type StateListener = (state: AppState) => void;
