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

  it('batch notifies listeners only once for compound updates', () => {
    const store = new Store();
    const root = store.getState().rootId;
    let calls = 0;
    store.subscribe(() => { calls++; });
    store.batch(() => {
      const id = store.addChild(root, 'A');
      store.setLabel(id, 'B');
      store.toggleCollapsed(id);
    });
    expect(calls).toBe(1);
    // Nested batches still notify exactly once at the outermost end.
    store.batch(() => {
      store.batch(() => {
        store.setLabel(root, 'X');
      });
      store.setLabel(root, 'Y');
    });
    expect(calls).toBe(2);
    expect(store.getState().nodes[root]?.label).toBe('Y');
  });

  it('moveNodeOnly mutates without notifying listeners', () => {
    const store = new Store();
    const root = store.getState().rootId;
    const childId = store.addChild(root, 'A');
    let calls = 0;
    store.subscribe(() => { calls++; });
    store.moveNodeOnly(childId, 42, 24);
    expect(calls).toBe(0);
    const node = store.getState().nodes[childId]!;
    expect(node.x).toBe(42);
    expect(node.y).toBe(24);
    expect(node.pinned).toBe(true);
  });

  it('setNodeNote sets, updates, and clears notes (undoable)', () => {
    const store = new Store();
    const root = store.getState().rootId;
    store.setNodeNote(root, 'first');
    expect(store.getState().nodes[root]?.note).toBe('first');
    store.setNodeNote(root, 'second');
    expect(store.getState().nodes[root]?.note).toBe('second');
    store.setNodeNote(root, null);
    expect(store.getState().nodes[root]?.note).toBeUndefined();
    store.undo();
    expect(store.getState().nodes[root]?.note).toBe('second');
  });

  it('setNodeNote treats blank strings as removal', () => {
    const store = new Store();
    const root = store.getState().rootId;
    store.setNodeNote(root, 'x');
    store.setNodeNote(root, '   ');
    expect(store.getState().nodes[root]?.note).toBeUndefined();
  });

  it('pushUndo with a pre-drag snapshot restores the pre-drag position', () => {
    const store = new Store();
    const root = store.getState().rootId;
    const childId = store.addChild(root, 'A');
    const before = store.getState().nodes[childId]!;
    // Simulate a drag: capture the snapshot first, then move silently.
    const snap = store.snapshot();
    store.silent(() => store.moveNode(childId, before.x + 500, before.y + 500, true));
    store.pushUndo(snap);
    store.undo();
    const node = store.getState().nodes[childId]!;
    expect(node.x).toBe(before.x);
    expect(node.y).toBe(before.y);
    // And redo brings the dragged position back.
    store.redo();
    const dragged = store.getState().nodes[childId]!;
    expect(dragged.x).toBe(before.x + 500);
    expect(dragged.y).toBe(before.y + 500);
  });
});
