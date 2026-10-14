/**
 * Spacing overlay for Inspect, shown on the clicked element — the space it takes up beyond its own
 * box, drawn the way browser dev tools draw it: padding inside the border,
 * margin outside it, and for a flex or grid container the gaps between its
 * children. Each band carries its size in px.
 */
import type { BoxModelValues, Rect } from '@raval/shared';
import { getBoxModel } from './detector';
import { domRectToRect } from './utils';

interface Band { x: number; y: number; w: number; h: number; value: number; labelled: boolean }

export interface Spacing {
  /** Outer edge of the margin, the border box, the padding box, and the content box. */
  margin: Rect;
  border: Rect;
  padding: Rect;
  content: Rect;
  marginValues: BoxModelValues;
  paddingValues: BoxModelValues;
  gaps: Band[];
}

/** Fixed, not the mark colour: the three kinds of space have to stay tellable apart. */
const PADDING_RGB = '22, 163, 74';
const MARGIN_RGB = '217, 119, 6';
const GAP_RGB = '124, 58, 237';

/** Beyond this a container's children are not compared pair by pair. */
const MAX_CHILDREN = 60;
/** With more gaps than this, only the first of each size is labelled. */
const MAX_GAP_LABELS = 12;

function shrink(r: Rect, by: BoxModelValues, sx: number, sy: number): Rect {
  const left = r.left + by.left * sx;
  const top = r.top + by.top * sy;
  const right = Math.max(left, r.right - by.right * sx);
  const bottom = Math.max(top, r.bottom - by.bottom * sy);
  return { x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top };
}

/** Negative margins pull the element, they do not take up space; they are shown as none. */
function positive(v: BoxModelValues): BoxModelValues {
  return { top: Math.max(0, v.top), right: Math.max(0, v.right), bottom: Math.max(0, v.bottom), left: Math.max(0, v.left) };
}

/** Space between the children of a flex or grid container: each child to its nearest neighbour right and below. */
function readGaps(el: Element): Band[] {
  if (!/flex|grid/.test(window.getComputedStyle(el).display)) return [];
  if (el.children.length < 2 || el.children.length > MAX_CHILDREN) return [];

  const rects: DOMRect[] = [];
  for (const child of el.children) {
    const r = child.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    // Children taken out of the flow are not spaced by the container.
    if (/absolute|fixed/.test(window.getComputedStyle(child).position)) continue;
    rects.push(r);
  }

  const bands: Band[] = [];
  for (const a of rects) {
    let right: DOMRect | null = null;
    let below: DOMRect | null = null;
    for (const b of rects) {
      if (b === a) continue;
      const sharesRow = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      const sharesColumn = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1;
      if (sharesRow && b.left >= a.right - 0.5 && (!right || b.left < right.left)) right = b;
      if (sharesColumn && b.top >= a.bottom - 0.5 && (!below || b.top < below.top)) below = b;
    }
    if (right && right.left - a.right >= 1) {
      const top = Math.max(a.top, right.top);
      bands.push({ x: a.right, y: top, w: right.left - a.right, h: Math.min(a.bottom, right.bottom) - top, value: right.left - a.right, labelled: true });
    }
    if (below && below.top - a.bottom >= 1) {
      const left = Math.max(a.left, below.left);
      bands.push({ x: left, y: a.bottom, w: Math.min(a.right, below.right) - left, h: below.top - a.bottom, value: below.top - a.bottom, labelled: true });
    }
  }

  // A grid repeats the same two numbers many times over; say each once.
  if (bands.length > MAX_GAP_LABELS) {
    const said = new Set<string>();
    for (const band of bands) {
      const key = `${band.w < band.h ? 'h' : 'v'}${Math.round(band.value)}`;
      band.labelled = !said.has(key);
      said.add(key);
    }
  }
  return bands;
}

/** Read an element's spacing in viewport space. */
export function readSpacing(el: Element): Spacing {
  const model = getBoxModel(el);
  const border = domRectToRect(el.getBoundingClientRect());
  // Box values are in layout px; a CSS scale on the element stretches them on screen.
  const sx = el instanceof HTMLElement && el.offsetWidth > 0 ? border.width / el.offsetWidth : 1;
  const sy = el instanceof HTMLElement && el.offsetHeight > 0 ? border.height / el.offsetHeight : 1;

  const marginValues = positive(model.margin);
  const out = { top: -marginValues.top, right: -marginValues.right, bottom: -marginValues.bottom, left: -marginValues.left };
  const padding = shrink(border, model.border, sx, sy);
  return {
    margin: shrink(border, out, sx, sy),
    border,
    padding,
    content: shrink(padding, model.padding, sx, sy),
    marginValues,
    paddingValues: model.padding,
    gaps: readGaps(el),
  };
}

function label(ctx: CanvasRenderingContext2D, cx: number, cy: number, value: number, rgb: string): void {
  const text = String(Math.round(value * 100) / 100);
  const w = Math.ceil(ctx.measureText(text).width) + 8;
  const h = 14;
  ctx.beginPath();
  ctx.roundRect(Math.round(cx - w / 2), Math.round(cy - h / 2), w, h, 4);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
  ctx.fill();
  ctx.fillStyle = `rgb(${rgb})`;
  ctx.fillText(text, Math.round(cx), Math.round(cy) + 0.5);
}

/** Tint the space between two nested boxes and write each side's size on it. */
function ring(ctx: CanvasRenderingContext2D, outer: Rect, inner: Rect, values: BoxModelValues, rgb: string): void {
  ctx.beginPath();
  ctx.rect(outer.left, outer.top, outer.width, outer.height);
  ctx.rect(inner.left, inner.top, inner.width, inner.height);
  ctx.fillStyle = `rgba(${rgb}, 0.22)`;
  ctx.fill('evenodd');

  const cx = (outer.left + outer.right) / 2;
  const cy = (outer.top + outer.bottom) / 2;
  if (values.top >= 1) label(ctx, cx, (outer.top + inner.top) / 2, values.top, rgb);
  if (values.bottom >= 1) label(ctx, cx, (outer.bottom + inner.bottom) / 2, values.bottom, rgb);
  if (values.left >= 1) label(ctx, (outer.left + inner.left) / 2, cy, values.left, rgb);
  if (values.right >= 1) label(ctx, (outer.right + inner.right) / 2, cy, values.right, rgb);
}

export function drawSpacing(ctx: CanvasRenderingContext2D, s: Spacing, opacity = 1): void {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.font = `500 10px 'JetBrains Mono', 'SF Mono', ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const band of s.gaps) {
    ctx.fillStyle = `rgba(${GAP_RGB}, 0.22)`;
    ctx.fillRect(band.x, band.y, band.w, band.h);
  }
  ring(ctx, s.margin, s.border, s.marginValues, MARGIN_RGB);
  ring(ctx, s.padding, s.content, s.paddingValues, PADDING_RGB);
  // Gap sizes last, so a neighbouring band never covers one.
  for (const band of s.gaps) {
    if (band.labelled) label(ctx, band.x + band.w / 2, band.y + band.h / 2, band.value, GAP_RGB);
  }
  ctx.restore();
}
