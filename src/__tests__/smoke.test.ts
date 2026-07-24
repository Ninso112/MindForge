// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

/**
 * Boot smoke test: mounts the real application (main.ts) into a jsdom
 * document that mirrors index.html and exercises a few toolbar actions.
 * Catches wiring regressions (wrong element ids, boot-time exceptions)
 * without needing a browser.
 */

const TOOLBAR_IDS = [
  'tb-maps', 'tb-new', 'tb-add-child', 'tb-add-sibling', 'tb-delete',
  'tb-collapse', 'tb-color', 'tb-note', 'tb-reset', 'tb-fit',
  'tb-export', 'tb-export-png', 'tb-export-pdf', 'tb-export-svg',
  'tb-import', 'tb-theme', 'tb-help'
];

describe('app boot (smoke)', () => {
  it('boots, renders the root node, and toolbar actions work', async () => {
    localStorage.clear();
    const buttons = TOOLBAR_IDS.map((id) => `<button id="${id}" type="button"></button>`).join('');
    document.body.innerHTML = `
      <div id="app"></div>
      <nav class="mf-toolbar">${buttons}</nav>
      <div id="status"></div>
      <div id="help-overlay" class="mf-help">
        <div class="mf-help__panel">
          <button id="help-close" type="button"></button>
          <h2 id="help-title">Keyboard shortcuts</h2>
        </div>
      </div>
    `;

    // main.ts runs main() on import; the module is imported once here.
    await import('../main.js');

    // Canvas + SVG mounted with exactly the root node.
    const svg = document.querySelector('svg.mf-svg');
    expect(svg).not.toBeNull();
    expect(document.querySelectorAll('g.mf-node')).toHaveLength(1);

    // Toolbar: add a child → two nodes, an edge between them.
    document.getElementById('tb-add-child')!.click();
    expect(document.querySelectorAll('g.mf-node')).toHaveLength(2);
    expect(document.querySelectorAll('path.mf-edge')).toHaveLength(1);

    // Toolbar: theme toggle flips the document theme attribute.
    const before = document.documentElement.dataset['theme'];
    document.getElementById('tb-theme')!.click();
    expect(document.documentElement.dataset['theme']).not.toBe(before);

    // Toolbar: delete removes the selected (newly added) node again.
    document.getElementById('tb-delete')!.click();
    expect(document.querySelectorAll('g.mf-node')).toHaveLength(1);

    // The boot created and activated the default map.
    expect(localStorage.getItem('mindforge:maps:active')).not.toBeNull();
    expect(localStorage.getItem('mindforge:maps:index')).toContain('My Map');
  });
});
