// SPDX-License-Identifier: GPL-3.0-or-later

import type { AppState, MindNode, StateListener, Viewport } from './types.js';

/**
 * Maximum number of undo steps retained. The spec asks for at least 50.
 */
const HISTORY_LIMIT = 100;

/**
 * Generate a UUID v4. Uses `crypto.randomUUID` when available,
 * falls back to a manual implementation for older browsers.
 */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

/**
 * Build a fresh, empty mind map containing only a root node.
 */
export function createInitialState(): AppState {
  const rootId = uuid();
  const root: MindNode = {
    id: rootId,
    label: 'Root',
    parentId: null,
    children: [],
    x: 0,
    y: 0,
    collapsed: false,
    pinned: false
  };
  return {
    nodes: { [rootId]: root },
    rootId,
    selectedId: rootId,
    editingId: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    theme: detectInitialTheme()
  };
}

/**
 * Detect the initial theme from `prefers-color-scheme`. Defaults to dark.
 */
function detectInitialTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

/**
 * Deep clone the AppState. We avoid `structuredClone` in case of older targets
 * but it's available in all modern browsers, so prefer it when present.
 */
function clone(state: AppState): AppState {
  if (typeof structuredClone === 'function') {
    return structuredClone(state);
  }
  return JSON.parse(JSON.stringify(state)) as AppState;
}

/**
 * Reactive store for the mind map. Wraps an immutable AppState behind
 * a small set of mutators; all mutations push the previous state onto
 * an undo stack so the user can step back.
 */
export class Store {
  private state: AppState;
  private undoStack: AppState[] = [];
  private redoStack: AppState[] = [];
  private listeners: Set<StateListener> = new Set();
  /**
   * When true, `commit` snapshots before applying mutations. Some
   * actions (e.g. mid-drag movements, viewport pans) should not pollute
   * history — wrap those in `silent`.
   */
  private recordHistory = true;

  constructor(initial?: AppState) {
    this.state = initial ?? createInitialState();
  }

  /**
   * Return a reference to the current state. Treat as read-only —
   * never mutate. Use the explicit mutators below instead.
   */
  getState(): AppState {
    return this.state;
  }

  /**
   * Subscribe to state changes. Returns an unsubscribe function.
   */
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Run a function without recording undo history. Use for high-frequency
   * updates such as drag and viewport changes.
   */
  silent<T>(fn: () => T): T {
    const prev = this.recordHistory;
    this.recordHistory = false;
    try {
      return fn();
    } finally {
      this.recordHistory = prev;
    }
  }

  /**
   * Apply a mutation to the state, optionally pushing the previous
   * snapshot onto the undo stack and clearing the redo stack.
   */
  private commit(mutator: (draft: AppState) => void): void {
    const next = clone(this.state);
    if (this.recordHistory) {
      this.undoStack.push(this.state);
      if (this.undoStack.length > HISTORY_LIMIT) {
        this.undoStack.shift();
      }
      this.redoStack = [];
    }
    mutator(next);
    this.state = next;
    this.notify();
  }

  private notify(): void {
    for (const l of this.listeners) {
      l(this.state);
    }
  }

  // ---------------------------------------------------------------------
  // Selection / editing
  // ---------------------------------------------------------------------

  /** Select a node by id, or pass `null` to clear selection. */
  select(id: string | null): void {
    if (this.state.selectedId === id) return;
    this.silent(() => this.commit((d) => { d.selectedId = id; d.editingId = null; }));
  }

  /** Mark a node as the one currently being edited inline. */
  startEditing(id: string): void {
    this.silent(() => this.commit((d) => { d.editingId = id; d.selectedId = id; }));
  }

  /** Stop editing; optionally commit a new label as a real history entry. */
  stopEditing(commitLabel?: string): void {
    const editingId = this.state.editingId;
    if (editingId === null) return;
    if (commitLabel !== undefined && this.state.nodes[editingId]?.label !== commitLabel) {
      this.commit((d) => {
        const n = d.nodes[editingId];
        if (n) n.label = commitLabel;
        d.editingId = null;
      });
    } else {
      this.silent(() => this.commit((d) => { d.editingId = null; }));
    }
  }

  // ---------------------------------------------------------------------
  // Node mutations
  // ---------------------------------------------------------------------

  /**
   * Insert a child under the given parent. Returns the new node's id.
   * The new node's coordinates are placed relative to the parent
   * so the layout has somewhere to start from.
   */
  addChild(parentId: string, label = ''): string {
    const id = uuid();
    this.commit((d) => {
      const parent = d.nodes[parentId];
      if (!parent) return;
      const node: MindNode = {
        id,
        label,
        parentId,
        children: [],
        x: parent.x + 180,
        y: parent.y,
        collapsed: false,
        pinned: false
      };
      d.nodes[id] = node;
      parent.children.push(id);
      d.selectedId = id;
    });
    return id;
  }

  /**
   * Insert a sibling after the given node. Returns the new node's id.
   * No-op if called on the root, since the root has no siblings.
   */
  addSibling(siblingId: string, label = ''): string | null {
    const sibling = this.state.nodes[siblingId];
    if (!sibling || sibling.parentId === null) return null;
    const id = uuid();
    const parentId = sibling.parentId;
    this.commit((d) => {
      const parent = d.nodes[parentId];
      if (!parent) return;
      const node: MindNode = {
        id,
        label,
        parentId,
        children: [],
        x: sibling.x,
        y: sibling.y + 80,
        collapsed: false,
        pinned: false
      };
      d.nodes[id] = node;
      const insertAt = parent.children.indexOf(siblingId);
      parent.children.splice(insertAt + 1, 0, id);
      d.selectedId = id;
    });
    return id;
  }

  /**
   * Delete a node and all of its descendants. The root node cannot be
   * deleted; the call is a no-op in that case.
   */
  deleteNode(id: string): void {
    if (id === this.state.rootId) return;
    if (!this.state.nodes[id]) return;
    this.commit((d) => {
      const target = d.nodes[id];
      if (!target) return;
      // Detach from parent.
      if (target.parentId !== null) {
        const parent = d.nodes[target.parentId];
        if (parent) {
          parent.children = parent.children.filter((c) => c !== id);
        }
      }
      // Remove subtree.
      const stack = [id];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        const node = d.nodes[cur];
        if (!node) continue;
        for (const child of node.children) stack.push(child);
        delete d.nodes[cur];
      }
      // Update selection.
      if (d.selectedId === id || (d.selectedId && !d.nodes[d.selectedId])) {
        d.selectedId = target.parentId ?? d.rootId;
      }
      if (d.editingId && !d.nodes[d.editingId]) d.editingId = null;
    });
  }

  /** Update a node's label. Records history. */
  setLabel(id: string, label: string): void {
    if (this.state.nodes[id]?.label === label) return;
    this.commit((d) => {
      const n = d.nodes[id];
      if (n) n.label = label;
    });
  }

  /**
   * Override or clear the per-node fill color. Pass `null` to revert to
   * the depth-based palette. Records history so the change is undoable.
   */
  setNodeColor(id: string, color: string | null): void {
    const cur = this.state.nodes[id]?.color ?? null;
    if (cur === color) return;
    this.commit((d) => {
      const n = d.nodes[id];
      if (!n) return;
      if (color === null) {
        delete n.color;
      } else {
        n.color = color;
      }
    });
  }

  /**
   * Move a node to absolute world coordinates. Sets `pinned = true` so
   * subsequent auto-layout passes leave it alone. Use within `silent`
   * for drag operations to avoid spamming undo history; the caller
   * should commit a single history entry on drag-end.
   */
  moveNode(id: string, x: number, y: number, pin = true): void {
    const n = this.state.nodes[id];
    if (!n) return;
    this.commit((d) => {
      const node = d.nodes[id];
      if (!node) return;
      node.x = x;
      node.y = y;
      if (pin) node.pinned = true;
    });
  }

  /**
   * Replace coordinates for many nodes at once (used by auto-layout).
   * Silent: layout never records its own undo entry — it is bundled
   * with whichever user action triggered it.
   */
  applyLayout(positions: Record<string, { x: number; y: number }>): void {
    this.silent(() => this.commit((d) => {
      for (const [id, p] of Object.entries(positions)) {
        const n = d.nodes[id];
        if (n && !n.pinned) {
          n.x = p.x;
          n.y = p.y;
        }
      }
    }));
  }

  /** Clear pinned flags so the auto-layout fully takes over again. */
  resetPins(): void {
    this.commit((d) => {
      for (const n of Object.values(d.nodes)) n.pinned = false;
    });
  }

  /** Toggle a node's collapsed state. */
  toggleCollapsed(id: string): void {
    this.commit((d) => {
      const n = d.nodes[id];
      if (n) n.collapsed = !n.collapsed;
    });
  }

  // ---------------------------------------------------------------------
  // Viewport / theme
  // ---------------------------------------------------------------------

  /** Update viewport in silent mode (high-frequency events). */
  setViewport(v: Viewport): void {
    this.silent(() => this.commit((d) => { d.viewport = v; }));
  }

  /** Switch theme. Persisted as part of state. */
  setTheme(theme: 'light' | 'dark'): void {
    this.silent(() => this.commit((d) => { d.theme = theme; }));
  }

  // ---------------------------------------------------------------------
  // Undo / redo
  // ---------------------------------------------------------------------

  /** Restore the previous state. No-op if the stack is empty. */
  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.state);
    this.state = prev;
    this.notify();
  }

  /** Re-apply the last undone state. */
  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.state);
    this.state = next;
    this.notify();
  }

  /**
   * Replace the entire state (e.g. after import). Clears history.
   */
  replace(state: AppState): void {
    this.undoStack = [];
    this.redoStack = [];
    this.state = state;
    this.notify();
  }
}
