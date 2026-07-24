// SPDX-License-Identifier: GPL-3.0-or-later

import type { Renderer } from './renderer.js';
import type { AppState } from './types.js';
import { mapBasename, safeFilename, visibleBounds } from './utils.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Padding around the visible bounds when exporting. */
const EXPORT_PADDING = 32;
/** Pixel ratio for raster export. 2x makes diagonals on retina look right. */
const PNG_SCALE = 2;

/**
 * The CSS properties we copy from the live DOM into inline `style`
 * declarations on the cloned SVG. This is what makes the standalone
 * export render the same colors and fonts the user sees.
 */
const INLINED_PROPS = [
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'font-size',
  'font-weight',
  'font-family'
];

/**
 * Walk the cloned tree alongside the live one and inline computed styles,
 * so the result is fully self-contained without depending on the page's
 * external CSS or CSS custom properties.
 */
function inlineStyles(liveRoot: SVGElement, cloneRoot: SVGElement): void {
  const lives = liveRoot.querySelectorAll<SVGElement>('*');
  const clones = cloneRoot.querySelectorAll<SVGElement>('*');
  for (let i = 0; i < lives.length; i++) {
    const live = lives[i];
    const clone = clones[i];
    if (!live || !clone) continue;
    const cs = window.getComputedStyle(live);
    let style = '';
    for (const prop of INLINED_PROPS) {
      const value = cs.getPropertyValue(prop);
      if (value && value !== 'none' && value !== '') {
        style += `${prop}:${value};`;
      }
    }
    if (style) clone.setAttribute('style', style);
    // Drop var(...) presentation attributes — the inline style covers them
    // and a serialized var() with no surrounding stylesheet would not resolve.
    for (const attr of ['fill', 'stroke']) {
      const v = clone.getAttribute(attr);
      if (v && v.startsWith('var(')) clone.removeAttribute(attr);
    }
  }
}

/**
 * Build a self-contained SVG string of the current map, sized to its
 * bounding box plus padding. Pan/zoom is reset so the export is the
 * full map regardless of how the canvas is currently scrolled.
 *
 * Returns the serialized SVG plus its pixel dimensions for callers that
 * need to set canvas size (PNG export) or page size (PDF export).
 */
export function buildExportSvg(
  state: AppState,
  renderer: Renderer
): { svg: string; widthPx: number; heightPx: number } {
  const bounds = visibleBounds(state);
  const minX = bounds ? bounds.minX - EXPORT_PADDING : -EXPORT_PADDING;
  const minY = bounds ? bounds.minY - EXPORT_PADDING : -EXPORT_PADDING;
  const maxX = bounds ? bounds.maxX + EXPORT_PADDING : EXPORT_PADDING;
  const maxY = bounds ? bounds.maxY + EXPORT_PADDING : EXPORT_PADDING;
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  const live = renderer.getSvg();
  const clone = live.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
  clone.removeAttribute('preserveAspectRatio');

  // Strip the runtime pan/zoom transform — the export is normalized to
  // the world-space bounding box.
  const viewportGroup = clone.querySelector<SVGGElement>('.mf-viewport');
  if (viewportGroup) viewportGroup.removeAttribute('transform');

  inlineStyles(live, clone);

  // Insert a background rect in the page's current background color so
  // the export does not render with a transparent backdrop.
  const bg = window.getComputedStyle(document.body).backgroundColor || '#ffffff';
  const bgRect = document.createElementNS(SVG_NS, 'rect');
  bgRect.setAttribute('x', String(minX));
  bgRect.setAttribute('y', String(minY));
  bgRect.setAttribute('width', String(width));
  bgRect.setAttribute('height', String(height));
  bgRect.setAttribute('fill', bg);
  clone.insertBefore(bgRect, clone.firstChild);

  // Ensure the xmlns attribute is set on the standalone document.
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', SVG_NS);

  const svg = new XMLSerializer().serializeToString(clone);
  return { svg, widthPx: width, heightPx: height };
}

/**
 * Trigger a download of an arbitrary blob with the given filename.
 * Mirrors the pattern used by `downloadAsFile` in serializer.ts.
 */
function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Export the current map as a standalone `.svg` file. */
export function exportSvg(state: AppState, renderer: Renderer, filename = mapBasename(state)): void {
  const { svg } = buildExportSvg(state, renderer);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(`${safeFilename(filename)}.svg`, blob);
}

/** Render the current map to a PNG and trigger a download. */
export function exportPng(state: AppState, renderer: Renderer, filename = mapBasename(state)): Promise<void> {
  const { svg, widthPx, heightPx } = buildExportSvg(state, renderer);
  return new Promise<void>((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(widthPx * PNG_SCALE));
        canvas.height = Math.max(1, Math.round(heightPx * PNG_SCALE));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not obtain 2D context'));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((pngBlob) => {
          URL.revokeObjectURL(url);
          if (!pngBlob) {
            reject(new Error('PNG encoding failed'));
            return;
          }
          downloadBlob(`${safeFilename(filename)}.png`, pngBlob);
          resolve();
        }, 'image/png');
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load SVG into image element'));
    };
    img.src = url;
  });
}

/**
 * Open the browser print dialog with just the map visible. The user
 * picks "Save as PDF" in the dialog. We mount a hidden iframe with
 * print-only CSS, call `print()`, and clean up afterwards.
 */
export function exportPdf(state: AppState, renderer: Renderer): void {
  const { svg } = buildExportSvg(state, renderer);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    return;
  }

  doc.open();
  doc.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${mapBasename(state)} — MindForge export</title>
<style>
  @page { margin: 12mm; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body { display: flex; align-items: center; justify-content: center; }
  svg { max-width: 100%; max-height: 100vh; height: auto; width: auto; }
</style>
</head>
<body>${svg}</body>
</html>`);
  doc.close();

  let cleanedUp = false;
  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  };
  win.addEventListener('afterprint', cleanup);

  // Some browsers (Firefox) need the SVG to be laid out before print.
  // A short delay and an onload guard cover both cases.
  const triggerPrint = (): void => {
    try {
      win.focus();
      win.print();
    } catch {
      cleanup();
      return;
    }
    // Safety net in case afterprint never fires.
    window.setTimeout(cleanup, 60_000);
  };
  if (doc.readyState === 'complete') {
    window.setTimeout(triggerPrint, 50);
  } else {
    iframe.addEventListener('load', () => window.setTimeout(triggerPrint, 50), { once: true });
  }
}
