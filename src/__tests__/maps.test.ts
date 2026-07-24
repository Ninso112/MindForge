// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it } from 'vitest';
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
} from '../maps.js';
import { serialize } from '../serializer.js';
import { Store } from '../state.js';

beforeEach(() => {
  localStorage.clear();
});

describe('maps storage', () => {
  it('createMap persists a fresh map and marks it active', () => {
    const { meta, state } = createMap('Test', 'dark');
    expect(getActiveMapId()).toBe(meta.id);
    expect(state.nodes[state.rootId]?.label).toBe('Test');
    expect(listMaps().map((m) => m.id)).toContain(meta.id);
  });

  it('saveMapState + loadMapState round-trips and bumps updatedAt', () => {
    const { meta, state } = createMap('A', 'dark');
    const store = new Store(state);
    store.addChild(store.getState().rootId, 'child');
    expect(saveMapState(meta.id, store.getState())).toBe(true);
    const loaded = loadMapState(meta.id, 'dark');
    expect(loaded).not.toBeNull();
    expect(Object.keys(loaded!.nodes)).toHaveLength(2);
    expect(listMaps()[0]!.updatedAt).toBeGreaterThanOrEqual(meta.updatedAt);
  });

  it('renameMap updates the index name', () => {
    const { meta } = createMap('Old', 'dark');
    renameMap(meta.id, 'New');
    expect(listMaps().find((m) => m.id === meta.id)?.name).toBe('New');
  });

  it('deleteMap removes payload and index entry', () => {
    const { meta } = createMap('Doomed', 'dark');
    deleteMap(meta.id);
    expect(listMaps()).toHaveLength(0);
    expect(loadMapState(meta.id, 'dark')).toBeNull();
  });

  it('setActiveMapId/getActiveMapId round-trip', () => {
    setActiveMapId('abc');
    expect(getActiveMapId()).toBe('abc');
  });

  it('migrateLegacyAutosave imports the old autosave once', () => {
    const store = new Store();
    store.setLabel(store.getState().rootId, 'Legacy Map');
    localStorage.setItem('mindforge:autosave', JSON.stringify(serialize(store.getState())));
    migrateLegacyAutosave('dark');
    const maps = listMaps();
    expect(maps).toHaveLength(1);
    expect(maps[0]!.name).toBe('Legacy Map');
    const loaded = loadMapState(maps[0]!.id, 'dark');
    expect(loaded?.nodes[loaded.rootId]?.label).toBe('Legacy Map');
    expect(getActiveMapId()).toBe(maps[0]!.id);
    // Running the migration again must not duplicate the map.
    migrateLegacyAutosave('dark');
    expect(listMaps()).toHaveLength(1);
  });

  it('migrateLegacyAutosave is a no-op without legacy data', () => {
    migrateLegacyAutosave('dark');
    expect(listMaps()).toHaveLength(0);
  });

  it('corrupt index data yields an empty list instead of throwing', () => {
    localStorage.setItem('mindforge:maps:index', '{not json');
    expect(listMaps()).toEqual([]);
    localStorage.setItem('mindforge:maps:index', JSON.stringify([{ bogus: true }]));
    expect(listMaps()).toEqual([]);
  });
});
