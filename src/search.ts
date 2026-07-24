// SPDX-License-Identifier: GPL-3.0-or-later

import type { Renderer } from './renderer.js';
import type { Store } from './state.js';
import { visibleNodeIds } from './utils.js';

/**
 * Incremental label search (Ctrl+F). A small floating box filters the
 * visible nodes by label substring; matches are highlighted on the
 * canvas and Enter/Shift+Enter cycles through them, centering each hit.
 * Search state is ephemeral UI state and intentionally lives outside
 * the Store (it is neither persisted nor undoable).
 */
export class SearchController {
  private readonly store: Store;
  private readonly renderer: Renderer;
  private readonly box: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly counter: HTMLSpanElement;
  private matches: string[] = [];
  private index = -1;

  constructor(store: Store, renderer: Renderer, host: HTMLElement) {
    this.store = store;
    this.renderer = renderer;

    this.box = document.createElement('div');
    this.box.className = 'mf-search';
    this.box.setAttribute('role', 'search');

    this.input = document.createElement('input');
    this.input.type = 'search';
    this.input.placeholder = 'Search nodes…';
    this.input.setAttribute('aria-label', 'Search nodes');

    this.counter = document.createElement('span');
    this.counter.className = 'mf-search__count';

    this.box.appendChild(this.input);
    this.box.appendChild(this.counter);
    this.box.hidden = true;
    host.appendChild(this.box);

    this.input.addEventListener('input', () => this.recompute());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
  }

  /** Whether the search box is currently open. */
  isOpen(): boolean {
    return !this.box.hidden;
  }

  /** Open the search box and focus the input. */
  open(): void {
    this.box.hidden = false;
    this.input.focus();
    this.input.select();
    this.recompute();
  }

  /** Close the search box and clear the canvas highlights. */
  close(): void {
    this.box.hidden = true;
    this.matches = [];
    this.index = -1;
    this.renderer.setHighlights(new Set(), null);
    this.renderer.render(this.store.getState());
  }

  /** Recompute matches from the current query (visible nodes only). */
  private recompute(): void {
    const query = this.input.value.trim().toLowerCase();
    const state = this.store.getState();
    if (query.length === 0) {
      this.matches = [];
    } else {
      this.matches = visibleNodeIds(state).filter((id) =>
        (state.nodes[id]?.label.toLowerCase() ?? '').includes(query)
      );
    }
    this.index = this.matches.length > 0 ? 0 : -1;
    this.apply();
  }

  /** Push the current match state to the renderer and jump to it. */
  private apply(): void {
    const current = this.index >= 0 ? (this.matches[this.index] ?? null) : null;
    this.renderer.setHighlights(new Set(this.matches), current);
    this.counter.textContent =
      this.input.value.trim().length === 0
        ? ''
        : this.matches.length === 0
          ? '0/0'
          : `${this.index + 1}/${this.matches.length}`;
    if (current) {
      this.jumpTo(current); // Store notify triggers the re-render.
    } else {
      this.renderer.render(this.store.getState());
    }
  }

  /** Cycle to the next/previous match. */
  private step(dir: 1 | -1): void {
    if (this.matches.length === 0) return;
    this.index = (this.index + dir + this.matches.length) % this.matches.length;
    this.apply();
  }

  /** Select a match and center the viewport on it. */
  private jumpTo(id: string): void {
    const state = this.store.getState();
    const node = state.nodes[id];
    if (!node) return;
    this.store.select(id);
    // Center the node on the canvas: V = -node * zoom.
    const zoom = state.viewport.zoom;
    this.store.setViewport({ x: -node.x * zoom, y: -node.y * zoom, zoom });
  }

  private onKey(e: KeyboardEvent): void {
    // Keep global canvas shortcuts quiet while typing in the search box.
    e.stopPropagation();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      this.input.select();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.step(e.shiftKey ? -1 : 1);
    }
  }
}
