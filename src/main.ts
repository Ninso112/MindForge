// SPDX-License-Identifier: GPL-3.0-or-later

import './style.css';
import { Store } from './state.js';
import type { AppState } from './types.js';
import { Renderer } from './renderer.js';
import { InputController } from './input.js';
import { radialLayout } from './layout.js';
import {
  downloadAsFile,
  loadThemePreference,
  openFromFile,
  saveThemePreference
} from './serializer.js';
import {
  createMap,
  deleteMap,
  getActiveMapId,
  listMaps,
  loadMapState,
  migrateLegacyAutosave,
  renameMap,
  saveMapState,
  setActiveMapId
} from './maps.js';
import { MapsPanel } from './mapsPanel.js';
import { exportPdf, exportPng, exportSvg } from './export.js';
import { openColorPicker } from './colorPicker.js';
import { openNoteEditor } from './noteEditor.js';
import { SearchController } from './search.js';

/**
 * Entry point: build the store, renderer, and input controller, wire up
 * the toolbar, and start the render + autosave loops.
 */
function main(): void {
  const root = document.getElementById('app');
  if (!root) throw new Error('MindForge: #app container not found');

  // Bootstrap state from localStorage if available. An explicit theme
  // choice made in a previous session wins over the OS preference.
  const systemTheme: 'light' | 'dark' =
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  const initialTheme = loadThemePreference() ?? systemTheme;
  migrateLegacyAutosave(initialTheme);
  const boot = resolveInitialMap(initialTheme);
  let activeMapId: string = boot.id;
  const store = new Store(boot.state);

  const canvas = document.createElement('div');
  canvas.className = 'mf-canvas';
  root.appendChild(canvas);

  const renderer = new Renderer(canvas);
  const input = new InputController(store, renderer, canvas);

  renderer.render(store.getState());
  applyTheme(store.getState().theme);

  // Re-render on every state change. Persist the theme whenever it
  // flips so the choice survives a reload (it is not part of the
  // serialized map format).
  let lastTheme = store.getState().theme;
  store.subscribe((state) => {
    renderer.render(state);
    applyTheme(state.theme);
    if (state.theme !== lastTheme) {
      lastTheme = state.theme;
      saveThemePreference(state.theme);
    }
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

  // Search box (Ctrl+F).
  const search = new SearchController(store, renderer, canvas);
  window.addEventListener('mindforge:open-search', () => search.open());

  // Note editor open requests come from the input layer / toolbar.
  window.addEventListener('mindforge:open-note-editor', (e) => {
    const detail = (e as CustomEvent<{ nodeId: string }>).detail;
    if (!detail?.nodeId) return;
    openNoteEditor(canvas, store, detail.nodeId);
  });

  // ---------------------------------------------------------------------
  // Multi-map management (maps panel + switch/rename/delete/new events)
  // ---------------------------------------------------------------------

  const mapsPanel = new MapsPanel(canvas, () => activeMapId);
  document.getElementById('tb-maps')?.addEventListener('click', () => mapsPanel.open());

  const notifyMapsChanged = (): void => {
    window.dispatchEvent(new CustomEvent('mindforge:maps-changed'));
  };

  /** Save the current map, then load and activate another one. */
  const switchToMap = (id: string): void => {
    if (id === activeMapId) return;
    saveMapState(activeMapId, store.getState());
    const state = loadMapState(id, store.getState().theme);
    if (!state) {
      flashStatus('Could not open map');
      return;
    }
    activeMapId = id;
    setActiveMapId(id);
    store.replace(state);
    const name = listMaps().find((m) => m.id === id)?.name ?? 'map';
    flashStatus(`Opened "${name}"`);
    notifyMapsChanged();
  };

  window.addEventListener('mindforge:switch-map', (e) => {
    const detail = (e as CustomEvent<{ id: string }>).detail;
    if (detail?.id) switchToMap(detail.id);
  });
  window.addEventListener('mindforge:rename-map', (e) => {
    const detail = (e as CustomEvent<{ id: string; name: string }>).detail;
    if (!detail?.id || !detail.name) return;
    renameMap(detail.id, detail.name);
    notifyMapsChanged();
  });
  window.addEventListener('mindforge:delete-map', (e) => {
    const detail = (e as CustomEvent<{ id: string }>).detail;
    if (!detail?.id) return;
    deleteMap(detail.id);
    if (detail.id === activeMapId) {
      // The active map is gone — open the next best one or start fresh.
      const next = listMaps()[0];
      if (next) {
        activeMapId = next.id;
        setActiveMapId(next.id);
        const state = loadMapState(next.id, store.getState().theme);
        if (state) store.replace(state);
      } else {
        const created = createMap('My Map', store.getState().theme);
        activeMapId = created.meta.id;
        store.replace(created.state);
      }
    }
    notifyMapsChanged();
    flashStatus('Map deleted');
  });
  window.addEventListener('mindforge:new-map', () => {
    const name = window.prompt('Name for the new map:', 'Untitled');
    if (name === null) return; // Cancelled — keep the current map.
    // Persist the current map before switching away so nothing is lost.
    saveMapState(activeMapId, store.getState());
    const created = createMap(name.trim() || 'Untitled', store.getState().theme);
    activeMapId = created.meta.id;
    store.replace(created.state);
    notifyMapsChanged();
    flashStatus(`Map "${created.meta.name}" created`);
  });

  // Persistence: every 30s and on unload. Warn the user once per session
  // if autosave fails (quota exceeded, private mode, etc.) so they can
  // export manually before losing work.
  const AUTOSAVE_INTERVAL_MS = 30_000;
  let quotaWarned = false;
  const tryAutosave = (): void => {
    const ok = saveMapState(activeMapId, store.getState());
    if (!ok && !quotaWarned) {
      quotaWarned = true;
      flashStatus('Autosave failed — please export your map manually');
    }
  };
  const interval = window.setInterval(tryAutosave, AUTOSAVE_INTERVAL_MS);
  window.addEventListener('beforeunload', () => {
    window.clearInterval(interval);
    saveMapState(activeMapId, store.getState());
  });
  window.addEventListener('mindforge:save', () => {
    const ok = saveMapState(activeMapId, store.getState());
    flashStatus(ok ? 'Saved to browser storage' : 'Save failed — please export manually');
  });
  window.addEventListener('mindforge:flash-status', (e) => {
    const detail = (e as CustomEvent<{ text: string }>).detail;
    if (detail?.text) flashStatus(detail.text);
  });
}

/**
 * Resolve which map to open at boot: the previously active one when it
 * still loads, otherwise a fresh default map (covers first run and
 * dangling active ids).
 */
function resolveInitialMap(theme: 'light' | 'dark'): { id: string; state: AppState } {
  const activeId = getActiveMapId();
  const state = activeId ? loadMapState(activeId, theme) : null;
  if (state && activeId) return { id: activeId, state };
  const created = createMap('My Map', theme);
  return { id: created.meta.id, state: created.state };
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

  byId('tb-new')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('mindforge:new-map'));
  });
  byId('tb-add-child')?.addEventListener('click', () => {
    const sel = store.getState().selectedId ?? store.getState().rootId;
    store.batch(() => {
      store.addChild(sel, '');
      input.runAutoLayout();
    });
  });
  byId('tb-add-sibling')?.addEventListener('click', () => {
    const sel = store.getState().selectedId;
    if (sel) {
      store.batch(() => {
        store.addSibling(sel, '');
        input.runAutoLayout();
      });
    }
  });
  byId('tb-delete')?.addEventListener('click', () => {
    const sel = store.getState().selectedId;
    if (sel) store.deleteNode(sel);
  });
  byId('tb-collapse')?.addEventListener('click', () => {
    const sel = store.getState().selectedId;
    if (sel) store.toggleCollapsed(sel);
  });
  byId('tb-color')?.addEventListener('click', () => {
    const sel = store.getState().selectedId;
    if (sel) openColorPicker(canvas, renderer, store, sel);
  });
  byId('tb-note')?.addEventListener('click', () => {
    const sel = store.getState().selectedId;
    if (sel) openNoteEditor(canvas, store, sel);
  });
  byId('tb-reset')?.addEventListener('click', () => {
    store.batch(() => {
      store.resetPins();
      const positions = radialLayout(store.getState());
      store.applyLayout(positions);
    });
  });
  byId('tb-fit')?.addEventListener('click', () => {
    input.fitToView();
  });
  byId('tb-export')?.addEventListener('click', () => {
    downloadAsFile(store.getState());
  });
  byId('tb-export-png')?.addEventListener('click', () => {
    exportPng(store.getState(), renderer).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('PNG export failed:', err);
      flashStatus(`PNG export failed: ${errMessage(err)}`);
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
      .then((s) => {
        store.replace(s);
        flashStatus('Map imported');
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('Import cancelled or failed:', err);
        if (errMessage(err) !== 'No file selected') {
          flashStatus(`Import failed: ${errMessage(err)}`);
        }
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
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('mf-help--open')) {
      overlay.classList.remove('mf-help--open');
    }
  });
}

/** Duration the status pill stays visible (ms). */
const STATUS_DURATION_MS = 1800;

/** Pending hide-timer for the status pill; tracked so rapid successive
 * messages don't get hidden early by a stale timer. */
let statusTimer: number | null = null;

/**
 * Show a transient status message at the bottom of the screen.
 */
function flashStatus(text: string): void {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text;
  el.classList.add('mf-status--visible');
  if (statusTimer !== null) window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    statusTimer = null;
    el.classList.remove('mf-status--visible');
  }, STATUS_DURATION_MS);
}

/**
 * Coerce an unknown caught error value to a human-readable string for
 * display in status toasts.
 */
function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

main();
