# MindForge

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Build](https://img.shields.io/badge/build-pending-lightgrey.svg)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](tsconfig.json)

A fast, keyboard-driven, open-source mind mapping web application — an alternative to MindMup.

## About

MindForge is a lightweight mind mapping tool that runs entirely in the browser. It is built with vanilla TypeScript, Vite, and SVG — no heavy framework, no runtime dependencies. Maps are rendered as crisp scalable vector graphics, persisted in `localStorage`, and exportable to a portable JSON format (`.mindforge`).

Designed for power users: every action has a keyboard shortcut, and the auto-layout stays out of your way once you start dragging nodes around.

## Features

- Keyboard-first workflow (Tab, Enter, Arrow keys, Delete)
- SVG rendering with bezier-curve connectors
- Radial-tree auto-layout that respects manually pinned positions
- Undo/redo (50 step history)
- Auto-save to `localStorage` plus JSON import/export
- PNG, PDF, and SVG export of the full map
- Pan, zoom (10–300%), and free-drag interaction
- Dark and light themes (follows `prefers-color-scheme`)
- Depth-based color cycling, with a 32-color palette for per-node overrides
- Cross-platform (Linux-first, Windows-compatible)
- TypeScript strict mode, no runtime dependencies

## Install

Prerequisites: [Node.js](https://nodejs.org/) 18+ and npm.

```bash
git clone https://github.com/your-org/mindforge.git
cd mindforge
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

## Usage

Click anywhere to start. The root node is created automatically. Press `?` at any time for the shortcut overlay.

### Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Add child node | `Tab` |
| Add sibling node | `Enter` |
| Edit selected node | `F2` or double-click |
| Delete node and subtree | `Delete` / `Backspace` |
| Cancel edit / deselect | `Escape` |
| Navigate between nodes | Arrow keys |
| Pan canvas | Middle-click drag or `Space` + drag |
| Zoom in / out | `Ctrl` + Scroll |
| Undo | `Ctrl` + `Z` |
| Redo | `Ctrl` + `Y` (or `Ctrl` + `Shift` + `Z`) |
| Save to localStorage | `Ctrl` + `S` |
| Export JSON | `Ctrl` + `E` |
| Import JSON | `Ctrl` + `O` |
| Open color picker | `C` |
| Export PNG | `Ctrl` + `Shift` + `P` |
| Export PDF (print dialog) | `Ctrl` + `Shift` + `D` |
| Export SVG | `Ctrl` + `Shift` + `S` |
| Toggle theme | (toolbar button) |
| Reset layout | (toolbar button) |
| Show keyboard help | `?` |

### File format

Exports use the `.mindforge` extension and are plain JSON:

```json
{
  "version": "1",
  "nodes": [
    { "id": "root", "label": "Root", "parentId": null, "children": ["..."], "x": 0, "y": 0, "collapsed": false }
  ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for code style, branching, and PR guidelines.

## License

MindForge is free software, licensed under the [GNU General Public License v3.0 or later](LICENSE).
