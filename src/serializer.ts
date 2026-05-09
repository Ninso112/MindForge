// SPDX-License-Identifier: GPL-3.0-or-later

import type { AppState, MindNode, SerializedMap } from './types.js';

const STORAGE_KEY = 'mindforge:autosave';
const FILE_EXTENSION = '.mindforge';

/** Numeric clamp helper. */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Convert the in-memory app state into the on-disk JSON shape.
 * Selection and editing state are intentionally not serialized.
 */
export function serialize(state: AppState): SerializedMap {
  return {
    version: '1',
    nodes: Object.values(state.nodes),
    rootId: state.rootId,
    viewport: { ...state.viewport }
  };
}

/**
 * Validate and convert a parsed JSON object back into an `AppState`.
 * Throws on malformed input. Preserves theme from the current state
 * since the file format does not include it.
 */
export function deserialize(raw: unknown, currentTheme: 'light' | 'dark'): AppState {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid map file: not a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  if (obj['version'] !== '1') {
    throw new Error(`Unsupported map version: ${String(obj['version'])}`);
  }
  if (!Array.isArray(obj['nodes'])) {
    throw new Error('Invalid map file: missing "nodes" array');
  }
  if (typeof obj['rootId'] !== 'string') {
    throw new Error('Invalid map file: missing "rootId"');
  }
  const nodes: Record<string, MindNode> = {};
  for (const n of obj['nodes'] as unknown[]) {
    const node = validateNode(n);
    if (nodes[node.id]) {
      throw new Error(`Invalid map file: duplicate node id ${node.id}`);
    }
    nodes[node.id] = node;
  }
  const rootId = obj['rootId'];
  validateGraph(nodes, rootId);
  const vp = obj['viewport'] as Record<string, unknown> | undefined;
  const rawZoom = typeof vp?.['zoom'] === 'number' ? vp['zoom'] : 1;
  return {
    nodes,
    rootId,
    selectedId: rootId,
    editingId: null,
    viewport: {
      x: typeof vp?.['x'] === 'number' && Number.isFinite(vp['x']) ? vp['x'] : 0,
      y: typeof vp?.['y'] === 'number' && Number.isFinite(vp['y']) ? vp['y'] : 0,
      zoom: clamp(rawZoom, 0.1, 3.0)
    },
    theme: currentTheme
  };
}

/**
 * Reject malformed graphs that would otherwise crash the renderer or
 * layout (cycles cause unbounded recursion in `depthOf`/`radialLayout`,
 * dangling references silently drop data). Walks the parent chain from
 * every node and bails when the hop count exceeds the node count.
 */
function validateGraph(nodes: Record<string, MindNode>, rootId: string): void {
  const root = nodes[rootId];
  if (!root) {
    throw new Error('Invalid map file: rootId does not refer to any node');
  }
  if (root.parentId !== null) {
    throw new Error('Invalid map file: root must have parentId === null');
  }
  const total = Object.keys(nodes).length;
  for (const node of Object.values(nodes)) {
    for (const childId of node.children) {
      const child = nodes[childId];
      if (!child) {
        throw new Error(`Invalid map file: node ${node.id} references missing child ${childId}`);
      }
      if (child.parentId !== node.id) {
        throw new Error(`Invalid map file: child ${childId} parentId does not match parent ${node.id}`);
      }
    }
    if (node.id === rootId) continue;
    if (node.parentId === null) {
      throw new Error(`Invalid map file: non-root node ${node.id} has null parentId`);
    }
    const parent = nodes[node.parentId];
    if (!parent) {
      throw new Error(`Invalid map file: node ${node.id} parentId ${node.parentId} does not exist`);
    }
    if (!parent.children.includes(node.id)) {
      throw new Error(`Invalid map file: node ${node.id} not listed in parent ${node.parentId} children`);
    }
    let cur: string | null = node.parentId;
    let hops = 0;
    while (cur !== null) {
      if (hops > total) {
        throw new Error(`Invalid map file: cycle detected reaching from ${node.id}`);
      }
      const ancestor: MindNode | undefined = nodes[cur];
      if (!ancestor) {
        throw new Error(`Invalid map file: node ${node.id} ancestor ${cur} does not exist`);
      }
      cur = ancestor.parentId;
      hops++;
    }
  }
}

/**
 * Type-guard a single node payload. Throws on malformed input.
 */
function validateNode(raw: unknown): MindNode {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid node entry');
  }
  const n = raw as Record<string, unknown>;
  if (typeof n['id'] !== 'string') throw new Error('Node missing id');
  if (typeof n['label'] !== 'string') throw new Error(`Node ${String(n['id'])} missing label`);
  if (n['parentId'] !== null && typeof n['parentId'] !== 'string') {
    throw new Error(`Node ${String(n['id'])} has invalid parentId`);
  }
  if (!Array.isArray(n['children']) || !n['children'].every((c) => typeof c === 'string')) {
    throw new Error(`Node ${String(n['id'])} has invalid children array`);
  }
  if (typeof n['x'] !== 'number' || typeof n['y'] !== 'number' || !Number.isFinite(n['x']) || !Number.isFinite(n['y'])) {
    throw new Error(`Node ${String(n['id'])} has invalid coordinates`);
  }
  const node: MindNode = {
    id: n['id'],
    label: n['label'],
    parentId: n['parentId'] as string | null,
    children: n['children'] as string[],
    x: n['x'],
    y: n['y'],
    collapsed: typeof n['collapsed'] === 'boolean' ? n['collapsed'] : false,
    pinned: typeof n['pinned'] === 'boolean' ? n['pinned'] : false
  };
  if (typeof n['color'] === 'string') node.color = n['color'];
  return node;
}

/**
 * Persist the current state to `localStorage`. Returns `true` on success,
 * `false` when the write fails (e.g. `QuotaExceededError`, private-mode
 * restrictions). Callers can surface a UI warning on `false` so the user
 * knows their autosave was lost.
 */
export function saveToLocalStorage(state: AppState): boolean {
  try {
    const data = JSON.stringify(serialize(state));
    localStorage.setItem(STORAGE_KEY, data);
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('MindForge: localStorage save failed', err);
    return false;
  }
}

/**
 * Read the previous session from `localStorage`, if any.
 * Returns `null` when no autosave exists or it cannot be parsed.
 */
export function loadFromLocalStorage(currentTheme: 'light' | 'dark'): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    return deserialize(JSON.parse(raw), currentTheme);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('MindForge: localStorage load failed', err);
    return null;
  }
}

/**
 * Trigger a browser download of the serialized map. The filename
 * is sanitized so it works on Linux, Windows, and macOS.
 */
export function downloadAsFile(state: AppState, filename = 'mindmap'): void {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, '_') || 'mindmap';
  const data = JSON.stringify(serialize(state), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safe}${FILE_EXTENSION}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer the revoke so Firefox finishes the download trigger first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Open a file picker, parse the chosen file, and resolve to a fresh
 * `AppState`. Rejects if the user cancels or the file is malformed.
 */
export function openFromFile(currentTheme: 'light' | 'dark'): Promise<AppState> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mindforge,application/json,.json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const result = reader.result;
          const text = typeof result === 'string' ? result : '';
          const parsed = JSON.parse(text);
          resolve(deserialize(parsed, currentTheme));
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
      reader.readAsText(file);
    });
    input.click();
  });
}
