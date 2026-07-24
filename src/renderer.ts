// SPDX-License-Identifier: GPL-3.0-or-later

import type { AppState, MindNode } from './types.js';
import { nodeSize, visibleNodeIds } from './utils.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** CSS variables consumed for depth coloring. Cycles after 6 levels. */
const DEPTH_COLOR_VARS = [
  '--mf-depth-1',
  '--mf-depth-2',
  '--mf-depth-3',
  '--mf-depth-4',
  '--mf-depth-5',
  '--mf-depth-6'
];

/**
 * Compute depth (0 for root) by walking parent links. Memoizes locally
 * within a single render pass.
 */
function depthOf(state: AppState, id: string, cache: Map<string, number>): number {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  const node = state.nodes[id];
  if (!node || node.parentId === null) {
    cache.set(id, 0);
    return 0;
  }
  const d = depthOf(state, node.parentId, cache) + 1;
  cache.set(id, d);
  return d;
}

/**
 * Count all descendants of a node (children, grandchildren, ...),
 * memoized within a single render pass. Used for the badge shown on
 * collapsed subtrees.
 */
function descendantCount(state: AppState, id: string, cache: Map<string, number>): number {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  const node = state.nodes[id];
  if (!node) {
    cache.set(id, 0);
    return 0;
  }
  let total = 0;
  for (const c of node.children) total += 1 + descendantCount(state, c, cache);
  cache.set(id, total);
  return total;
}

/**
 * Build the SVG `d` attribute for a smooth bezier curve from one point
 * to another. Control points are placed along the line connecting the
 * endpoints so the curve follows the radial direction.
 */
function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.5) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const ux = dx / dist;
  const uy = dy / dist;
  const t = dist / 3;
  const c1x = x1 + ux * t;
  const c1y = y1 + uy * t;
  const c2x = x2 - ux * t;
  const c2y = y2 - uy * t;
  return `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;
}

/**
 * Compute the bezier `d` attribute for the connector between a parent
 * and a child node, anchored on their pill perimeters.
 */
function edgePathD(parent: MindNode, child: MindNode): string {
  const ps = nodeSize(parent);
  const ns = nodeSize(child);
  const dx = child.x - parent.x;
  const dy = child.y - parent.y;
  const from = edgePointOnPill(parent.x, parent.y, ps.width, ps.height, dx, dy);
  const to = edgePointOnPill(child.x, child.y, ns.width, ns.height, -dx, -dy);
  return bezierPath(from.x, from.y, to.x, to.y);
}

/**
 * Compute the point on the perimeter of a node pill (approximated as an
 * ellipse) in the given direction from its center.
 */
function edgePointOnPill(cx: number, cy: number, width: number, height: number, tx: number, ty: number): { x: number; y: number } {
  const a = width / 2;
  const b = height / 2;
  const dist = Math.sqrt(tx * tx + ty * ty);
  if (dist === 0) return { x: cx + a, y: cy };
  const nx = tx / dist;
  const ny = ty / dist;
  const denom = Math.sqrt((nx / a) ** 2 + (ny / b) ** 2);
  const t = 1 / denom;
  return { x: cx + t * nx, y: cy + t * ny };
}

/**
 * Renderer manages the SVG DOM for the mind map. It performs a full
 * rebuild on every state change — the maps we expect to draw (a few
 * hundred nodes at most) are well within the budget for that, and it
 * avoids subtle staleness bugs from incremental diffing.
 */
export class Renderer {
  private readonly svg: SVGSVGElement;
  private readonly viewportGroup: SVGGElement;
  private readonly edgesGroup: SVGGElement;
  private readonly nodesGroup: SVGGElement;
  // Search highlight sets, applied to nodes on subsequent renders.
  private highlightMatches: ReadonlySet<string> = new Set();
  private highlightCurrent: string | null = null;

  /**
   * Build a new renderer mounted into `container`. Creates the root
   * `<svg>` element and the layered groups.
   */
  constructor(container: HTMLElement) {
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'mf-svg');
    this.svg.setAttribute('width', '100%');
    this.svg.setAttribute('height', '100%');
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    this.viewportGroup = document.createElementNS(SVG_NS, 'g');
    this.viewportGroup.setAttribute('class', 'mf-viewport');

    this.edgesGroup = document.createElementNS(SVG_NS, 'g');
    this.edgesGroup.setAttribute('class', 'mf-edges');

    this.nodesGroup = document.createElementNS(SVG_NS, 'g');
    this.nodesGroup.setAttribute('class', 'mf-nodes');

    this.viewportGroup.appendChild(this.edgesGroup);
    this.viewportGroup.appendChild(this.nodesGroup);
    this.svg.appendChild(this.viewportGroup);
    container.appendChild(this.svg);
  }

  /** Public accessor so input.ts can attach event listeners. */
  getSvg(): SVGSVGElement {
    return this.svg;
  }

  /** Current on-screen size of the SVG canvas in CSS pixels. */
  getViewportSize(): { width: number; height: number } {
    const rect = this.svg.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  /**
   * Set the search highlight sets applied to subsequently rendered
   * nodes. Purely presentational — the caller triggers the re-render.
   */
  setHighlights(matches: ReadonlySet<string>, current: string | null): void {
    this.highlightMatches = matches;
    this.highlightCurrent = current;
  }

  /**
   * Convert a screen-space point (e.g. from a MouseEvent) to world-space
   * coordinates accounting for current pan and zoom.
   */
  screenToWorld(state: AppState, screenX: number, screenY: number): { x: number; y: number } {
    const rect = this.svg.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const x = (screenX - rect.left - cx - state.viewport.x) / state.viewport.zoom;
    const y = (screenY - rect.top - cy - state.viewport.y) / state.viewport.zoom;
    return { x, y };
  }

  /**
   * Apply pan/zoom transform without rebuilding the entire scene.
   * Cheap; can be called at pointer-move frequency.
   */
  applyViewport(state: AppState): void {
    const rect = this.svg.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const t = `translate(${cx + state.viewport.x} ${cy + state.viewport.y}) scale(${state.viewport.zoom})`;
    this.viewportGroup.setAttribute('transform', t);
  }

  /**
   * Re-render the entire scene from `state`. The previous SVG content
   * is cleared and rebuilt.
   */
  render(state: AppState): void {
    this.applyViewport(state);

    // Clear.
    this.edgesGroup.textContent = '';
    this.nodesGroup.textContent = '';

    const visible = visibleNodeIds(state);
    const visibleSet = new Set(visible);
    const depthCache = new Map<string, number>();
    const countCache = new Map<string, number>();

    // Edges first (so they render below nodes).
    for (const id of visible) {
      const node = state.nodes[id];
      if (!node || node.parentId === null) continue;
      if (!visibleSet.has(node.parentId)) continue;
      const parent = state.nodes[node.parentId];
      if (!parent) continue;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', edgePathD(parent, node));
      path.setAttribute('class', 'mf-edge');
      // Endpoint ids allow cheap incremental updates during node drags.
      path.setAttribute('data-from', parent.id);
      path.setAttribute('data-to', node.id);
      const depth = depthOf(state, id, depthCache);
      let stroke: string;
      if (node.color) {
        // The incoming edge inherits the child node's override so the
        // colored subtree reads as a single visual unit.
        stroke = node.color;
      } else {
        const colorVar = DEPTH_COLOR_VARS[((depth - 1) % DEPTH_COLOR_VARS.length + DEPTH_COLOR_VARS.length) % DEPTH_COLOR_VARS.length];
        stroke = `var(${colorVar})`;
      }
      path.setAttribute('stroke', stroke);
      this.edgesGroup.appendChild(path);
    }

    // Nodes.
    for (const id of visible) {
      const node = state.nodes[id];
      if (!node) continue;
      const depth = depthOf(state, id, depthCache);
      this.nodesGroup.appendChild(this.buildNodeElement(state, node, depth, countCache));
    }
  }

  /**
   * Incrementally update the DOM for nodes whose positions changed,
   * without rebuilding the scene. Runs at pointer-move frequency during
   * drags: only node transforms and the `d` of connected edges are
   * touched. The caller is responsible for a full `render` when
   * anything else (labels, colors, structure) changed.
   */
  updateNodePositions(state: AppState, movedIds: ReadonlySet<string>): void {
    for (const id of movedIds) {
      const node = state.nodes[id];
      if (!node) continue;
      const g = this.nodesGroup.querySelector<SVGGElement>(`g.mf-node[data-id="${CSS.escape(id)}"]`);
      if (g) {
        const { width, height } = nodeSize(node);
        g.setAttribute('transform', `translate(${node.x - width / 2} ${node.y - height / 2})`);
      }
    }
    const paths = this.edgesGroup.querySelectorAll<SVGPathElement>('path.mf-edge');
    for (const path of paths) {
      const fromId = path.getAttribute('data-from');
      const toId = path.getAttribute('data-to');
      if (!fromId || !toId) continue;
      if (!movedIds.has(fromId) && !movedIds.has(toId)) continue;
      const parent = state.nodes[fromId];
      const child = state.nodes[toId];
      if (parent && child) path.setAttribute('d', edgePathD(parent, child));
    }
  }

  /**
   * Build a single `<g>` element for one node, including its pill,
   * label, and click target. Caller is responsible for re-rendering on
   * any state change.
   */
  private buildNodeElement(state: AppState, node: MindNode, depth: number, countCache: Map<string, number>): SVGGElement {
    const { width, height } = nodeSize(node);
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'mf-node');
    g.setAttribute('data-id', node.id);
    g.setAttribute('transform', `translate(${node.x - width / 2} ${node.y - height / 2})`);
    if (state.selectedId === node.id) g.classList.add('mf-node--selected');
    if (state.editingId === node.id) g.classList.add('mf-node--editing');
    if (node.id === state.rootId) g.classList.add('mf-node--root');
    if (this.highlightMatches.has(node.id)) g.classList.add('mf-node--match');
    if (this.highlightCurrent === node.id) g.classList.add('mf-node--current');

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', String(height));
    rect.setAttribute('rx', String(height / 2));
    rect.setAttribute('ry', String(height / 2));
    rect.setAttribute('class', 'mf-node__pill');
    let fill: string;
    if (node.color) {
      fill = node.color;
    } else if (node.id === state.rootId) {
      fill = 'var(--mf-root)';
    } else {
      const v = DEPTH_COLOR_VARS[((depth - 1) % DEPTH_COLOR_VARS.length + DEPTH_COLOR_VARS.length) % DEPTH_COLOR_VARS.length];
      fill = `var(${v})`;
    }
    rect.setAttribute('fill', fill);
    g.appendChild(rect);

    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', String(width / 2));
    text.setAttribute('y', String(height / 2));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('class', 'mf-node__label');
    text.textContent = node.label.length > 0 ? node.label : ' ';
    if (state.editingId === node.id) {
      text.setAttribute('visibility', 'hidden');
    }
    g.appendChild(text);

    // Nodes with a note get a small indicator icon at the left padding.
    if (node.note && node.note.length > 0) {
      const icon = document.createElementNS(SVG_NS, 'path');
      icon.setAttribute('d', 'M 0 -4 h 8 M 0 0 h 8 M 0 4 h 5');
      icon.setAttribute('class', 'mf-node__note-icon');
      icon.setAttribute('transform', `translate(12 ${height / 2})`);
      g.appendChild(icon);
    }

    // Collapsed subtrees get a badge with the hidden descendant count.
    if (node.collapsed && node.children.length > 0) {
      g.classList.add('mf-node--collapsed');
      const count = descendantCount(state, node.id, countCache);
      if (count > 0) {
        const badge = document.createElementNS(SVG_NS, 'g');
        badge.setAttribute('class', 'mf-node__badge');
        badge.setAttribute('transform', `translate(${width} ${height / 2})`);
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('r', '10');
        const badgeText = document.createElementNS(SVG_NS, 'text');
        badgeText.setAttribute('text-anchor', 'middle');
        badgeText.setAttribute('dominant-baseline', 'central');
        badgeText.setAttribute('class', 'mf-node__badge-text');
        badgeText.textContent = String(count);
        badge.appendChild(circle);
        badge.appendChild(badgeText);
        g.appendChild(badge);
      }
    }

    return g;
  }

  /**
   * Locate the on-screen rect of a node so the input layer can position
   * a contenteditable overlay during inline editing.
   */
  getNodeScreenRect(_state: AppState, id: string): DOMRect | null {
    const el = this.nodesGroup.querySelector<SVGGElement>(`g.mf-node[data-id="${CSS.escape(id)}"] rect`);
    if (!el) return null;
    return el.getBoundingClientRect();
  }
}
