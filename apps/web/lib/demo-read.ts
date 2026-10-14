/**
 * What the live demo reads off the page: corner radii and spacing. Kept in step
 * with the extension's `detector.ts` (getCornerRadii) and `spacing.ts`.
 */

export interface Corner { x: number; y: number }
export interface Radii { topLeft: Corner; topRight: Corner; bottomRight: Corner; bottomLeft: Corner }
export interface Edges { left: number; top: number; right: number; bottom: number }
export interface Sides { top: number; right: number; bottom: number; left: number }
export interface Band { x: number; y: number; w: number; h: number; value: number; labelled: boolean }

export interface Spacing {
  margin: Edges;
  border: Edges;
  padding: Edges;
  content: Edges;
  marginValues: Sides;
  paddingValues: Sides;
  gaps: Band[];
}

const px = (v: string): number => parseFloat(v) || 0;

function corner(value: string, width: number, height: number): Corner {
  const [h = '0', v = h] = value.trim().split(/\s+/);
  const resolve = (part: string, size: number): number =>
    Math.max(0, part.endsWith('%') ? (parseFloat(part) / 100) * size : px(part));
  return { x: resolve(h, width), y: resolve(v, height) };
}

/** Corner radii as rendered: percentages resolved, oversized values scaled down as CSS does. Null when square. */
export function readRadii(el: Element): Radii | null {
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const width = el instanceof HTMLElement && el.offsetWidth > 0 ? el.offsetWidth : rect.width;
  const height = el instanceof HTMLElement && el.offsetHeight > 0 ? el.offsetHeight : rect.height;
  if (width === 0 || height === 0) return null;

  const tl = corner(style.borderTopLeftRadius, width, height);
  const tr = corner(style.borderTopRightRadius, width, height);
  const br = corner(style.borderBottomRightRadius, width, height);
  const bl = corner(style.borderBottomLeftRadius, width, height);
  if ([tl, tr, br, bl].every((c) => c.x === 0 || c.y === 0)) return null;

  const fit = (size: number, a: number, b: number): number => (a + b > size ? size / (a + b) : 1);
  const f = Math.min(fit(width, tl.x, tr.x), fit(width, bl.x, br.x), fit(height, tl.y, bl.y), fit(height, tr.y, br.y));
  const sx = (rect.width / width) * f;
  const sy = (rect.height / height) * f;
  const used = (c: Corner): Corner => (c.x === 0 || c.y === 0 ? { x: 0, y: 0 } : { x: c.x * sx, y: c.y * sy });
  return { topLeft: used(tl), topRight: used(tr), bottomRight: used(br), bottomLeft: used(bl) };
}

/** "R 8", "R 8 8 0 0", "R 160/24" */
export function formatRadii(r: Radii): string {
  const one = (c: Corner): string => {
    const x = Math.round(c.x); const y = Math.round(c.y);
    return x === y ? String(x) : `${x}/${y}`;
  };
  const [tl, tr, br, bl] = [r.topLeft, r.topRight, r.bottomRight, r.bottomLeft].map(one);
  if (tl === tr && tr === br && br === bl) return `R ${tl}`;
  if (tl === br && tr === bl) return `R ${tl} ${tr}`;
  if (tr === bl) return `R ${tl} ${tr} ${br}`;
  return `R ${tl} ${tr} ${br} ${bl}`;
}

/** The radii as a CSS `border-radius`, never tighter than `min` so square corners keep a soft edge. */
export function radiiCss(r: Radii, min: number): string {
  const all = [r.topLeft, r.topRight, r.bottomRight, r.bottomLeft];
  const list = (axis: 'x' | 'y'): string => all.map((c) => `${Math.max(min, c[axis])}px`).join(' ');
  return `${list('x')} / ${list('y')}`;
}

const MAX_CHILDREN = 60;
const MAX_GAP_LABELS = 12;

function shrink(r: Edges, by: Sides, sx: number, sy: number): Edges {
  const left = r.left + by.left * sx;
  const top = r.top + by.top * sy;
  return { left, top, right: Math.max(left, r.right - by.right * sx), bottom: Math.max(top, r.bottom - by.bottom * sy) };
}

function readGaps(el: Element): Band[] {
  if (!/flex|grid/.test(window.getComputedStyle(el).display)) return [];
  if (el.children.length < 2 || el.children.length > MAX_CHILDREN) return [];

  const rects: DOMRect[] = [];
  for (const child of el.children) {
    const r = child.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
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

/** An element's padding, margin and the gaps between its children, in viewport space. */
export function readSpacing(el: Element): Spacing {
  const css = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const border: Edges = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  const sx = el instanceof HTMLElement && el.offsetWidth > 0 ? rect.width / el.offsetWidth : 1;
  const sy = el instanceof HTMLElement && el.offsetHeight > 0 ? rect.height / el.offsetHeight : 1;

  const sides = (prefix: string, suffix = ''): Sides => ({
    top: px(css.getPropertyValue(`${prefix}-top${suffix}`)), right: px(css.getPropertyValue(`${prefix}-right${suffix}`)),
    bottom: px(css.getPropertyValue(`${prefix}-bottom${suffix}`)), left: px(css.getPropertyValue(`${prefix}-left${suffix}`)),
  });
  const m = sides('margin');
  // Negative margins pull the element, they do not take up space.
  const marginValues: Sides = { top: Math.max(0, m.top), right: Math.max(0, m.right), bottom: Math.max(0, m.bottom), left: Math.max(0, m.left) };
  const paddingValues = sides('padding');
  const padding = shrink(border, sides('border', '-width'), sx, sy);
  return {
    margin: shrink(border, { top: -marginValues.top, right: -marginValues.right, bottom: -marginValues.bottom, left: -marginValues.left }, sx, sy),
    border,
    padding,
    content: shrink(padding, paddingValues, sx, sy),
    marginValues,
    paddingValues,
    gaps: readGaps(el),
  };
}
