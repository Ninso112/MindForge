// SPDX-License-Identifier: GPL-3.0-or-later

import type { AppState } from './types.js';
import { createInitialState, uuid } from './state.js';
import { deserialize, LEGACY_AUTOSAVE_KEY, serialize } from './serializer.js';

/**
 * Storage layer for managing multiple maps in `localStorage`.
 *
 * Layout:
 * - `mindforge:maps:index`  JSON array of `MapMeta` (id, name, updatedAt)
 * - `mindforge:maps:active` id of the currently open map
 * - `mindforge:map:<id>`    serialized map payload per map
 *
 * The pre-multi-map autosave (`mindforge:autosave`) is migrated into
 * this layout by `migrateLegacyAutosave` on first boot.
 */

/** Metadata for one stored map, kept in the maps index. */
export interface MapMeta {
  id: string;
  name: string;
  updatedAt: number;
}

const INDEX_KEY = 'mindforge:maps:index';
const ACTIVE_KEY = 'mindforge:maps:active';
const MAP_PREFIX = 'mindforge:map:';

/** Default name used for the very first map (and as fallback). */
const DEFAULT_MAP_NAME = 'My Map';

/** Read and validate the maps index. Corrupt data yields an empty list. */
function readIndex(): MapMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMapMeta);
  } catch {
    return [];
  }
}

function isMapMeta(v: unknown): v is MapMeta {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['id'] === 'string' && typeof o['name'] === 'string' && typeof o['updatedAt'] === 'number';
}

function writeIndex(maps: MapMeta[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(maps));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('MindForge: maps index save failed', err);
  }
}

/** List all stored maps, most recently updated first. */
export function listMaps(): MapMeta[] {
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The id of the currently active map, or `null` when none is set. */
export function getActiveMapId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

/** Persist the id of the currently active map. */
export function setActiveMapId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('MindForge: active map id save failed', err);
  }
}

/** Load a map's state from storage. Returns `null` when missing/corrupt. */
export function loadMapState(id: string, currentTheme: 'light' | 'dark'): AppState | null {
  try {
    const raw = localStorage.getItem(MAP_PREFIX + id);
    if (raw === null) return null;
    return deserialize(JSON.parse(raw), currentTheme);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('MindForge: map load failed', err);
    return null;
  }
}

/**
 * Persist a map's state and bump its `updatedAt` in the index.
 * Returns `false` when the write fails (quota, private mode, ...).
 */
export function saveMapState(id: string, state: AppState): boolean {
  try {
    localStorage.setItem(MAP_PREFIX + id, JSON.stringify(serialize(state)));
    const index = readIndex();
    const meta = index.find((m) => m.id === id);
    if (meta) {
      meta.updatedAt = Date.now();
      writeIndex(index);
    }
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('MindForge: map save failed', err);
    return false;
  }
}

/**
 * Create a fresh map whose root node carries `name`, persist it, and
 * mark it active. Returns both the metadata and the initial state.
 */
export function createMap(name: string, theme: 'light' | 'dark'): { meta: MapMeta; state: AppState } {
  const id = uuid();
  const state = createInitialState();
  state.theme = theme;
  const root = state.nodes[state.rootId];
  if (root) root.label = name;
  const meta: MapMeta = { id, name, updatedAt: Date.now() };
  try {
    localStorage.setItem(MAP_PREFIX + id, JSON.stringify(serialize(state)));
    const index = readIndex();
    index.push(meta);
    writeIndex(index);
    setActiveMapId(id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('MindForge: map create failed', err);
  }
  return { meta, state };
}

/** Rename a map in the index. No-op for unknown ids. */
export function renameMap(id: string, name: string): void {
  const index = readIndex();
  const meta = index.find((m) => m.id === id);
  if (!meta) return;
  meta.name = name;
  writeIndex(index);
}

/** Delete a map's payload and its index entry. */
export function deleteMap(id: string): void {
  try {
    localStorage.removeItem(MAP_PREFIX + id);
    writeIndex(readIndex().filter((m) => m.id !== id));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('MindForge: map delete failed', err);
  }
}

/**
 * Move the legacy single-map autosave into the multi-map layout. Runs
 * once: skipped when an index already exists. The legacy key is left
 * in place as a backup.
 */
export function migrateLegacyAutosave(currentTheme: 'light' | 'dark'): void {
  try {
    if (readIndex().length > 0) return;
    const raw = localStorage.getItem(LEGACY_AUTOSAVE_KEY);
    if (raw === null) return;
    const state = deserialize(JSON.parse(raw), currentTheme);
    const name = state.nodes[state.rootId]?.label.trim() || DEFAULT_MAP_NAME;
    const id = uuid();
    localStorage.setItem(MAP_PREFIX + id, JSON.stringify(serialize(state)));
    writeIndex([{ id, name, updatedAt: Date.now() }]);
    setActiveMapId(id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('MindForge: legacy autosave migration failed', err);
  }
}
