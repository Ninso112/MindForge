// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { Store } from '../state.js';

describe('Store', () => {
  it('addChild links parent and child', () => {
    const store = new Store();
    const root = store.getState().rootId;
    const childId = store.addChild(root, 'A');
    const state = store.getState();
    expect(state.nodes[childId]?.parentId).toBe(root);
    expect(state.nodes[root]?.children).toContain(childId);
    expect(state.selectedId).toBe(childId);
  });

  it('deleteNode is a no-op on the root', () => {
    const store = new Store();
    const before = store.getState();
    store.deleteNode(before.rootId);
    expect(store.getState().nodes[before.rootId]).toBeDefined();
  });

  it('deleteNode removes the subtree', () => {
    const store = new Store();
    const root = store.getState().rootId;
    const childId = store.addChild(root, 'A');
    const grandId = store.addChild(childId, 'B');
    store.deleteNode(childId);
    const state = store.getState();
    expect(state.nodes[childId]).toBeUndefined();
    expect(state.nodes[grandId]).toBeUndefined();
    expect(state.nodes[root]?.children).not.toContain(childId);
  });

  it('undo/redo restores prior state', () => {
    const store = new Store();
    const root = store.getState().rootId;
    store.addChild(root, 'A');
    const afterAdd = Object.keys(store.getState().nodes).length;
    store.undo();
    expect(Object.keys(store.getState().nodes).length).toBe(afterAdd - 1);
    store.redo();
    expect(Object.keys(store.getState().nodes).length).toBe(afterAdd);
  });

  it('setNodeColor(null) removes the color override', () => {
    const store = new Store();
    const root = store.getState().rootId;
    store.setNodeColor(root, '#abcdef');
    expect(store.getState().nodes[root]?.color).toBe('#abcdef');
    store.setNodeColor(root, null);
    expect(store.getState().nodes[root]?.color).toBeUndefined();
  });

  it('addSibling on the root returns null', () => {
    const store = new Store();
    const root = store.getState().rootId;
    expect(store.addSibling(root)).toBeNull();
  });
});
