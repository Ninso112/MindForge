// SPDX-License-Identifier: GPL-3.0-or-later

import type { Renderer } from './renderer.js';
import type { Store } from './state.js';
import type { AppState } from './types.js';
import { radialLayout } from './layout.js';
import { downloadAsFile, openFromFile } from './serializer.js';
import { exportPdf, exportPng, exportSvg } from './export.js';
import { clamp, subtreeIds, visibleBounds } from './utils.js';

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 1.1;
/** Screen padding kept around the map when fitting it to the window. */
const FIT_PADDING = 48;

/**
 * Wire up all keyboard and pointer (mouse/touch/pen) interaction. The
 * input layer never owns state; it dispatches into the `Store` and
 * tells the `Renderer` to update viewport transforms and node positions
 * during high-frequency gestures (drag, pan, pinch-zoom) where a full
 * rebuild would be wasteful.
 */
export class InputController {
  private readonly store: Store;
  private readonly renderer: Renderer;
  private readonly host: HTMLElement;

  // Drag state for moving nodes. `snapshot` holds the pre-drag state so
  // an actual move can be undone as a single step. `members` is the
  // dragged node plus — for Shift+drag — its whole subtree.
  private nodeDrag: {
    grabX: number;
    grabY: number;
    members: { id: string; startX: number; startY: number }[];
    memberIds: Set<string>;
    moved: boolean;
    snapshot: AppState;
  } | null = null;
  // Pan state for moving the viewport.
  private pan: { startX: number; startY: number; vx: number; vy: number } | null = null;
  private spaceDown = false;

  // Active pointers, tracked for multi-touch pinch gestures.
  private pointers = new Map<number, { x: number; y: number }>();
  // Two-finger pinch state: zoom around the gesture midpoint.
  private pinch: { startDist: number; startZoom: number; worldAtMid: { x: number; y: number } } | null = null;

  // Inline edit overlay (a contenteditable div positioned over the node).
  private editor: HTMLDivElement | null = null;

  constructor(store: Store, renderer: Renderer, host: HTMLElement) {
    this.store = store;
    this.renderer = renderer;
    this.host = host;
    this.attach();
  }

  private attach(): void {
    const svg = this.renderer.getSvg();
    svg.addEventListener('pointerdown', this.onPointerDown);
    svg.addEventListener('dblclick', this.onDoubleClick);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    svg.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  /**
   * Remove all event listeners registered by `attach()`. Call this when
   * the controller is no longer needed (e.g. test teardown, SPA navigation).
   */
  destroy(): void {
    const svg = this.renderer.getSvg();
    svg.removeEventListener('pointerdown', this.onPointerDown);
    svg.removeEventListener('dblclick', this.onDoubleClick);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    svg.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    if (this.editor) {
      this.editor.remove();
      this.editor = null;
    }
  }

  // ---------------------------------------------------------------------
  // Pointer (mouse / touch / pen)
  // ---------------------------------------------------------------------

  private onPointerDown = (e: PointerEvent): void => {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      // A second finger switches to pinch-zoom. Finish any single-pointer
      // drag first so its movement so far stays undoable.
      this.finishNodeDrag();
      this.pan = null;
      this.beginPinch();
      return;
    }
    if (this.pointers.size > 2) return;
    if (this.editor) return; // Ignore canvas interactions while editing.

    const targetNodeId = this.findNodeAt(e.target);
    const isTouch = e.pointerType === 'touch';

    // Pan: middle-click, space+drag, or a touch starting on empty canvas.
    if (e.button === 1 || (e.button === 0 && this.spaceDown) || (isTouch && targetNodeId === null)) {
      e.preventDefault();
      if (targetNodeId === null) this.store.select(null);
      const v = this.store.getState().viewport;
      this.pan = { startX: e.clientX, startY: e.clientY, vx: v.x, vy: v.y };
      return;
    }

    // Left-click on empty space without space: just deselect.
    if (e.button === 0 && targetNodeId === null) {
      this.store.select(null);
      return;
    }

    if (e.button !== 0 || targetNodeId === null) return;

    // Left-click/tap on a node → select + start a potential drag.
    e.preventDefault();
    this.store.select(targetNodeId);
    const node = this.store.getState().nodes[targetNodeId];
    if (!node) return;
    const world = this.renderer.screenToWorld(this.store.getState(), e.clientX, e.clientY);
    // Shift+drag moves the whole subtree; otherwise just the node.
    const ids = e.shiftKey ? subtreeIds(this.store.getState(), targetNodeId) : [targetNodeId];
    const members: { id: string; startX: number; startY: number }[] = [];
    for (const id of ids) {
      const n = this.store.getState().nodes[id];
      if (n) members.push({ id, startX: n.x, startY: n.y });
    }
    this.nodeDrag = {
      grabX: world.x,
      grabY: world.y,
      members,
      memberIds: new Set(members.map((m) => m.id)),
      moved: false,
      snapshot: this.store.snapshot()
    };
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pinch) {
      if (this.pointers.size >= 2) this.updatePinch();
      return;
    }
    if (this.pan) {
      const dx = e.clientX - this.pan.startX;
      const dy = e.clientY - this.pan.startY;
      const v = this.store.getState().viewport;
      this.store.setViewportOnly({ ...v, x: this.pan.vx + dx, y: this.pan.vy + dy });
      this.renderer.applyViewport(this.store.getState());
      return;
    }
    if (this.nodeDrag) {
      const world = this.renderer.screenToWorld(this.store.getState(), e.clientX, e.clientY);
      const dx = world.x - this.nodeDrag.grabX;
      const dy = world.y - this.nodeDrag.grabY;
      // Cheap path: mutate without notify and patch only the affected
      // DOM instead of rebuilding the whole SVG per pointer move.
      for (const m of this.nodeDrag.members) {
        this.store.moveNodeOnly(m.id, m.startX + dx, m.startY + dy);
      }
      this.renderer.updateNodePositions(this.store.getState(), this.nodeDrag.memberIds);
      this.nodeDrag.moved = true;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      return;
    }
    if (this.pointers.size > 0) return; // Other fingers still active.
    if (this.pan) {
      this.pan = null;
      return;
    }
    this.finishNodeDrag();
  };

  /** End the current node drag, committing one undo step if it moved. */
  private finishNodeDrag(): void {
    if (!this.nodeDrag) return;
    if (this.nodeDrag.moved) {
      // Commit the pre-drag snapshot so the whole drag undoes in one step.
      this.store.pushUndo(this.nodeDrag.snapshot);
    }
    this.nodeDrag = null;
  }

  // ---------------------------------------------------------------------
  // Pinch-zoom (two-finger touch gesture)
  // ---------------------------------------------------------------------

  private beginPinch(): void {
    const [p1, p2] = [...this.pointers.values()];
    if (!p1 || !p2) return;
    const state = this.store.getState();
    this.pinch = {
      startDist: Math.hypot(p2.x - p1.x, p2.y - p1.y),
      startZoom: state.viewport.zoom,
      worldAtMid: this.renderer.screenToWorld(state, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2)
    };
  }

  private updatePinch(): void {
    const pinch = this.pinch;
    if (!pinch) return;
    const [p1, p2] = [...this.pointers.values()];
    if (!p1 || !p2) return;
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (pinch.startDist < 1 || dist < 1) return;
    const zoom = clamp(pinch.startZoom * (dist / pinch.startDist), ZOOM_MIN, ZOOM_MAX);
    // Keep the world point that was under the initial midpoint fixed
    // under the current midpoint: V = mid - center - world * zoom.
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const rect = this.renderer.getSvg().getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    this.store.setViewportOnly({
      x: midX - cx - pinch.worldAtMid.x * zoom,
      y: midY - cy - pinch.worldAtMid.y * zoom,
      zoom
    });
    this.renderer.applyViewport(this.store.getState());
  }

  private onDoubleClick = (e: MouseEvent): void => {
    const id = this.findNodeAt(e.target);
    if (id === null) return;
    e.preventDefault();
    this.beginEdit(id);
  };

  private onWheel = (e: WheelEvent): void => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    this.zoomAround(e.clientX, e.clientY, factor);
  };

  /**
   * Zoom by `factor` while keeping the world point under the given
   * screen point fixed (zoom-to-cursor for the wheel, zoom-to-center
   * for keyboard shortcuts).
   */
  private zoomAround(screenX: number, screenY: number, factor: number): void {
    const state = this.store.getState();
    const before = this.renderer.screenToWorld(state, screenX, screenY);
    const newZoom = clamp(state.viewport.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    const dx = before.x * state.viewport.zoom * (1 - newZoom / state.viewport.zoom);
    const dy = before.y * state.viewport.zoom * (1 - newZoom / state.viewport.zoom);
    this.store.setViewportOnly({
      ...state.viewport,
      zoom: newZoom,
      x: state.viewport.x + dx,
      y: state.viewport.y + dy
    });
    this.renderer.applyViewport(this.store.getState());
  }

  /** Zoom by `factor` around the canvas center (keyboard zoom). */
  private zoomAtCenter(factor: number): void {
    const rect = this.renderer.getSvg().getBoundingClientRect();
    this.zoomAround(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  /**
   * Fit the whole visible map into the window: zoom (clamped to the
   * usual range) and pan so the map's bounding box is centered.
   */
  fitToView(): void {
    const state = this.store.getState();
    const bounds = visibleBounds(state);
    if (!bounds) return;
    const { width, height } = this.renderer.getViewportSize();
    const bw = Math.max(1, bounds.maxX - bounds.minX);
    const bh = Math.max(1, bounds.maxY - bounds.minY);
    const zoom = clamp(
      Math.min((width - 2 * FIT_PADDING) / bw, (height - 2 * FIT_PADDING) / bh),
      ZOOM_MIN,
      ZOOM_MAX
    );
    // The viewport transform maps world w to screen (C + V + w*zoom),
    // so centering the bounds' midpoint means V = -midpoint * zoom.
    const worldCx = (bounds.minX + bounds.maxX) / 2;
    const worldCy = (bounds.minY + bounds.maxY) / 2;
    this.store.setViewport({ x: -worldCx * zoom, y: -worldCy * zoom, zoom });
  }

  // ---------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------

  private onKeyDown = (e: KeyboardEvent): void => {
    // While the inline editor is open, only Escape and Enter (without
    // shift) are intercepted; the rest goes to the contenteditable.
    if (this.editor) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelEdit();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.commitEdit();
      } else if (e.key === 'Tab') {
        // Commit the edit and let the outer Tab handler create a child.
        e.preventDefault();
        this.commitEdit();
        const sel = this.store.getState().selectedId;
        if (sel) this.addChildAndEdit(sel);
      }
      return;
    }

    // Never steal keys from form fields (search box, note editor).
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

    if (e.key === ' ') {
      e.preventDefault();
      this.spaceDown = true;
    }

    const state = this.store.getState();
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.store.undo();
      return;
    }
    if ((ctrl && e.key.toLowerCase() === 'y') || (ctrl && e.shiftKey && e.key.toLowerCase() === 'z')) {
      e.preventDefault();
      this.store.redo();
      return;
    }
    if (ctrl && e.key === 'Enter') {
      e.preventDefault();
      const sel = state.selectedId;
      if (sel) this.store.toggleCollapsed(sel);
      return;
    }
    if (ctrl && e.key.toLowerCase() === 's') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('mindforge:save'));
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      downloadAsFile(this.store.getState());
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('mindforge:open-search'));
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      openFromFile(state.theme).then((s) => this.store.replace(s)).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== 'No file selected') {
          window.dispatchEvent(new CustomEvent('mindforge:flash-status', {
            detail: { text: `Import failed: ${msg}` }
          }));
        }
      });
      return;
    }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('mindforge:new-map'));
      return;
    }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      exportPng(state, this.renderer).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('PNG export failed:', err);
      });
      return;
    }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      exportPdf(state, this.renderer);
      return;
    }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      exportSvg(state, this.renderer);
      return;
    }
    if (ctrl && !e.shiftKey && (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_')) {
      e.preventDefault();
      this.zoomAtCenter(e.key === '-' || e.key === '_' ? 1 / ZOOM_STEP : ZOOM_STEP);
      return;
    }
    if (ctrl && !e.shiftKey && e.key === '0') {
      e.preventDefault();
      this.fitToView();
      return;
    }

    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('mindforge:toggle-help'));
      return;
    }

    if (!ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c' && state.selectedId !== null) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('mindforge:open-color-picker', {
        detail: { nodeId: state.selectedId }
      }));
      return;
    }

    if (!ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n' && state.selectedId !== null) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('mindforge:open-note-editor', {
        detail: { nodeId: state.selectedId }
      }));
      return;
    }

    if (state.selectedId === null) return;

    switch (e.key) {
      case 'Tab': {
        e.preventDefault();
        this.addChildAndEdit(state.selectedId);
        break;
      }
      case 'Enter': {
        e.preventDefault();
        this.addSiblingAndEdit(state.selectedId);
        break;
      }
      case 'F2': {
        e.preventDefault();
        this.beginEdit(state.selectedId);
        break;
      }
      case 'Delete':
      case 'Backspace': {
        e.preventDefault();
        this.store.deleteNode(state.selectedId);
        break;
      }
      case 'Escape': {
        e.preventDefault();
        this.store.select(null);
        break;
      }
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        e.preventDefault();
        this.navigate(e.key);
        break;
      }
      default:
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ') this.spaceDown = false;
  };

  // ---------------------------------------------------------------------
  // High-level actions
  // ---------------------------------------------------------------------

  private addChildAndEdit(parentId: string): void {
    // Batched: one notification (hence one re-render) for add + layout.
    const id = this.store.batch(() => {
      const newId = this.store.addChild(parentId, '');
      this.runAutoLayout();
      return newId;
    });
    this.beginEdit(id);
  }

  private addSiblingAndEdit(siblingId: string): void {
    const id = this.store.batch(() => {
      const newId = this.store.addSibling(siblingId, '');
      if (newId) this.runAutoLayout();
      return newId;
    });
    if (id) {
      this.beginEdit(id);
    } else {
      // Root has no siblings — fall back to adding a child instead.
      this.addChildAndEdit(siblingId);
    }
  }

  /** Re-run the radial layout, then update node positions in the store. */
  runAutoLayout(): void {
    const positions = radialLayout(this.store.getState());
    this.store.applyLayout(positions);
  }

  /**
   * Move selection to the nearest neighbor in the given screen direction.
   * Uses straight-line distance on world coordinates with a directional
   * cone filter so adjacent nodes feel intuitive to step through.
   */
  private navigate(key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'): void {
    const state = this.store.getState();
    const sel = state.selectedId === null ? null : state.nodes[state.selectedId];
    if (!sel) return;

    const dirX = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
    const dirY = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;

    let best: { id: string; score: number } | null = null;
    for (const n of Object.values(state.nodes)) {
      if (n.id === sel.id) continue;
      const dx = n.x - sel.x;
      const dy = n.y - sel.y;
      // Project onto the chosen direction; require strictly positive projection
      // (otherwise pressing Right would let you select a node that is to your left).
      const along = dx * dirX + dy * dirY;
      if (along <= 0) continue;
      const perp = Math.abs(dx * dirY - dy * dirX);
      // Score: along-axis distance plus a heavier penalty for perpendicular drift.
      const score = along + perp * 1.5;
      if (best === null || score < best.score) best = { id: n.id, score };
    }
    if (best) this.store.select(best.id);
  }

  // ---------------------------------------------------------------------
  // Inline editing
  // ---------------------------------------------------------------------

  private beginEdit(id: string): void {
    this.cancelEdit();
    this.store.startEditing(id);
    const node = this.store.getState().nodes[id];
    if (!node) return;
    const editor = document.createElement('div');
    editor.className = 'mf-editor';
    try {
      // 'plaintext-only' avoids rich-text paste artifacts, but Firefox
      // before 136 throws a SyntaxError on the unknown value — fall back.
      editor.contentEditable = 'plaintext-only';
    } catch {
      editor.contentEditable = 'true';
    }
    editor.spellcheck = false;
    editor.textContent = node.label;
    this.host.appendChild(editor);
    this.editor = editor;
    this.positionEditor(id);

    // Select all text on focus.
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    editor.addEventListener('blur', () => this.commitEdit());
  }

  private positionEditor(id: string): void {
    if (!this.editor) return;
    const rect = this.renderer.getNodeScreenRect(this.store.getState(), id);
    if (!rect) return;
    const hostRect = this.host.getBoundingClientRect();
    this.editor.style.left = `${rect.left - hostRect.left}px`;
    this.editor.style.top = `${rect.top - hostRect.top}px`;
    this.editor.style.width = `${rect.width}px`;
    this.editor.style.height = `${rect.height}px`;
  }

  private commitEdit(): void {
    const editor = this.editor;
    if (!editor) return;
    const text = (editor.textContent ?? '').trim();
    const editingId = this.store.getState().editingId;
    this.editor = null;
    editor.remove();
    if (editingId !== null) {
      this.store.stopEditing(text);
    }
  }

  private cancelEdit(): void {
    if (!this.editor) return;
    this.editor.remove();
    this.editor = null;
    this.store.stopEditing();
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  /**
   * Walk up the DOM from an event target to find an enclosing node element
   * and return its node id, or `null` if the click missed every node.
   */
  private findNodeAt(target: EventTarget | null): string | null {
    let el = target as Element | null;
    while (el && el !== this.renderer.getSvg()) {
      if (el instanceof SVGElement && el.classList.contains('mf-node')) {
        return el.getAttribute('data-id');
      }
      el = el.parentElement;
    }
    return null;
  }
}

