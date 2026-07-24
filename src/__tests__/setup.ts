// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Vitest setup: provide an in-memory `localStorage` when the runtime
 * lacks a working one. Node ≥ 25 reserves the `localStorage` global
 * but leaves it unavailable unless started with `--localstorage-file`,
 * which shadows jsdom's own implementation in the test environment.
 * Production code (real browsers) is unaffected.
 */
class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

/** Probe whether the current global localStorage actually works. */
function localStorageWorks(): boolean {
  try {
    globalThis.localStorage.setItem('__probe__', '1');
    const ok = globalThis.localStorage.getItem('__probe__') === '1';
    globalThis.localStorage.removeItem('__probe__');
    return ok;
  } catch {
    return false;
  }
}

if (!localStorageWorks()) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true
  });
}

/**
 * jsdom does not implement `matchMedia`; stub it so the boot code's
 * `prefers-color-scheme` probe works (always reports "dark").
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  const stub = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false
  });
  Object.defineProperty(window, 'matchMedia', { value: stub, configurable: true, writable: true });
}
