// SPDX-License-Identifier: GPL-3.0-or-later

import type { Renderer } from './renderer.js';
import type { Store } from './state.js';
import { radialLayout } from './layout.js';
import { downloadAsFile, openFromFile } from './serializer.js';
import { exportPdf, exportPng, exportSvg } from './export.js';

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 1.1;

/**
 * Wire up all keyboard, mouse, and touch interaction. The input layer
 * never owns state; it dispatches into the `Store` and tells the
 * `Renderer` to update viewport transforms during high-frequency
 * gestures (drag, pan, zoom) where a full rebuild would be wasteful.
 */
export class InputController {
  private readonly store: Store;
  private readonly renderer: Renderer;
  private readonly host: HTMLElement;

  // Drag state for moving a single node.
  private nodeDrag: { id: string; offsetX: number; offsetY: number; moved: boolean } | null = null;
  // Pan state for moving the viewport.
  private pan: { startX: number; startY: number; vx: number; vy: number } | null = null;
  private spaceDown = false;

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
    svg.addEventListener('mousedown', this.onMouseDown);
    svg.addEventListener('dblclick', this.onDoubleClick);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    svg.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  // ---------------------------------------------------------------------
  // Mouse / pointer
  // ---------------------------------------------------------------------

  private onMouseDown = (e: MouseEvent): void => {
    if (this.editor) return; // Ignore canvas clicks while editing.
    const targetNodeId = this.findNodeAt(e.target);

    // Middle-click or space+drag → pan.
    if (e.button === 1 || (e.button === 0 && this.spaceDown) || (e.button === 0 && targetNodeId === null)) {
      // Only start panning on left-click empty space if space is held,
      // otherwise treat empty-space click as a deselection.
      if (e.button === 1 || this.spaceDown) {
        e.preventDefault();
        const v = this.store.getState().viewport;
        this.pan = { startX: e.clientX, startY: e.clientY, vx: v.x, vy: v.y };
        return;
      }
      // Empty-space left click without space: just deselect.
      this.store.select(null);
      return;
    }

    if (e.button !== 0 || targetNodeId === null) return;

    // Left-click on a node → select + start a potential drag.
    this.store.select(targetNodeId);
    const node = this.store.getState().nodes[targetNodeId];
    if (!node) return;
    const world = this.renderer.screenToWorld(this.store.getState(), e.clientX, e.clientY);
    this.nodeDrag = {
      id: targetNodeId,
      offsetX: world.x - node.x,
      offsetY: world.y - node.y,
      moved: false
    };
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.pan) {
      const dx = e.clientX - this.pan.startX;
      const dy = e.clientY - this.pan.startY;
      const v = this.store.getState().viewport;
      this.store.setViewport({ ...v, x: this.pan.vx + dx, y: this.pan.vy + dy });
      this.renderer.applyViewport(this.store.getState());
      return;
    }
    if (this.nodeDrag) {
      const world = this.renderer.screenToWorld(this.store.getState(), e.clientX, e.clientY);
      const x = world.x - this.nodeDrag.offsetX;
      const y = world.y - this.nodeDrag.offsetY;
      this.store.silent(() => this.store.moveNode(this.nodeDrag!.id, x, y, true));
      this.nodeDrag.moved = true;
    }
  };

  private onMouseUp = (_e: MouseEvent): void => {
    if (this.pan) {
      this.pan = null;
      return;
    }
    if (this.nodeDrag) {
      // Commit a single history entry for the drag if movement happened.
      if (this.nodeDrag.moved) {
        const node = this.store.getState().nodes[this.nodeDrag.id];
        if (node) {
          this.store.moveNode(this.nodeDrag.id, node.x, node.y, true);
        }
      }
      this.nodeDrag = null;
    }
  };

  private onDoubleClick = (e: MouseEvent): void => {
    const id = this.findNodeAt(e.target);
    if (id === null) return;
    e.preventDefault();
    this.beginEdit(id);
  };

  private onWheel = (e: WheelEvent): void => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const direction = e.deltaY < 0 ? 1 : -1;
    const factor = direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const state = this.store.getState();

    // Zoom around the cursor: keep the world point under the cursor fixed.
    const before = this.renderer.screenToWorld(state, e.clientX, e.clientY);
    const newZoom = clamp(state.viewport.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    this.store.setViewport({ ...state.viewport, zoom: newZoom });
    const after = this.renderer.screenToWorld(this.store.getState(), e.clientX, e.clientY);
    const v = this.store.getState().viewport;
    this.store.setViewport({
      ...v,
      x: v.x + (after.x - before.x) * newZoom,
      y: v.y + (after.y - before.y) * newZoom
    });
    this.renderer.applyViewport(this.store.getState());
  };

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

    if (e.key === ' ') {
      this.spaceDown = true;
      // Don't consume the space here; only suppress its default while panning.
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
    const id = this.store.addChild(parentId, '');
    this.runAutoLayout();
    this.beginEdit(id);
  }

  private addSiblingAndEdit(siblingId: string): void {
    const id = this.store.addSibling(siblingId, '');
    if (id) {
      this.runAutoLayout();
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
    editor.contentEditable = 'plaintext-only';
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

/** Numeric clamp helper. */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

