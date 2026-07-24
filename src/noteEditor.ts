// SPDX-License-Identifier: GPL-3.0-or-later

import type { Store } from './state.js';

/**
 * A single note editor can be open at a time. Tracked module-locally so
 * a second `openNoteEditor` call cleanly closes the previous panel.
 */
let activeEditor: { close: (save: boolean) => void } | null = null;

/**
 * Open the note editor for a node: a small fixed panel with a textarea.
 * Saves on blur or Ctrl+Enter; Escape cancels and restores the previous
 * note. Selecting another node saves and closes the editor (via a store
 * subscription), mirroring the color picker's lifecycle. Saving goes
 * through `Store.setNodeNote`, so it is undoable.
 */
export function openNoteEditor(host: HTMLElement, store: Store, nodeId: string): void {
  closeNoteEditor(true);

  const node = store.getState().nodes[nodeId];
  if (!node) return;

  const panel = document.createElement('div');
  panel.className = 'mf-note';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Edit node note');

  const title = document.createElement('div');
  title.className = 'mf-note__title';
  title.textContent = node.label.trim().length > 0 ? node.label : '(no label)';

  const textarea = document.createElement('textarea');
  textarea.className = 'mf-note__input';
  textarea.placeholder = 'Add a note…';
  textarea.value = node.note ?? '';
  textarea.spellcheck = true;
  textarea.rows = 6;

  const hint = document.createElement('div');
  hint.className = 'mf-note__hint';
  hint.textContent = 'Ctrl+Enter saves · Esc cancels';

  panel.appendChild(title);
  panel.appendChild(textarea);
  panel.appendChild(hint);
  host.appendChild(panel);

  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  // Save + close when the user selects a different node.
  const unsubscribe = store.subscribe((state) => {
    if (state.selectedId !== nodeId) close(true);
  });

  textarea.addEventListener('keydown', (e) => {
    // Keep global canvas shortcuts quiet while typing the note.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close(false);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      close(true);
    }
  });
  textarea.addEventListener('blur', () => close(true));

  function close(save: boolean): void {
    if (save) store.setNodeNote(nodeId, textarea.value);
    unsubscribe();
    if (panel.parentNode) panel.parentNode.removeChild(panel);
    if (activeEditor?.close === close) activeEditor = null;
  }

  activeEditor = { close };
}

/**
 * Close any currently open note editor. `save` controls whether the
 * typed text is committed. Safe to call when none is open.
 */
export function closeNoteEditor(save: boolean): void {
  activeEditor?.close(save);
}
