// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { deserialize, serialize } from '../serializer.js';
import { Store } from '../state.js';
import type { AppState, MindNode, SerializedMap } from '../types.js';

function buildMap(nodes: MindNode[], rootId: string): SerializedMap {
  return {
    version: '1',
    nodes,
    rootId,
    viewport: { x: 0, y: 0, zoom: 1 }
  };
}

function n(id: string, parentId: string | null, children: string[] = []): MindNode {
  return { id, label: id, parentId, children, x: 0, y: 0, collapsed: false, pinned: false };
}

describe('serializer', () => {
  it('round-trips a simple state', () => {
    const store = new Store();
    const root = store.getState().rootId;
    store.addChild(root, 'A');
    const before = store.getState();
    const json = JSON.parse(JSON.stringify(serialize(before))) as unknown;
    const after: AppState = deserialize(json, before.theme);
    expect(after.rootId).toBe(before.rootId);
    expect(Object.keys(after.nodes).sort()).toEqual(Object.keys(before.nodes).sort());
    for (const id of Object.keys(before.nodes)) {
      const a = after.nodes[id]!;
      const b = before.nodes[id]!;
      expect(a.label).toBe(b.label);
      expect(a.parentId).toBe(b.parentId);
      expect(a.children).toEqual(b.children);
    }
  });

  it('rejects wrong version', () => {
    const bad = { ...buildMap([n('r', null)], 'r'), version: '2' };
    expect(() => deserialize(bad, 'dark')).toThrow(/Unsupported map version/);
  });

  it('rejects missing rootId', () => {
    const bad = { version: '1', nodes: [], viewport: { x: 0, y: 0, zoom: 1 } };
    expect(() => deserialize(bad, 'dark')).toThrow(/missing "rootId"/);
  });

  it('rejects rootId pointing at no node', () => {
    const bad = buildMap([n('a', null)], 'missing');
    expect(() => deserialize(bad, 'dark')).toThrow(/rootId does not refer/);
  });

  it('rejects duplicate node ids', () => {
    const bad = buildMap([n('r', null), n('r', null)], 'r');
    expect(() => deserialize(bad, 'dark')).toThrow(/duplicate node id/);
  });

  it('rejects child reference to a missing node', () => {
    const bad = buildMap([n('r', null, ['ghost'])], 'r');
    expect(() => deserialize(bad, 'dark')).toThrow(/references missing child/);
  });

  it('rejects parentId pointing into the void', () => {
    const bad = buildMap([n('r', null), n('a', 'ghost')], 'r');
    expect(() => deserialize(bad, 'dark')).toThrow(/parentId .* does not exist/);
  });

  it('rejects mismatched parent/child links', () => {
    // child says parent is r, but r does not list it as a child
    const bad = buildMap([n('r', null), n('a', 'r')], 'r');
    expect(() => deserialize(bad, 'dark')).toThrow();
  });

  it('rejects a cycle in the parent chain', () => {
    // a is parent of b; b is parent of a; root r references neither.
    // We bypass the consistent child-link check by making both list each other.
    const a: MindNode = { ...n('a', 'b', ['b']), id: 'a' };
    const b: MindNode = { ...n('b', 'a', ['a']), id: 'b' };
    const root: MindNode = n('r', null);
    const bad = buildMap([root, a, b], 'r');
    expect(() => deserialize(bad, 'dark')).toThrow();
  });

  it('rejects a non-null parentId on the root', () => {
    const bad = buildMap([n('r', 'x'), n('x', null, ['r'])], 'r');
    expect(() => deserialize(bad, 'dark')).toThrow(/root must have parentId/);
  });
});
