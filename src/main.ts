// SPDX-License-Identifier: GPL-3.0-or-later

import './style.css';
import { Store } from './state.js';
import { Renderer } from './renderer.js';
import { InputController } from './input.js';
import { radialLayout } from './layout.js';
import {
  downloadAsFile,
  loadFromLocalStorage,
  openFromFile,
  saveToLocalStorage
} from './serializer.js';
import { exportPdf, exportPng, exportSvg } from './export.js';
import { openColorPicker } from './colorPicker.js';

/**
 * Entry point: build the store, renderer, and input controller, wire up
 * the toolbar, and start the render + autosave loops.
 */
function main(): void {
  const root = document.getElementById('app');
  if (!root) throw new Error('MindForge: #app container not found');

  // Bootstrap state from localStorage if available.
  const initialTheme: 'light' | 'dark' =
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  const persisted = loadFromLocalStorage(initialTheme);
  const store = new Store(persisted ?? undefined);

  const canvas = document.createElement('div');
  canvas.className = 'mf-canvas';
  root.appendChild(canvas);

  const renderer = new Renderer(canvas);
  const input = new InputController(store, renderer, canvas);

  // First-time render. Run the auto-layout once so a freshly imported
  // map (whose pinned flags are honored) has sensible coordinates for
  // the unpinned root and its children.
  if (!persisted) {
    input.runAutoLayout();
  }
  renderer.render(store.getState());
  applyTheme(store.getState().theme);

  // Re-render on every state change.
  store.subscribe((state) => {
    renderer.render(state);
    applyTheme(state.theme);
  });

  // Keep node positions in sync when the window resizes (the SVG center
  // point moves, so the viewport transform must be recomputed).
  window.addEventListener('resize', () => renderer.applyViewport(store.getState()));

  // Toolbar wiring.
  bindToolbar(store, input, canvas, renderer);

  // Help overlay.
  bindHelpOverlay();

  // Color-picker open requests come from the input layer.
  window.addEventListener('mindforge:open-color-picker', (e) => {
    const detail = (e as CustomEvent<{ nodeId: string }>).detail;
    if (!detail?.nodeId) return;
    openColorPicker(canvas, renderer, store, detail.nodeId);
  });

  // Persistence: every 30s and on unload.
  const AUTOSAVE_INTERVAL_MS = 30_000;
  const interval = window.setInterval(() => saveToLocalStorage(store.getState()), AUTOSAVE_INTERVAL_MS);
  window.addEventListener('beforeunload', () => {
    window.clearInterval(interval);
    saveToLocalStorage(store.getState());
  });
  window.addEventListener('mindforge:save', () => {
    saveToLocalStorage(store.getState());
    flashStatus('Saved to browser storage');
  });
}

/**
 * Apply the active theme to the document root by toggling a data
 * attribute that CSS variables select on.
 */
function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.dataset['theme'] = theme;
}

/**
 * Attach click handlers to the floating toolbar. The HTML markup lives
 * in `index.html`; we bind by id here.
 */
function bindToolbar(
  store: Store,
  input: InputController,
  canvas: HTMLElement,
  renderer: Renderer
): void {
  const byId = (id: string): HTMLElement | null => document.getElementById(id);

  byId('tb-add-child')?.addEventListener('click', () => {
    const sel = store.getState().selectedId ?? store.getState().rootId;
    store.addChild(sel, '');
    input.runAutoLayout();
  });
  byId('tb-add-sibling')?.addEventListener('click', () => {
    const sel = store.getState().selectedId;
    if (sel) {
      store.addSibling(sel, '');
      input.runAutoLayout();
    }
  });
  byId('tb-delete')?.addEventListener('click', () => {
    const sel = store.getState().selectedId;
    if (sel) store.deleteNode(sel);
  });
  byId('tb-color')?.addEventListener('click', () => {
    const sel = store.getState().selectedId;
    if (sel) openColorPicker(canvas, renderer, store, sel);
  });
  byId('tb-reset')?.addEventListener('click', () => {
    store.resetPins();
    const positions = radialLayout(store.getState());
    store.applyLayout(positions);
  });
  byId('tb-export')?.addEventListener('click', () => {
    downloadAsFile(store.getState());
  });
  byId('tb-export-png')?.addEventListener('click', () => {
    exportPng(store.getState(), renderer).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('PNG export failed:', err);
    });
  });
  byId('tb-export-pdf')?.addEventListener('click', () => {
    exportPdf(store.getState(), renderer);
  });
  byId('tb-export-svg')?.addEventListener('click', () => {
    exportSvg(store.getState(), renderer);
  });
  byId('tb-import')?.addEventListener('click', () => {
    openFromFile(store.getState().theme)
      .then((s) => store.replace(s))
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('Import cancelled or failed:', err);
      });
  });
  byId('tb-theme')?.addEventListener('click', () => {
    const cur = store.getState().theme;
    store.setTheme(cur === 'dark' ? 'light' : 'dark');
  });
  byId('tb-help')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('mindforge:toggle-help'));
  });
}

/**
 * Show or hide the keyboard help overlay in response to the
 * `mindforge:toggle-help` custom event.
 */
function bindHelpOverlay(): void {
  const overlay = document.getElementById('help-overlay');
  if (!overlay) return;
  window.addEventListener('mindforge:toggle-help', () => {
    overlay.classList.toggle('mf-help--open');
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('mf-help--open');
  });
  document.getElementById('help-close')?.addEventListener('click', () => {
    overlay.classList.remove('mf-help--open');
  });
}

/**
 * Show a transient status message at the bottom of the screen.
 */
function flashStatus(text: string): void {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text;
  el.classList.add('mf-status--visible');
  window.setTimeout(() => el.classList.remove('mf-status--visible'), 1800);
}

main();
