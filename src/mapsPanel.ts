// SPDX-License-Identifier: GPL-3.0-or-later

import type { MapMeta } from './maps.js';
import { listMaps } from './maps.js';

/**
 * The "My maps" panel: lists all locally stored maps with open/rename/
 * delete actions and a "new map" button. Actions are delegated to
 * `main.ts` via window events (`mindforge:switch-map`,
 * `mindforge:rename-map`, `mindforge:delete-map`, `mindforge:new-map`);
 * the panel refreshes itself whenever `mindforge:maps-changed` fires.
 */
export class MapsPanel {
  private readonly overlay: HTMLDivElement;
  private readonly listEl: HTMLUListElement;
  private readonly getActiveId: () => string;

  constructor(host: HTMLElement, getActiveId: () => string) {
    this.getActiveId = getActiveId;

    this.overlay = document.createElement('div');
    this.overlay.className = 'mf-maps';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-label', 'My maps');

    const panel = document.createElement('div');
    panel.className = 'mf-maps__panel';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'mf-maps__close';
    closeBtn.setAttribute('aria-label', 'Close maps panel');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => this.close());

    const title = document.createElement('h2');
    title.textContent = 'My maps';

    this.listEl = document.createElement('ul');
    this.listEl.className = 'mf-maps__list';

    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'mf-maps__new';
    newBtn.textContent = '+ New map';
    newBtn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('mindforge:new-map'));
    });

    panel.appendChild(closeBtn);
    panel.appendChild(title);
    panel.appendChild(this.listEl);
    panel.appendChild(newBtn);
    this.overlay.appendChild(panel);
    this.overlay.hidden = true;
    host.appendChild(this.overlay);

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    // Capture phase so the global Escape (deselect) does not also run.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.overlay.hidden) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    }, true);
    window.addEventListener('mindforge:maps-changed', () => this.refresh());
  }

  /** Open the panel and render the current map list. */
  open(): void {
    this.overlay.hidden = false;
    this.refresh();
  }

  /** Hide the panel. */
  close(): void {
    this.overlay.hidden = true;
  }

  /** Rebuild the list from storage (no-op while closed). */
  private refresh(): void {
    if (this.overlay.hidden) return;
    const activeId = this.getActiveId();
    this.listEl.textContent = '';
    const maps = listMaps();
    if (maps.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'mf-maps__empty';
      empty.textContent = 'No maps yet.';
      this.listEl.appendChild(empty);
      return;
    }
    for (const meta of maps) {
      this.listEl.appendChild(this.buildItem(meta, meta.id === activeId));
    }
  }

  private buildItem(meta: MapMeta, isActive: boolean): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'mf-maps__item';
    if (isActive) li.classList.add('mf-maps__item--active');

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'mf-maps__open';
    openBtn.textContent = meta.name;
    const date = document.createElement('span');
    date.className = 'mf-maps__date';
    date.textContent = new Date(meta.updatedAt).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
    openBtn.appendChild(date);
    openBtn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('mindforge:switch-map', { detail: { id: meta.id } }));
      this.close();
    });

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'mf-maps__action';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', () => {
      const name = window.prompt('Rename map:', meta.name);
      if (name !== null && name.trim().length > 0) {
        window.dispatchEvent(
          new CustomEvent('mindforge:rename-map', { detail: { id: meta.id, name: name.trim() } })
        );
      }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'mf-maps__action mf-maps__action--danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      if (window.confirm(`Delete map "${meta.name}" permanently?`)) {
        window.dispatchEvent(new CustomEvent('mindforge:delete-map', { detail: { id: meta.id } }));
      }
    });

    li.appendChild(openBtn);
    li.appendChild(renameBtn);
    li.appendChild(deleteBtn);
    return li;
  }
}
