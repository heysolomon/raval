/**
 * Geometry helpers, formatting, and shared utilities for the content script.
 */
import type { Rect, CornerRadius, CornerRadii } from '@raval/shared';

// ─── Geometry ─────────────────────────────────────────────────────────────────

export function domRectToRect(r: DOMRect): Rect {
  return {
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    left: r.left,
  };
}

/** Expand a rect by the given offsets (to include margin, etc.) */
export function expandRect(rect: Rect, top: number, right: number, bottom: number, left: number): Rect {
  return {
    x: rect.x - left,
    y: rect.y - top,
    width: rect.width + left + right,
    height: rect.height + top + bottom,
    top: rect.top - top,
    right: rect.right + right,
    bottom: rect.bottom + bottom,
    left: rect.left - left,
  };
}

/** Calculate the gap between two rects (negative = overlap) */
export function gapBetweenRects(
  a: Rect,
  b: Rect,
): { horizontal: number; vertical: number; closestEdges: [string, string] } {
  const hGap = Math.max(a.left - b.right, b.left - a.right, 0);
  const vGap = Math.max(a.top - b.bottom, b.top - a.bottom, 0);

  // Determine which pair of edges is closest
  const leftToRight = Math.abs(a.left - b.right);
  const rightToLeft = Math.abs(a.right - b.left);
  const topToBottom = Math.abs(a.top - b.bottom);
  const bottomToTop = Math.abs(a.bottom - b.top);

  const minH = Math.min(leftToRight, rightToLeft);
  const minV = Math.min(topToBottom, bottomToTop);

  let closestEdges: [string, string];
  if (hGap > 0 && hGap >= vGap) {
    closestEdges = leftToRight < rightToLeft ? ['left', 'right'] : ['right', 'left'];
  } else if (vGap > 0) {
    closestEdges = topToBottom < bottomToTop ? ['top', 'bottom'] : ['bottom', 'top'];
  } else {
    // Overlapping — pick smallest edge distance
    if (minH <= minV) {
      closestEdges = leftToRight < rightToLeft ? ['left', 'right'] : ['right', 'left'];
    } else {
      closestEdges = topToBottom < bottomToTop ? ['top', 'bottom'] : ['bottom', 'top'];
    }
  }

  return { horizontal: hGap, vertical: vGap, closestEdges };
}

/** Get the distance between two rects along their closest edges */
export function distanceBetweenRects(a: Rect, b: Rect): { distance: number; direction: 'horizontal' | 'vertical' } {
  const { horizontal, vertical, closestEdges } = gapBetweenRects(a, b);
  const direction = closestEdges[0] === 'left' || closestEdges[0] === 'right' ? 'horizontal' : 'vertical';
  const distance = direction === 'horizontal' ? horizontal : vertical;
  return { distance, direction };
}

/** Clamp a value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Linear interpolation */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/** Format dimensions as "W × H" */
export function formatDimensions(width: number, height: number): string {
  return `${Math.round(width)} × ${Math.round(height)}`;
}

/** Format rendered corner radii the way the shorthand reads: "R 8", "R 8 8 0 0", "R 160/24" */
export function formatRadii(radii: CornerRadii): string {
  const one = (c: CornerRadius): string => {
    const x = Math.round(c.x); const y = Math.round(c.y);
    return x === y ? String(x) : `${x}/${y}`;
  };
  const [tl, tr, br, bl] = [radii.topLeft, radii.topRight, radii.bottomRight, radii.bottomLeft].map(one);
  if (tl === tr && tr === br && br === bl) return `R ${tl}`;
  if (tl === br && tr === bl) return `R ${tl} ${tr}`;
  if (tr === bl) return `R ${tl} ${tr} ${br}`;
  return `R ${tl} ${tr} ${br} ${bl}`;
}

/** Format a pixel distance */
export function formatDistance(px: number): string {
  return `${Math.round(px)}px`;
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

/** Generate a unique ID */
export function uid(): string {
  return `raval-${Math.random().toString(36).slice(2, 9)}`;
}

/** Check if an element is part of any Raval UI (panel, overlay, sub-panels, Excalidraw) */
export function isRavalElement(el: Element | null): boolean {
  if (!el) return false;
  if (el.id?.startsWith('raval-')) return true;
  if (el.closest('[id^="raval-"]')) return true;
  return false;
}

/** Write text to clipboard */
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

/** Parse a CSS pixel value like "12px" → 12 */
export function parsePx(value: string): number {
  return parseFloat(value) || 0;
}

// ─── Page ↔ viewport coordinates ─────────────────────────────────────────────

/** Convert a viewport X to document (page) space */
export function toPageX(clientX: number): number {
  return clientX + window.scrollX;
}

/** Convert a viewport Y to document (page) space */
export function toPageY(clientY: number): number {
  return clientY + window.scrollY;
}

/** Convert a document X to viewport space */
export function toViewX(pageX: number): number {
  return pageX - window.scrollX;
}

/** Convert a document Y to viewport space */
export function toViewY(pageY: number): number {
  return pageY - window.scrollY;
}
