/**
 * Renderer — draws highlights, dimension lines, measurement labels onto the canvas.
 * All coordinates are in CSS pixels; we apply DPR scaling at the start of each frame.
 */
import type { Rect, CornerRadii } from '@raval/shared';
import { tuning } from './motion';
import { getMarkColor, markRgba, onMarkColor } from './mark-color';

// ─── Module state ─────────────────────────────────────────────────────────────

let _showRulers = false;
export function setShowRulers(show: boolean): void { _showRulers = show; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scale(ctx: CanvasRenderingContext2D): number {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return dpr;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | DOMPointInit[],
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.closePath();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Clear the entire canvas */
export function clearCanvas(ctx: CanvasRenderingContext2D): void {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/**
 * The one element highlight every mode shares.
 * Hover: soft fill with a thin border. Selected (clicked / pinned): the same
 * shape with a darker fill and a solid, heavier border.
 * Pass `radii` to trace the element's own corners instead of the default ones.
 */
export function drawElementHighlight(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  selected = false,
  opacity = 1,
  color = getMarkColor(),
  radii: CornerRadii | null = null,
  /** Leave the inside clear, for when something else (the spacing bands) is drawn there. */
  outlineOnly = false,
): void {
  scale(ctx);
  ctx.globalAlpha = opacity;
  const rgb = hexToRgb(color);
  // Square corners keep the default softening; rounded ones are followed exactly.
  const r = radii
    ? [radii.topLeft, radii.topRight, radii.bottomRight, radii.bottomLeft].map((c) => ({
      x: Math.max(tuning.radius, c.x), y: Math.max(tuning.radius, c.y),
    }))
    : tuning.radius;

  if (!outlineOnly) {
    ctx.fillStyle = `rgba(${rgb},${selected ? tuning.selectedFillAlpha : tuning.fillAlpha})`;
    roundedRect(ctx, rect.x, rect.y, rect.width, rect.height, r);
    ctx.fill();
  }

  ctx.strokeStyle = `rgba(${rgb},${selected ? 1 : tuning.strokeAlpha})`;
  ctx.lineWidth = selected ? 1.5 : 1;
  roundedRect(ctx, rect.x, rect.y, rect.width, rect.height, r);
  ctx.stroke();

  ctx.globalAlpha = 1;
}

/**
 * Colour picker target. Elements use the shared highlight. Text is the one
 * deliberate exception: the word itself is filled with the accent and turned
 * white by the CSS Highlight API, so only an outline is drawn around it here.
 */
export function drawColorPickHighlight(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number; opacity: number },
  isText: boolean,
  selected = false,
  /** Tint the word here because the browser cannot recolour the text itself. */
  tintText = false,
  radii: CornerRadii | null = null,
  outlineOnly = false,
): void {
  if (!isText) {
    drawElementHighlight(ctx, {
      x: rect.x, y: rect.y, width: rect.w, height: rect.h,
      left: rect.x, top: rect.y, right: rect.x + rect.w, bottom: rect.y + rect.h,
    }, selected, rect.opacity, undefined, radii, outlineOnly);
    return;
  }

  scale(ctx);
  ctx.globalAlpha = rect.opacity;
  roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, tuning.radius + 1);
  if (tintText) {
    ctx.fillStyle = markRgba(selected ? 0.28 : 0.2);
    ctx.fill();
  }
  ctx.strokeStyle = selected ? getMarkColor() : markRgba(0.8);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Draw measurement line between two points with end caps and centered label */
/** Small lettered marker on a pinned element's corner — names it without a label in the way. */
export function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, letter: string): void {
  scale(ctx);
  const r = 8;
  // Keep the whole badge on screen when the element touches the viewport edge.
  const cx = Math.max(r + 2, x);
  const cy = Math.max(r + 2, y);

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = getMarkColor();
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = onMarkColor();
  ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, cx, cy + 0.5);
}

/** Share of the animation spent drawing the line; the rest opens the far end cap. */
export const LINE_TRAVEL = 0.78;

const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

export function drawMeasurementLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  progress = 1,
): void {
  scale(ctx);

  // Three beats, in the order you picked the elements:
  //  1. a cap opens on the first element's edge,
  //  2. the line runs straight from there to the second element,
  //  3. once it lands, the cap on that edge opens out.
  // The line eases in and out so it visibly leaves the first edge rather than
  // appearing part-way along.
  const travel = easeInOutCubic(Math.min(1, progress / LINE_TRAVEL));
  const startCap = easeOutCubic(Math.min(1, progress / 0.18));
  const endCap = easeOutCubic(Math.max(0, (progress - LINE_TRAVEL) / (1 - LINE_TRAVEL)));

  const tipX = x1 + (x2 - x1) * travel;
  const tipY = y1 + (y2 - y1) * travel;
  const isHorizontal = Math.abs(y2 - y1) < 2;
  const capSize = 4;

  ctx.strokeStyle = markRgba(0.8);
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  const cap = (x: number, y: number, amount: number): void => {
    if (amount <= 0) return;
    const half = capSize * amount;
    ctx.beginPath();
    if (isHorizontal) { ctx.moveTo(x, y - half); ctx.lineTo(x, y + half); }
    else { ctx.moveTo(x - half, y); ctx.lineTo(x + half, y); }
    ctx.stroke();
  };
  cap(x1, y1, startCap);
  cap(x2, y2, endCap);
}

/**
 * Distance between two parallel guides: a capped line across the gap with the
 * value beside it. Drawn on the canvas, not as a label, so it can never sit
 * under the pointer and take a click meant for the page.
 */
export function drawGuideGap(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  text: string,
  /** For a vertical gap: the row another gap's line and label run along, to keep this label clear of. */
  avoidY?: number,
): void {
  drawMeasurementLine(ctx, x1, y1, x2, y2);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const horizontal = Math.abs(y2 - y1) < 2;
  ctx.font = `500 11px 'JetBrains Mono', 'SF Mono', ui-monospace, monospace`;
  const w = Math.ceil(ctx.measureText(text).width) + 12;
  const h = 18;
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

  // Centred on the part of the gap that is on screen; under a horizontal gap, left of a vertical one.
  let cx: number;
  let cy: number;
  if (horizontal) {
    cx = (clamp(Math.min(x1, x2), 0, vw) + clamp(Math.max(x1, x2), 0, vw)) / 2;
    cy = y1 + 8 + h / 2 > vh - 4 ? y1 - 8 - h / 2 : y1 + 8 + h / 2;
  } else {
    cy = (clamp(Math.min(y1, y2), 0, vh) + clamp(Math.max(y1, y2), 0, vh)) / 2;
    // Between four guides both gaps meet at the pointer; step this label above the crossing.
    if (avoidY !== undefined && cy > avoidY - h - 6 && cy < avoidY + 34) cy = avoidY - h - 6;
    cx = x1 - 8 - w / 2 < 4 ? x1 + 8 + w / 2 : x1 - 8 - w / 2;
  }
  const left = Math.round(clamp(cx - w / 2, 4, vw - w - 4));
  const top = Math.round(clamp(cy - h / 2, 4, vh - h - 4));

  ctx.beginPath();
  ctx.roundRect(left, top, w, h, 5);
  ctx.fillStyle = getMarkColor();
  ctx.fill();
  ctx.fillStyle = onMarkColor();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + w / 2, top + h / 2 + 0.5);
}

/** Draw dashed alignment guideline extending from an element edge */
export function drawAlignmentGuideline(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  scale(ctx);
  ctx.strokeStyle = markRgba(0.25);
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Draw a persistent guide line spanning the full viewport */
export function drawGuide(
  ctx: CanvasRenderingContext2D,
  axis: 'horizontal' | 'vertical',
  position: number,
  /** How emphasised the line is: false/0 resting, true/1 hovered or snapped, anything between while easing. */
  emphasis: boolean | number = false,
): void {
  scale(ctx);
  const w = window.innerWidth;
  const h = window.innerHeight;

  const amount = typeof emphasis === 'number' ? Math.max(0, Math.min(1, emphasis)) : emphasis ? 1 : 0;
  ctx.strokeStyle = markRgba(0.5 + 0.3 * amount);
  ctx.lineWidth = 1;

  ctx.beginPath();
  if (axis === 'horizontal') {
    ctx.moveTo(0, position);
    ctx.lineTo(w, position);
  } else {
    ctx.moveTo(position, 0);
    ctx.lineTo(position, h);
  }
  ctx.stroke();
}

// ─── Ruler overlay ────────────────────────────────────────────────────────────

export const RULER_SIZE = 20;

/** Draw pixel rulers along the top and left viewport edges */
export function drawRulers(
  ctx: CanvasRenderingContext2D,
  mouseX: number,
  mouseY: number,
): void {
  if (!_showRulers) return;
  scale(ctx);
  const w = window.innerWidth;
  const h = window.innerHeight;
  const R = RULER_SIZE;

  // Background strips
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fillRect(0, 0, w, R);
  ctx.fillRect(0, R, R, h - R);

  // Separator lines
  ctx.strokeStyle = 'rgba(0,0,0,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, R);     ctx.lineTo(w, R);
  ctx.moveTo(R, R);     ctx.lineTo(R, h);
  ctx.stroke();

  // Ticks and labels
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 0.5;
  ctx.font = '7px Inter, -apple-system, sans-serif';

  for (let px = 0; px <= w - R; px += 5) {
    const x = px + R + 0.5;
    const major = px % 100 === 0;
    const mid   = px % 50  === 0;
    const tick  = major ? 12 : mid ? 7 : 3;
    ctx.beginPath(); ctx.moveTo(x, R); ctx.lineTo(x, R - tick); ctx.stroke();
    if (major && px > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(String(px), x, R - 14);
    }
  }

  for (let py = 0; py <= h - R; py += 5) {
    const y = py + R + 0.5;
    const major = py % 100 === 0;
    const mid   = py % 50  === 0;
    const tick  = major ? 12 : mid ? 7 : 3;
    ctx.beginPath(); ctx.moveTo(R, y); ctx.lineTo(R - tick, y); ctx.stroke();
    if (major && py > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.translate(R - 14, y);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(String(py), 0, 0);
      ctx.restore();
    }
  }

  // Cursor crosshair highlights on the rulers
  if (mouseX > R && mouseY > R) {
    ctx.fillStyle = markRgba(0.9);
    ctx.fillRect(mouseX - 0.5, 0, 1, R);
    ctx.fillRect(0, mouseY - 0.5, R, 1);
  }
}

// ─── Viewport edge distances ──────────────────────────────────────────────────

/** Draw dashed lines + labels showing distance from element edges to viewport edges */
export function drawViewportDistances(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  container: HTMLElement,
  setLabelFn: (c: HTMLElement, name: string, text: string, x: number, y: number) => void,
): void {
  scale(ctx);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const R  = RULER_SIZE;

  ctx.strokeStyle = markRgba(0.3);
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);

  const cx = (rect.left + rect.right)  / 2;
  const cy = (rect.top  + rect.bottom) / 2;

  const distances = [
    { from: { x: cx,        y: rect.top    }, to: { x: cx,  y: R   }, val: Math.round(rect.top),         name: 'vp-top',    lx: cx + 8,    ly: (rect.top + R) / 2    },
    { from: { x: cx,        y: rect.bottom }, to: { x: cx,  y: vh  }, val: Math.round(vh - rect.bottom), name: 'vp-bottom', lx: cx + 8,    ly: (rect.bottom + vh) / 2 },
    { from: { x: rect.left, y: cy          }, to: { x: R,   y: cy  }, val: Math.round(rect.left),        name: 'vp-left',   lx: (rect.left + R) / 2,     ly: cy - 10    },
    { from: { x: rect.right,y: cy          }, to: { x: vw,  y: cy  }, val: Math.round(vw - rect.right),  name: 'vp-right',  lx: (rect.right + vw) / 2,   ly: cy - 10    },
  ];

  for (const d of distances) {
    if (d.val < 2) continue;
    ctx.beginPath();
    ctx.moveTo(d.from.x, d.from.y);
    ctx.lineTo(d.to.x, d.to.y);
    ctx.stroke();
    setLabelFn(container, d.name, `${d.val}px`, d.lx, d.ly);
  }

  ctx.setLineDash([]);
}
