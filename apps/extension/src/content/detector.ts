/**
 * Element detection — finds and characterises DOM elements under the cursor.
 */
import type { Rect, BoxModel, BoxModelValues, CornerRadius, CornerRadii } from '@raval/shared';
import { domRectToRect, parsePx, isRavalElement } from './utils';

const HIT_MEMO_MS = 100;
let memo: { x: number; y: number; sx: number; sy: number; t: number; el: Element | null } | null = null;

/** Get the deepest non-Raval element at the given viewport coordinates */
export function getElementAtPoint(x: number, y: number): Element | null {
  // Pointer rarely moves between consecutive frames — reuse the last answer briefly.
  const now = performance.now();
  if (
    memo && memo.x === x && memo.y === y &&
    memo.sx === window.scrollX && memo.sy === window.scrollY &&
    now - memo.t < HIT_MEMO_MS && (memo.el === null || memo.el.isConnected)
  ) {
    return memo.el;
  }

  // The overlay is normally click-through already. Only toggle pointer-events
  // (a style write that forces a recalc) in the rare case the canvas is interactive.
  const canvas = document.getElementById('raval-canvas-overlay');
  const prev = canvas?.style.pointerEvents ?? '';
  const mustToggle = canvas !== null && prev !== 'none';
  if (mustToggle) canvas.style.pointerEvents = 'none';

  const hit = document.elementFromPoint(x, y);

  if (mustToggle) canvas.style.pointerEvents = prev;

  const el = !hit || isRavalElement(hit) ? null : hit;
  memo = { x, y, sx: window.scrollX, sy: window.scrollY, t: now, el };
  return el;
}

/** Get the viewport-relative bounding rect of an element */
export function getElementRect(el: Element): Rect {
  return domRectToRect(el.getBoundingClientRect());
}

/** Parse computed box model values for an element */
export function getBoxModel(el: Element): BoxModel {
  const style = window.getComputedStyle(el);
  const contentRect = el.getBoundingClientRect();

  const padding: BoxModelValues = {
    top: parsePx(style.paddingTop),
    right: parsePx(style.paddingRight),
    bottom: parsePx(style.paddingBottom),
    left: parsePx(style.paddingLeft),
  };

  const border: BoxModelValues = {
    top: parsePx(style.borderTopWidth),
    right: parsePx(style.borderRightWidth),
    bottom: parsePx(style.borderBottomWidth),
    left: parsePx(style.borderLeftWidth),
  };

  const margin: BoxModelValues = {
    top: parsePx(style.marginTop),
    right: parsePx(style.marginRight),
    bottom: parsePx(style.marginBottom),
    left: parsePx(style.marginLeft),
  };

  // Content box is the full bounding rect (includes padding + border)
  const content: Rect = domRectToRect(contentRect);

  return { content, padding, border, margin };
}

/** Resolve one computed corner value ("8px", "8px 16px", "50%") against the element's box. */
function parseCorner(value: string, width: number, height: number): CornerRadius {
  const [h = '0', v = h] = value.trim().split(/\s+/);
  const resolve = (part: string, size: number): number =>
    Math.max(0, part.endsWith('%') ? (parseFloat(part) / 100) * size : parsePx(part));
  return { x: resolve(h, width), y: resolve(v, height) };
}

/**
 * Corner radii as rendered: percentages resolved, oversized values scaled down
 * the way the browser does it (so a 9999px pill reports half its height), and
 * CSS scale transforms applied. Null when every corner is square.
 */
export function getCornerRadii(el: Element): CornerRadii | null {
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  // Radii are laid out against the untransformed border box.
  const width = el instanceof HTMLElement && el.offsetWidth > 0 ? el.offsetWidth : rect.width;
  const height = el instanceof HTMLElement && el.offsetHeight > 0 ? el.offsetHeight : rect.height;
  if (width === 0 || height === 0) return null;

  const tl = parseCorner(style.borderTopLeftRadius, width, height);
  const tr = parseCorner(style.borderTopRightRadius, width, height);
  const br = parseCorner(style.borderBottomRightRadius, width, height);
  const bl = parseCorner(style.borderBottomLeftRadius, width, height);
  const corners = [tl, tr, br, bl];
  if (corners.every((c) => c.x === 0 || c.y === 0)) return null;

  // Adjacent corners may not overlap: shrink them all by the tightest side.
  const fit = (size: number, a: number, b: number): number => (a + b > size ? size / (a + b) : 1);
  const f = Math.min(
    fit(width, tl.x, tr.x), fit(width, bl.x, br.x),
    fit(height, tl.y, bl.y), fit(height, tr.y, br.y),
  );
  const sx = (rect.width / width) * f;
  const sy = (rect.height / height) * f;
  // A corner with one zero axis is square.
  const used = (c: CornerRadius): CornerRadius => (c.x === 0 || c.y === 0 ? { x: 0, y: 0 } : { x: c.x * sx, y: c.y * sy });

  return { topLeft: used(tl), topRight: used(tr), bottomRight: used(br), bottomLeft: used(bl) };
}
