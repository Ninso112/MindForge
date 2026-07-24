# MindForge

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![CI](https://github.com/Ninso112/MindForge/actions/workflows/ci.yml/badge.svg)](https://github.com/Ninso112/MindForge/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](tsconfig.json)

A fast, keyboard-driven, open-source mind mapping web application — an alternative to MindMup.


## About

MindForge is a lightweight mind mapping tool that runs entirely in the browser. It is built with vanilla TypeScript, Vite, and SVG — no heavy framework, no runtime dependencies. Maps are rendered as crisp scalable vector graphics, persisted in `localStorage`, and exportable to a portable JSON format (`.mindforge`).

Designed for power users: every action has a keyboard shortcut, and the auto-layout stays out of your way once you start dragging nodes around.

## Features

- Keyboard-first workflow (Tab, Enter, Arrow keys, Delete)
- SVG rendering with bezier-curve connectors
- Radial-tree auto-layout that respects manually pinned positions
- Undo/redo (100 step history)
- Multiple maps in `localStorage` with a map manager, plus JSON import/export
- Per-node notes with an on-canvas indicator
- Label search (`Ctrl+F`) with match highlighting and jump-to-hit
- PNG, PDF, and SVG export of the full map (filenames follow the root label)
- Pan, zoom (10–300%), free-drag interaction, and fit-to-window
- Touch support: drag nodes, one-finger pan, two-finger pinch zoom
- Shift+drag moves a node together with its whole subtree
- Collapsed subtrees show a badge with the hidden descendant count
- Dark and light themes (follows `prefers-color-scheme`, choice persisted)
- Depth-based color cycling, with a 32-color palette for per-node overrides
- Cross-platform (Linux-first, Windows-compatible)
- TypeScript strict mode, no runtime dependencies

## Install

Prerequisites: [Node.js](https://nodejs.org/) 18+ and npm.

```bash
git clone https://github.com/Ninso112/MindForge.git
cd MindForge
npm install
npm run dev
```

Open the URL printed by Vite (typically <http://127.0.0.1:5173>).

### Build

```bash
npm run build
npm run preview
```

The static bundle is written to `dist/` and can be served from any static host.

### Tests

```bash
npm test          # one-shot
npm run test:watch
```

Tests live in `src/__tests__/` and cover the serializer (round-trip + validation), the radial layout, the reactive store (including batching and drag undo), and the multi-map storage layer.

## Usage

Click anywhere to start. The root node is created automatically. Press `?` at any time for the shortcut overlay.

### Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Add child node | `Tab` |
| Add sibling node | `Enter` |
| Collapse/Expand subtree | `Ctrl` + `Enter` |
| Edit selected node | `F2` or double-click |
| Edit note for selected node | `N` |
| Delete node and subtree | `Delete` / `Backspace` |
| Cancel edit / deselect | `Escape` |
| Navigate between nodes | Arrow keys |
| Search nodes | `Ctrl` + `F` (Enter / Shift+Enter cycles) |
| Pan canvas | Middle-click drag or `Space` + drag |
| Move node with subtree | `Shift` + drag |
| Zoom in / out | `Ctrl` + Scroll or `Ctrl` + `+` / `−` |
| Fit map to window | `Ctrl` + `0` |
| Pan / zoom (touch) | One-finger drag / pinch |
| Undo | `Ctrl` + `Z` |
| Redo | `Ctrl` + `Y` (or `Ctrl` + `Shift` + `Z`) |
| Save to localStorage | `Ctrl` + `S` |
| New map (old one is kept) | `Ctrl` + `Shift` + `N` |
| Manage maps | `Maps` toolbar button |
| Export JSON | `Ctrl` + `E` |
| Import JSON | `Ctrl` + `O` |
| Open color picker | `C` |
| Export PNG | `Ctrl` + `Shift` + `P` |
| Export PDF (print dialog) | `Ctrl` + `Shift` + `D` |
| Export SVG | `Ctrl` + `Shift` + `S` |
| Fit map to window | `Fit` toolbar button |
| Toggle theme | (toolbar button) |
| Reset layout | (toolbar button) |
| Show keyboard help | `?` |

### File format

Exports use the `.mindforge` extension and are plain JSON:

```json
{
  "version": "1",
  "nodes": [
    { "id": "root", "label": "Root", "parentId": null, "children": ["..."], "x": 0, "y": 0, "collapsed": false, "pinned": false }
  ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

Nodes may additionally carry optional `color` (hex string) and `note` (free text) fields; both are omitted when unset, and files without them remain valid.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for code style, branching, and PR guidelines.

## License

MindForge is free software, licensed under the [GNU General Public License v3.0 or later](LICENSE).
