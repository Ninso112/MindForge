// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { radialLayout } from '../layout.js';
import { Store } from '../state.js';

describe('radialLayout', () => {
  it('places only the root for an empty map', () => {
    const store = new Store();
    const out = radialLayout(store.getState());
    const rootId = store.getState().rootId;
    expect(out[rootId]).toEqual({ x: 0, y: 0 });
    expect(Object.keys(out)).toHaveLength(1);
  });

  it('distributes 4 children at roughly the base radius', () => {
    const store = new Store();
    const root = store.getState().rootId;
    for (let i = 0; i < 4; i++) store.addChild(root, `c${i}`);
    const out = radialLayout(store.getState());
    const childIds = Object.keys(out).filter((id) => id !== root);
    expect(childIds).toHaveLength(4);
    // All four should sit near the same radius from the origin.
    const radii = childIds.map((id) => Math.hypot(out[id]!.x, out[id]!.y));
    for (const r of radii) {
      expect(r).toBeGreaterThan(200);
      expect(r).toBeLessThan(240);
    }
  });

  it('skips pinned nodes', () => {
    const store = new Store();
    const root = store.getState().rootId;
    const childId = store.addChild(root, 'pinned');
    store.moveNode(childId, 999, 999, true);
    const out = radialLayout(store.getState());
    expect(out[childId]).toBeUndefined();
  });
});
