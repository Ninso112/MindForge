// SPDX-License-Identifier: GPL-3.0-or-later

import type { Renderer } from './renderer.js';
import type { Store } from './state.js';
import { COLOR_PALETTE } from './colors.js';

/**
 * A single picker can be open at a time. We track it module-locally so a
 * second `openColorPicker` call cleanly closes the previous popover.
 */
let activePicker: { close: () => void } | null = null;

/**
 * Open the color-picker popover for the given node. The popover anchors
 * itself to the on-screen rect of the node and follows the same lifecycle
 * as the inline editor: closes on outside click, `Escape`, or selection
 * change. Choosing a color (or "Default") commits via `Store.setNodeColor`
 * which records an undo entry.
 */
export function openColorPicker(
  host: HTMLElement,
  renderer: Renderer,
  store: Store,
  nodeId: string
): void {
  closeActivePicker();

  const node = store.getState().nodes[nodeId];
  if (!node) return;

  const popover = document.createElement('div');
  popover.className = 'mf-color-picker';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Choose node color');

  const grid = document.createElement('div');
  grid.className = 'mf-color-picker__grid';
  for (const hex of COLOR_PALETTE) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'mf-color-picker__swatch';
    swatch.style.backgroundColor = hex;
    swatch.setAttribute('aria-label', `Color ${hex}`);
    swatch.title = hex;
    if (node.color && node.color.toLowerCase() === hex.toLowerCase()) {
      swatch.classList.add('mf-color-picker__swatch--active');
    }
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      store.setNodeColor(nodeId, hex);
      close();
    });
    grid.appendChild(swatch);
  }
  popover.appendChild(grid);

  const defaultBtn = document.createElement('button');
  defaultBtn.type = 'button';
  defaultBtn.className = 'mf-color-picker__default';
  defaultBtn.textContent = 'Default (depth color)';
  defaultBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    store.setNodeColor(nodeId, null);
    close();
  });
  popover.appendChild(defaultBtn);

  host.appendChild(popover);
  position(popover, host, renderer, store, nodeId);

  // Outside click closes.
  const onDocPointerDown = (e: MouseEvent): void => {
    if (e.target instanceof Node && popover.contains(e.target)) return;
    close();
  };
  // Escape closes. Listen in capture so the global key handler does not
  // run a deselect first.
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  // Re-position if the window resizes while the picker is open.
  const onResize = (): void => position(popover, host, renderer, store, nodeId);
  // Close when the user selects a different node (or clears selection).
  const unsubscribe = store.subscribe((state) => {
    if (state.selectedId !== nodeId) close();
  });

  // Defer attaching the outside-click handler to the next tick so the
  // mousedown that triggered the open does not immediately close it.
  window.setTimeout(() => {
    document.addEventListener('mousedown', onDocPointerDown, true);
  }, 0);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', onResize);

  function close(): void {
    if (activePicker?.close !== close) return;
    document.removeEventListener('mousedown', onDocPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', onResize);
    unsubscribe();
    if (popover.parentNode) popover.parentNode.removeChild(popover);
    activePicker = null;
  }

  activePicker = { close };
}

/**
 * Close any currently open picker. Safe to call when none is open.
 */
export function closeActivePicker(): void {
  activePicker?.close();
}

/**
 * Position the popover under (or above) the node, clamped to the host
 * element so it never spills off-screen.
 */
function position(
  popover: HTMLElement,
  host: HTMLElement,
  renderer: Renderer,
  store: Store,
  nodeId: string
): void {
  const rect = renderer.getNodeScreenRect(store.getState(), nodeId);
  const hostRect = host.getBoundingClientRect();
  const pop = popover.getBoundingClientRect();
  const margin = 8;

  if (!rect) {
    popover.style.left = `${margin}px`;
    popover.style.top = `${margin}px`;
    return;
  }

  // Prefer below the node; flip above if there is no room.
  let top = rect.bottom - hostRect.top + margin;
  if (top + pop.height > hostRect.height - margin) {
    const above = rect.top - hostRect.top - pop.height - margin;
    if (above >= margin) top = above;
  }

  // Center horizontally on the node, clamp to host.
  const nodeCenterX = rect.left + rect.width / 2 - hostRect.left;
  let left = nodeCenterX - pop.width / 2;
  left = Math.max(margin, Math.min(left, hostRect.width - pop.width - margin));

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}
