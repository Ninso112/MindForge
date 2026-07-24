# Contributing to MindForge

Thanks for your interest in improving MindForge. This document explains how to set up the project, the code style we follow, and the process for submitting changes.

## Code of conduct

Be respectful and constructive. Disagreements are fine; personal attacks are not. Maintainers may close threads or revoke contributor status if discussions become unproductive.

## Getting started

```bash
git clone https://github.com/Ninso112/MindForge.git
cd MindForge
npm install
npm run dev
```

The dev server runs on `http://127.0.0.1:5173` by default. Vite auto-reloads on file changes.

To produce a production build and test it:

```bash
npm run build
npm run preview
```

## Project layout

```
src/
├── main.ts        # bootstrap + toolbar/event wiring
├── types.ts       # core interfaces
├── state.ts       # reactive store + undo/redo
├── renderer.ts    # SVG rendering
├── input.ts       # keyboard/pointer (mouse/touch) handlers
├── layout.ts      # radial auto-layout
├── serializer.ts  # JSON import/export + theme preference
├── export.ts      # PNG/PDF/SVG export
├── maps.ts        # multi-map localStorage layer
├── mapsPanel.ts   # "My maps" panel UI
├── search.ts      # Ctrl+F label search
├── noteEditor.ts  # per-node note panel
├── colorPicker.ts # color popover
├── colors.ts      # 32-color palette
├── utils.ts       # shared helpers (geometry, filenames, visibility)
├── style.css      # theme variables and global styles
└── __tests__/     # vitest suites
```

Keep modules focused. If a file starts mixing concerns (e.g. rendering and state mutation), split it.

## Code style

- TypeScript strict mode is enabled. Do not use `any`. Reach for `unknown` and narrow.
- Every exported function gets a JSDoc block describing its purpose, params, and return value.
- All source files start with an SPDX license header:

  ```ts
  // SPDX-License-Identifier: GPL-3.0-or-later
  ```

- 2-space indent, LF line endings, UTF-8. The repo `.editorconfig` enforces this.
- Run `npm run lint` before opening a PR. ESLint rules must pass with no warnings.
- Prefer pure functions and immutable updates in the state layer. Side effects belong in `main.ts`, `input.ts`, and `renderer.ts`.
- No external runtime dependencies. Vite and TypeScript are dev-only. Discuss any proposed dependency in an issue first.
- Cross-platform: paths and shell commands must work on both Linux and Windows. No hardcoded `/tmp` or `/usr/local`.

## Commit messages

Use present-tense, imperative mood. Keep the subject under 72 characters. Reference issues with `#nnn` when relevant.

```
Add radial layout fallback when root has zero children

Fixes #42.
```

Group logically related changes into a single commit. Avoid drive-by formatting changes in feature commits.

## Pull requests

1. Fork the repo and create a feature branch from `main`.
2. Make your changes on the branch. Keep PRs focused; one topic per PR.
3. Verify locally:
   - `npm run lint`
   - `npm run build`
   - `npm test`
   - Manual smoke test in the browser (add/edit/delete nodes, undo/redo, export/import).
4. Open the PR with a clear description of what changed and why. Include screenshots or a short clip for UI changes.
5. Address review feedback by adding new commits; squash on merge.

## Reporting bugs

Open an issue with:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Browser, OS, and MindForge version (or commit hash)

If the bug involves a specific map, attach the exported `.mindforge` file.

## Licensing

By contributing, you agree that your contributions will be licensed under the GNU General Public License v3.0 or later, the same license as the project.
