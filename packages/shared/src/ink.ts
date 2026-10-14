/**
 * Freehand ink. A stroke is not a line of one width: it is an outline traced
 * around the pointer's path, thinner where the hand moved fast and fuller where
 * it slowed, with rounded ends — the way a marker behaves, and the approach
 * tldraw's draw tool takes. The outline is filled, never stroked.
 *
 * Returned as SVG path data, which both a canvas (`new Path2D(d)`) and an
 * `<svg>` can draw, so the extension and the website's demo ink identically.
 */
export interface InkPoint { x: number; y: number }

/** Share of the distance to each new sample that is kept; the rest is hand tremor. */
const STREAMLINE = 0.55;
/** How much speed thins the line: 0 is a constant width. */
const THINNING = 0.55;
/** How quickly the simulated pressure follows a change of speed. */
const PRESSURE_RATE = 0.275;
const CAP_STEPS = 6;

const dist = (a: InkPoint, b: InkPoint): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Follow the samples loosely, so jitter is averaged out but the stroke still ends on the last one. */
function streamline(raw: InkPoint[]): InkPoint[] {
  const first = raw[0]!;
  const pts: InkPoint[] = [{ x: first.x, y: first.y }];
  for (let i = 1; i < raw.length; i++) {
    const prev = pts[pts.length - 1]!;
    const p = raw[i]!;
    const next = { x: prev.x + (p.x - prev.x) * STREAMLINE, y: prev.y + (p.y - prev.y) * STREAMLINE };
    if (dist(prev, next) >= 1) pts.push(next);
  }
  const last = raw[raw.length - 1]!;
  if (dist(pts[pts.length - 1]!, last) > 0.5) pts.push({ x: last.x, y: last.y });
  return pts;
}

/** Half-width at each point: pressure is guessed from how far the pointer travelled between samples. */
function radii(pts: InkPoint[], size: number, uniform: boolean, complete: boolean): number[] {
  const out: number[] = [];
  const run: number[] = [0];
  for (let i = 1; i < pts.length; i++) run.push(run[i - 1]! + dist(pts[i - 1]!, pts[i]!));
  const total = run[run.length - 1]!;
  const taper = Math.min(size * 3, total / 2);

  let pressure = 0.5;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0 && !uniform) {
      const speed = Math.min(1, dist(pts[i - 1]!, pts[i]!) / size);
      pressure = Math.min(1, pressure + (Math.min(1, 1 - speed) - pressure) * speed * PRESSURE_RATE);
    }
    let r = size * (0.5 - THINNING * (0.5 - pressure));
    // Ease into the stroke, and out of it once the pen has lifted.
    if (!uniform && taper > 0) {
      r *= 0.4 + 0.6 * Math.min(1, run[i]! / taper);
      if (complete) r *= 0.4 + 0.6 * Math.min(1, (total - run[i]!) / taper);
    }
    out.push(r);
  }
  return out;
}

/**
 * The filled shape of a stroke through `raw`. `size` is the nominal width.
 * `complete` is false while the stroke is still being drawn (its end is not tapered yet).
 * A stroke of exactly two samples is a ruled line: straight and of even width.
 */
/**
 * The filled shape of a stroke through `raw`, as SVG path data. `size` is the nominal width.
 * `complete` is false while the stroke is still being drawn (its end is not tapered yet).
 * A stroke of exactly two samples is a ruled line: straight and of even width.
 */
export function inkPathData(raw: InkPoint[], size: number, complete = true): string {
  if (raw.length === 0) return '';
  const n2 = (v: number): number => Math.round(v * 100) / 100;

  const pts = streamline(raw);
  if (pts.length === 1) {
    const { x, y } = pts[0]!;
    const r = n2(size * 0.55);
    return `M${n2(x - r)} ${n2(y)}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
  }
  const r = radii(pts, size, raw.length === 2, complete);

  const left: InkPoint[] = [];
  const right: InkPoint[] = [];
  const angles: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    angles.push(angle);
    const nx = -Math.sin(angle) * r[i]!;
    const ny = Math.cos(angle) * r[i]!;
    left.push({ x: pts[i]!.x + nx, y: pts[i]!.y + ny });
    right.push({ x: pts[i]!.x - nx, y: pts[i]!.y - ny });
  }

  /** Half a turn around `centre`, starting a quarter turn from `from` and sweeping clockwise on screen. */
  const cap = (centre: InkPoint, radius: number, from: number): InkPoint[] => {
    const out: InkPoint[] = [];
    for (let k = 1; k < CAP_STEPS; k++) {
      const t = from + Math.PI / 2 - (k * Math.PI) / CAP_STEPS;
      out.push({ x: centre.x + Math.cos(t) * radius, y: centre.y + Math.sin(t) * radius });
    }
    return out;
  };
  const end = pts.length - 1;
  const outline = [
    ...left,
    ...cap(pts[end]!, r[end]!, angles[end]!),
    ...right.reverse(),
    ...cap(pts[0]!, r[0]!, angles[0]! + Math.PI),
  ];

  // Curve through the midpoints, so the outline has no corners of its own.
  const n = outline.length;
  const mid = (a: InkPoint, b: InkPoint): InkPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const start = mid(outline[0]!, outline[1]!);
  let d = `M${n2(start.x)} ${n2(start.y)}`;
  for (let i = 1; i <= n; i++) {
    const p = outline[i % n]!;
    const m = mid(p, outline[(i + 1) % n]!);
    d += `Q${n2(p.x)} ${n2(p.y)} ${n2(m.x)} ${n2(m.y)}`;
  }
  return `${d}Z`;
}
