'use client';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion, type MotionStyle } from 'framer-motion';
import { inkPathData } from '@raval/shared';
import { useDemo, tint, onColor, type DemoCursor } from './demo-provider';
import { readRadii, formatRadii, radiiCss, readSpacing, type Edges, type Spacing } from '../lib/demo-read';

// The demo mirrors the extension: same colours, same highlight states, same
// motion. Values here are kept in step with apps/extension/src/content/tokens.ts
// and motion.ts.

const UI = {
  font: `'Neue Plak Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`,
  mono: `'JetBrains Mono', 'SF Mono', ui-monospace, monospace`,
  bg: '#ffffff',
  track: 'rgba(0, 0, 0, 0.05)',
  hover: 'rgba(0, 0, 0, 0.04)',
  border: 'rgba(0, 0, 0, 0.08)',
  borderSubtle: 'rgba(0, 0, 0, 0.06)',
  textPrimary: '#000000',
  textSecondary: '#737373',
  textMuted: '#A3A3A3',
  accent: '#FF4500',
  shadow: '0 1px 2px rgba(0, 0, 0, 0.04), 0 6px 20px rgba(0, 0, 0, 0.06)',
  shadowSm: '0 1px 2px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.04)',
  shadowPill: '0 1px 2px rgba(0, 0, 0, 0.08)',
  easeMove: 'cubic-bezier(0.4, 0, 0.2, 1)',
  easeOut: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
} as const;

/** The hover spring: near-critically damped, quick, no bounce. */
const SPRING = { type: 'spring', stiffness: 1000, damping: 63, mass: 1 } as const;
const TOOLBAR_H = 44;

// ─── Shared helpers ───────────────────────────────────────────────────────────

function isOurUI(el: Element | null): boolean {
  return !!el?.closest?.('[data-demo-ui="true"]');
}

function getTarget(x: number, y: number): Element | null {
  const el = document.elementFromPoint(x, y);
  if (!el || isOurUI(el) || el === document.body || el === document.documentElement) return null;
  return el;
}

interface Box { x: number; y: number; w: number; h: number }

function toBox(r: DOMRect): Box {
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

const dims = (r: { width: number; height: number }): string =>
  `${Math.round(r.width)} × ${Math.round(r.height)}`;

let lastScrollAt = 0;

/** Re-render on scroll and resize so anything anchored to the page stays put. */
function useViewportTick(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = (): void => { lastScrollAt = performance.now(); setTick((t) => t + 1); };
    window.addEventListener('scroll', bump, { passive: true, capture: true });
    window.addEventListener('resize', bump);
    return () => {
      window.removeEventListener('scroll', bump, { capture: true });
      window.removeEventListener('resize', bump);
    };
  }, []);
}

/** While the page is scrolling, boxes track it exactly instead of springing after it. */
function useMove(): typeof SPRING | { duration: 0 } {
  const reduce = useReducedMotion();
  return reduce || performance.now() - lastScrollAt < 120 ? { duration: 0 } : SPRING;
}

// ─── Shared pieces ────────────────────────────────────────────────────────────

/**
 * The one element highlight every tool uses. Hover: soft fill, thin border.
 * Selected: same shape, darker fill and a solid, heavier border. It springs
 * between targets instead of jumping.
 */
function ElementHighlight({ box, selected = false, outline = false, z = 8900, radius, hollow = false }: {
  box: Box;
  selected?: boolean;
  /** Text targets: the word is filled by the browser highlight, so only outline it. */
  outline?: boolean;
  z?: number;
  /** The element's own corners, as a CSS border-radius, when it has rounded ones. */
  radius?: string | undefined;
  /** No fill, for when the spacing bands are drawn inside. */
  hollow?: boolean;
}) {
  const move = useMove();
  const { color } = useDemo();
  const fill = outline || hollow ? 0 : selected ? 0.14 : 0.06;
  const stroke = selected ? 1 : 0.75;
  return (
    <motion.div
      data-demo-ui="true"
      initial={{ opacity: 0, x: box.x, y: box.y, width: box.w, height: box.h }}
      animate={{ opacity: 1, x: box.x, y: box.y, width: box.w, height: box.h }}
      transition={{ ...move, opacity: { duration: 0.12, ease: 'easeOut' } }}
      style={{
        position: 'fixed', left: 0, top: 0, boxSizing: 'border-box',
        background: tint(color, fill),
        border: `${selected || outline ? 1.5 : 1}px solid ${tint(color, stroke)}`,
        // The extension strokes a 2px-radius path on canvas, half the line outside it. A CSS
        // border sits fully inside, so it needs a larger radius to read as the same corner.
        borderRadius: radius ?? (outline ? 4 : 3),
        pointerEvents: 'none', zIndex: z,
      }}
    />
  );
}

const CHIP: CSSProperties = {
  position: 'fixed',
  background: UI.bg,
  border: `1px solid ${UI.border}`,
  borderRadius: 6,
  boxShadow: UI.shadowSm,
  color: UI.textPrimary,
  fontFamily: UI.mono,
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '-0.01em',
  padding: '3px 8px',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  zIndex: 8960,
};

function Chip({ x, y, children, centered = false, style }: {
  x: number; y: number; children: ReactNode; centered?: boolean; style?: CSSProperties;
}) {
  return (
    <div
      data-demo-ui="true"
      style={{ ...CHIP, left: x, top: y, transform: centered ? 'translate(-50%, -50%)' : undefined, ...style }}
    >
      {children}
    </div>
  );
}

/** The options card under the toolbar: each tool's settings, as in the extension. */
function Card({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      data-demo-ui="true"
      initial={reduce ? false : { opacity: 0, y: -4, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} transition={{ duration: 0.16, ease: 'easeOut' }}
      style={{
        position: 'fixed', left: '50%', top: TOOLBAR_H + 12, width: 244, boxSizing: 'border-box', padding: 10, zIndex: 9000,
        background: UI.bg, border: `1px solid ${UI.border}`, borderRadius: 14, boxShadow: UI.shadow,
        fontFamily: UI.font, lineHeight: 1.3, letterSpacing: 'normal', userSelect: 'none',
      }}
    >
      {children}
    </motion.div>
  );
}

/** One on/off setting on a card. */
function SwitchRow({ label, hint, on, onToggle }: { label: string; hint?: string; on: boolean; onToggle: () => void }) {
  const reduce = useReducedMotion();
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '2px 2px' }}>
      <span style={{ fontSize: 12, color: UI.textSecondary, letterSpacing: '-0.01em' }}>
        {label}
        {hint && <span style={{ marginLeft: 6, fontFamily: UI.mono, fontSize: 10, color: UI.textMuted }}>{hint}</span>}
      </span>
      <button
        type="button" role="switch" aria-checked={on} aria-label={label} onClick={onToggle}
        style={{
          position: 'relative', width: 30, height: 17, padding: 0, border: 'none', borderRadius: 9, cursor: 'pointer', flexShrink: 0,
          background: on ? UI.accent : 'rgba(0,0,0,0.12)', transition: reduce ? 'none' : 'background 0.2s ease',
        }}
      >
        <span aria-hidden="true" style={{
          position: 'absolute', top: 2, left: 2, width: 13, height: 13, borderRadius: '50%', background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.25)', transform: `translateX(${on ? 13 : 0}px)`,
          transition: reduce ? 'none' : `transform 0.18s ${UI.easeMove}`,
        }} />
      </button>
    </div>
  );
}

// ─── 1. Inspect ───────────────────────────────────────────────────────────────
// Hover outlines what is under the pointer; click opens its details.

interface TextHit { range: Range; el: Element }

const WORD = /\S/;

/** The word of rendered text under a point, if any. */
function wordAt(x: number, y: number): TextHit | null {
  const caret = document.caretRangeFromPoint?.(x, y);
  const node = caret?.startContainer;
  if (!caret || !node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent ?? '';
  const parent = node.parentElement;
  if (!parent || !text.trim() || isOurUI(parent)) return null;

  let start = caret.startOffset;
  let end = start;
  while (start > 0 && WORD.test(text[start - 1] ?? '')) start--;
  while (end < text.length && WORD.test(text[end] ?? '')) end++;
  if (start === end) return null;

  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const r = range.getBoundingClientRect();
  if (r.width === 0 || x < r.left - 3 || x > r.right + 3 || y < r.top - 3 || y > r.bottom + 3) return null;
  return { range, el: parent };
}

function sameRange(a: Range | null | undefined, b: Range | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a.startContainer === b.startContainer && a.startOffset === b.startOffset
    && a.endContainer === b.endContainer && a.endOffset === b.endOffset;
}

const HIGHLIGHT_NAME = 'raval-demo-text';

/** Fill the hovered and selected words with the accent and turn their glyphs white, like a text selection. */
function useTextHighlight(ranges: (Range | null | undefined)[]): void {
  useEffect(() => {
    if (typeof CSS === 'undefined' || !('highlights' in CSS)) return;
    const live = ranges.filter((r): r is Range => !!r);
    if (live.length === 0) CSS.highlights.delete(HIGHLIGHT_NAME);
    else CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...live));
  });
  useEffect(() => () => {
    if (typeof CSS !== 'undefined' && 'highlights' in CSS) CSS.highlights.delete(HIGHLIGHT_NAME);
  }, []);
}

interface Prop { label: string; value: string }
interface Colour { label: string; raw: string; hex: string; rgb: string; hsl: string }
type Format = 'hex' | 'rgb' | 'hsl';
const FORMATS: Format[] = ['hex', 'rgb', 'hsl'];

const num = (n: number, digits = 3): string => String(Number(n.toFixed(digits)));

function parseRgba(css: string): [number, number, number, number] | null {
  const m = css.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,/\s]+([\d.]+))?\s*\)/);
  if (!m) return null;
  const a = m[4] !== undefined ? Number(m[4]) : 1;
  return [Number(m[1]), Number(m[2]), Number(m[3]), a > 1 ? a / 100 : a];
}

function toHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
    : max === gn ? ((bn - rn) / d + 2) / 6 : ((rn - gn) / d + 4) / 6;
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function readColours(el: Element, textFirst: boolean): Colour[] {
  const css = window.getComputedStyle(el);
  const text: [string, string] = ['Color', css.color];
  const bg: [string, string] = ['Background', css.backgroundColor];
  const out: Colour[] = [];
  const seen = new Set<string>();
  for (const [label, raw] of [...(textFirst ? [text, bg] : [bg, text]), ['Border', css.borderTopColor] as [string, string]]) {
    const p = parseRgba(raw);
    if (!p || p[3] < 0.05) continue;
    const [r, g, b] = p;
    const hex = '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
    if (seen.has(hex)) continue;
    seen.add(hex);
    const [h, s, l] = toHsl(r, g, b);
    out.push({ label, raw, hex, rgb: `rgb(${r}, ${g}, ${b})`, hsl: `hsl(${h}, ${s}%, ${l}%)` });
  }
  return out;
}

const WEIGHTS: Record<string, string> = {
  '100': 'Thin', '200': 'Extra Light', '300': 'Light', '400': 'Regular', '500': 'Medium',
  '600': 'Semibold', '700': 'Bold', '800': 'Extra Bold', '900': 'Black',
};

function readTypography(el: Element): Prop[] {
  const css = window.getComputedStyle(el);
  const size = parseFloat(css.fontSize) || 0;
  const family = (css.fontFamily.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '');
  const lh = parseFloat(css.lineHeight);
  const ls = parseFloat(css.letterSpacing);
  return [
    { label: 'Font', value: family },
    { label: 'Size', value: `${num(size)}px` },
    { label: 'Weight', value: WEIGHTS[css.fontWeight] ? `${css.fontWeight} ${WEIGHTS[css.fontWeight]}` : css.fontWeight },
    { label: 'Line height', value: Number.isNaN(lh) || !size ? css.lineHeight : `${num(lh)}px / ${num(lh / size)}` },
    { label: 'Letter spacing', value: Number.isNaN(ls) || ls === 0 || !size ? '0' : `${num(ls)}px / ${num(ls / size)}em` },
  ];
}

function shorthand(t: number, r: number, b: number, l: number): string {
  const px = (n: number): string => (n === 0 ? '0' : `${num(n, 2)}px`);
  if (t === r && r === b && b === l) return px(t);
  if (t === b && r === l) return `${px(t)} ${px(r)}`;
  if (r === l) return `${px(t)} ${px(r)} ${px(b)}`;
  return `${px(t)} ${px(r)} ${px(b)} ${px(l)}`;
}

function readBox(el: Element): Prop[] {
  const css = window.getComputedStyle(el);
  const n = (v: string): number => parseFloat(v) || 0;
  const out: Prop[] = [
    { label: 'Margin', value: shorthand(n(css.marginTop), n(css.marginRight), n(css.marginBottom), n(css.marginLeft)) },
    { label: 'Border', value: shorthand(n(css.borderTopWidth), n(css.borderRightWidth), n(css.borderBottomWidth), n(css.borderLeftWidth)) },
    { label: 'Padding', value: shorthand(n(css.paddingTop), n(css.paddingRight), n(css.paddingBottom), n(css.paddingLeft)) },
  ];
  if (css.borderRadius && css.borderRadius !== '0px') out.push({ label: 'Radius', value: css.borderRadius });
  return out;
}

const rowBase: CSSProperties = {
  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12,
  padding: '5px 6px', margin: '0 -6px', borderRadius: 6,
};
const rowLabel: CSSProperties = { color: UI.textSecondary, fontSize: 11, letterSpacing: '-0.01em', flexShrink: 0 };
const rowValue: CSSProperties = {
  color: UI.textPrimary, fontFamily: UI.mono, fontSize: 11, letterSpacing: '-0.01em',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, textAlign: 'right',
};

function PropRow({ label, value, swatch }: Prop & { swatch?: string }) {
  return (
    <div className="demo-row" style={{ ...rowBase, alignItems: swatch ? 'center' : 'baseline' }}>
      {swatch && (
        <span style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, background: swatch, border: `1px solid ${UI.border}` }} />
      )}
      <span style={{ ...rowLabel, flex: swatch ? 1 : undefined }}>{label}</span>
      <span style={rowValue}>{value}</span>
    </div>
  );
}

type SectionKey = 'type' | 'colours' | 'box';

/** Collapsible group; the body opens with a grid row so no heights are measured. */
function Section({ title, open, onToggle, summary, children }: {
  title: string; open: boolean; onToggle: () => void; summary?: ReactNode; children: ReactNode;
}) {
  return (
    <div style={{ borderTop: `1px solid ${UI.borderSubtle}` }}>
      <button
        type="button"
        className="demo-row"
        aria-expanded={open}
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', boxSizing: 'border-box',
          padding: '9px 12px', margin: 0, border: 'none', background: 'transparent', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 11, fontWeight: 500, letterSpacing: '-0.01em',
          color: UI.textPrimary, textAlign: 'left',
        }}
      >
        <span style={{ flex: 1 }}>{title}</span>
        {/* A closed section previews what is inside */}
        {summary && <span style={{ opacity: open ? 0 : 1, transition: 'opacity 0.15s ease', display: 'inline-flex' }}>{summary}</span>}
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={UI.textMuted} strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          style={{ transform: `rotate(${open ? 90 : 0}deg)`, transition: `transform 0.2s ${UI.easeMove}` }}
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: `grid-template-rows 0.2s ${UI.easeOut}` }}>
        <div style={{ overflow: 'hidden', minHeight: 0 }}>
          <div style={{ padding: '0 12px 10px' }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Tab row with a pill that slides to the active item. */
function Segmented({ value, onChange }: { value: Format; onChange: (f: Format) => void }) {
  const reduce = useReducedMotion();
  const idx = FORMATS.indexOf(value);
  return (
    <div style={{
      position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
      background: UI.track, borderRadius: 7, padding: 2, marginBottom: 6,
    }}>
      <div style={{
        position: 'absolute', top: 2, bottom: 2, left: 2, width: 'calc((100% - 4px) / 3)',
        // Its own width is one tab, so 100% per step lands on each tab.
        transform: `translateX(${idx * 100}%)`,
        background: UI.bg, borderRadius: 5, boxShadow: UI.shadowPill,
        transition: reduce ? 'none' : `transform 0.22s ${UI.easeMove}`,
      }} />
      {FORMATS.map((f) => (
        <button
          key={f} type="button" aria-pressed={f === value} onClick={() => onChange(f)}
          style={{
            position: 'relative', zIndex: 1, height: 24, padding: 0, border: 'none', background: 'transparent',
            color: f === value ? UI.textPrimary : UI.textSecondary, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 10, fontWeight: 500, letterSpacing: '-0.01em',
            transition: `color 0.22s ${UI.easeMove}`,
          }}
        >
          {f.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

// All in the accent, told apart by fill: padding a light tint, margin a diagonal hatch, gaps a stronger tint.
const PADDING_ALPHA = 0.18;
const GAP_ALPHA = 0.32;
const MARGIN_ALPHA = 0.06;
const HATCH_ALPHA = 0.45;
const HATCH_ID = 'raval-demo-margin-hatch';

function BandLabel({ x, y, value, color }: { x: number; y: number; value: number; color: string }) {
  const text = String(Math.round(value * 100) / 100);
  const w = text.length * 6.2 + 8;
  return (
    <g>
      <rect x={Math.round(x - w / 2)} y={Math.round(y - 7)} width={w} height="14" rx="4" fill="rgba(255,255,255,0.94)" />
      <text x={Math.round(x)} y={Math.round(y) + 3.5} textAnchor="middle" fill={color} fontFamily={UI.mono} fontSize="10" fontWeight="500">{text}</text>
    </g>
  );
}

/** Padding, margin and child gaps of the clicked element, drawn on it the way browser dev tools do. */
function SpacingBands({ s }: { s: Spacing }) {
  const { color } = useDemo();
  const box = (e: Edges): string => `M${e.left} ${e.top}H${e.right}V${e.bottom}H${e.left}Z`;
  const ring = (outer: Edges, inner: Edges, values: Spacing['marginValues'], fills: string[]): ReactNode => {
    const cx = (outer.left + outer.right) / 2;
    const cy = (outer.top + outer.bottom) / 2;
    return (
      <g>
        {fills.map((fill) => <path key={fill} d={box(outer) + box(inner)} fillRule="evenodd" fill={fill} />)}
        {values.top >= 1 && <BandLabel x={cx} y={(outer.top + inner.top) / 2} value={values.top} color={color} />}
        {values.bottom >= 1 && <BandLabel x={cx} y={(outer.bottom + inner.bottom) / 2} value={values.bottom} color={color} />}
        {values.left >= 1 && <BandLabel x={(outer.left + inner.left) / 2} y={cy} value={values.left} color={color} />}
        {values.right >= 1 && <BandLabel x={(outer.right + inner.right) / 2} y={cy} value={values.right} color={color} />}
      </g>
    );
  };
  return (
    <svg data-demo-ui="true" aria-hidden="true" style={{ position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh', overflow: 'visible', pointerEvents: 'none', zIndex: 8898 }}>
      <defs>
        <pattern id={HATCH_ID} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke={tint(color, HATCH_ALPHA)} strokeWidth="1" />
        </pattern>
      </defs>
      {s.gaps.map((g, i) => <rect key={i} x={g.x} y={g.y} width={g.w} height={g.h} fill={tint(color, GAP_ALPHA)} />)}
      {ring(s.margin, s.border, s.marginValues, [tint(color, MARGIN_ALPHA), `url(#${HATCH_ID})`])}
      {ring(s.padding, s.content, s.paddingValues, [tint(color, PADDING_ALPHA)])}
      {s.gaps.map((g, i) => (g.labelled ? <BandLabel key={i} x={g.x + g.w / 2} y={g.y + g.h / 2} value={g.value} color={color} /> : null))}
    </svg>
  );
}

const PANEL_W = 248;

interface Selection { el: Element; range: Range | null }

function DetailsPanel({ sel, anchor }: { sel: Selection; anchor: Edges }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = useMove();
  const [format, setFormat] = useState<Format>('hex');
  // One section open at a time: typography for text, colours otherwise.
  const [open, setOpen] = useState<SectionKey | null>(null);
  const [height, setHeight] = useState(220);

  const type = useMemo(() => (sel.range ? readTypography(sel.el) : []), [sel]);
  const colours = useMemo(() => readColours(sel.el, !!sel.range), [sel]);
  const box = useMemo(() => readBox(sel.el), [sel]);

  useEffect(() => { setOpen(sel.range ? 'type' : 'colours'); }, [sel]);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(() => setHeight(ref.current?.offsetHeight ?? 220));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  // Below, else above, else beside — never on top of the thing being inspected.
  const vw = window.innerWidth, vh = window.innerHeight, gap = 10, pad = 8;
  const maxX = vw - PANEL_W - pad, maxY = vh - height - pad, minY = TOOLBAR_H + pad;
  const clampX = (v: number): number => Math.round(Math.max(pad, Math.min(maxX, v)));
  const clampY = (v: number): number => Math.round(Math.max(minY, Math.min(maxY, v)));
  let x: number, y: number;
  if (anchor.bottom + gap <= maxY) { x = clampX(anchor.left); y = Math.round(anchor.bottom + gap); }
  else if (anchor.top - gap - height >= minY) { x = clampX(anchor.left); y = Math.round(anchor.top - gap - height); }
  else if (anchor.right + gap <= maxX) { x = Math.round(anchor.right + gap); y = clampY(anchor.top); }
  else { x = clampX(anchor.left - gap - PANEL_W); y = clampY(anchor.top); }

  const toggle = (key: SectionKey) => () => setOpen((cur) => (cur === key ? null : key));
  const elRect = sel.el.getBoundingClientRect();

  return (
    <motion.div
      ref={ref}
      data-demo-ui="true"
      // Opens in place and fades; moving to another target glides with the hover spring.
      initial={{ opacity: 0, x, y }}
      animate={{ opacity: 1, x, y }}
      exit={{ opacity: 0 }}
      transition={{ ...move, opacity: { duration: 0.15, ease: 'easeOut' } }}
      style={{
        position: 'fixed', left: 0, top: 0, width: PANEL_W, boxSizing: 'border-box', zIndex: 9001,
        background: UI.bg, border: `1px solid ${UI.border}`, borderRadius: 14, boxShadow: UI.shadow,
        fontFamily: UI.font, fontSize: 12, color: UI.textPrimary, overflow: 'hidden', userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '9px 12px' }}>
        <span style={{ fontFamily: UI.mono, fontSize: 11, color: UI.textSecondary }}>&lt;{sel.el.tagName.toLowerCase()}&gt;</span>
        <span style={{ fontFamily: UI.mono, fontSize: 11 }}>{dims(elRect)}</span>
      </div>

      {type.length > 0 && (
        <Section
          title="Typography" open={open === 'type'} onToggle={toggle('type')}
          summary={<span style={{ color: UI.textMuted, fontSize: 11, fontWeight: 400 }}>{type[0]?.value}</span>}
        >
          {type.map((t) => <PropRow key={t.label} {...t} />)}
        </Section>
      )}

      <Section
        title="Colours" open={open === 'colours'} onToggle={toggle('colours')}
        summary={
          <span style={{ display: 'inline-flex', gap: 3 }}>
            {colours.slice(0, 4).map((c) => (
              <span key={c.hex} style={{ width: 10, height: 10, borderRadius: '50%', background: c.raw, border: `1px solid ${UI.border}` }} />
            ))}
          </span>
        }
      >
        {colours.length > 0 && <Segmented value={format} onChange={setFormat} />}
        {colours.length === 0
          ? <div style={{ color: UI.textMuted, fontSize: 11, padding: '6px 0' }}>No colours on this element</div>
          : colours.map((c) => <PropRow key={c.hex} label={c.label} value={c[format]} swatch={c.raw} />)}
      </Section>

      <Section title="Box" open={open === 'box'} onToggle={toggle('box')}>
        {box.map((b) => <PropRow key={b.label} {...b} />)}
      </Section>
    </motion.div>
  );
}

function InspectOverlay({ setCursor }: { setCursor: (c: DemoCursor) => void }) {
  useViewportTick();
  const [hover, setHover] = useState<{ el: Element; range: Range | null } | null>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  /** Draw the clicked element's padding, margin and child gaps on it. */
  const [spacing, setSpacing] = useState(false);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (isOurUI(e.target as Element)) return;
      const word = wordAt(e.clientX, e.clientY);
      const el = word ? word.el : getTarget(e.clientX, e.clientY);
      setHover((prev) => {
        if (!el) return null;
        const range = word ? word.range : null;
        return prev && prev.el === el && sameRange(prev.range, range) ? prev : { el, range };
      });
      setCursor(word ? 'text' : 'crosshair');
    }
    // Click a word or element to open its details; click it again, or empty space, to close.
    function onClick(e: MouseEvent) {
      if (isOurUI(e.target as Element)) return;
      e.preventDefault();
      e.stopPropagation();
      const word = wordAt(e.clientX, e.clientY);
      const el = word ? word.el : getTarget(e.clientX, e.clientY);
      const range = word ? word.range : null;
      setSel((cur) => {
        if (!el) return null;
        if (cur && cur.el === el && sameRange(cur.range, range)) return null;
        return { el, range };
      });
    }
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      if (e.key === 'Escape') setSel(null);
      else if (e.key.toLowerCase() === 'b' && !e.metaKey && !e.ctrlKey && !e.altKey) setSpacing((v) => !v);
    }
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey);
      setCursor('crosshair');
    };
  }, [setCursor]);

  useTextHighlight([sel?.range, hover?.range]);

  const rectOf = (t: { el: Element; range: Range | null }): DOMRect =>
    (t.range ? t.range.getBoundingClientRect() : t.el.getBoundingClientRect());
  const live = (t: { el: Element } | null): boolean => !!t && t.el.isConnected;

  const hoverRect = live(hover) ? rectOf(hover!) : null;
  const selRect = live(sel) ? rectOf(sel!) : null;
  const hoveringSelection = !!hover && !!sel && hover.el === sel.el && sameRange(hover.range, sel.range);

  // Rounded elements are outlined along their real corners, and say their radius.
  const hoverRadii = hoverRect && !hover!.range ? readRadii(hover!.el) : null;
  const selRadii = selRect && !sel!.range ? readRadii(sel!.el) : null;
  // Spacing belongs to what was clicked; for a clicked word that is the element holding it.
  const bands = spacing && selRect ? readSpacing(sel!.el) : null;

  return (
    <>
      <Card>
        <SwitchRow label="Show spacing" hint="B" on={spacing} onToggle={() => setSpacing((v) => !v)} />
        <div style={{ marginTop: 6, padding: '0 2px', fontSize: 10, color: UI.textSecondary, letterSpacing: '-0.01em' }}>
          {spacing ? 'Click an element: padding, margin and gaps' : 'Hover for size and radius · Click for details'}
        </div>
      </Card>

      {bands && <SpacingBands s={bands} />}
      {selRect && (
        <ElementHighlight
          box={toBox(selRect)} selected outline={!!sel!.range} z={8899} hollow={!!bands}
          radius={selRadii ? radiiCss(selRadii, 3) : undefined}
        />
      )}
      {hoverRect && !hoveringSelection && (
        <ElementHighlight box={toBox(hoverRect)} outline={!!hover!.range} radius={hoverRadii ? radiiCss(hoverRadii, 3) : undefined} />
      )}
      {/* Elements (not words) also show their size, and their corner radius when they have one */}
      {hoverRect && !hover!.range && (
        <Chip x={hoverRect.left} y={hoverRect.top > TOOLBAR_H + 34 ? hoverRect.top - 30 : hoverRect.bottom + 8}>
          {hoverRadii ? `${dims(hoverRect)} · ${formatRadii(hoverRadii)}` : dims(hoverRect)}
        </Chip>
      )}
      <AnimatePresence>
        {/* With the bands on, the panel keeps clear of the whole margin box */}
        {sel && selRect && <DetailsPanel key="details" sel={sel} anchor={bands?.margin ?? selRect} />}
      </AnimatePresence>
    </>
  );
}

// ─── 2. Measure ───────────────────────────────────────────────────────────────
// Click elements to pin them; each consecutive pair is measured.

const MAX_PINS = 5;
const BADGES = ['A', 'B', 'C', 'D', 'E'];

/** Run the line through the stretch both elements share, so it leaves one edge and lands on the other. */
function crossAxis(a0: number, a1: number, b0: number, b1: number): number {
  const from = Math.max(a0, b0), to = Math.min(a1, b1);
  return to > from ? (from + to) / 2 : (a0 + a1) / 2;
}

function measurePair(a: DOMRect, b: DOMRect) {
  const hGap = Math.max(a.left - b.right, b.left - a.right, 0);
  const vGap = Math.max(a.top - b.bottom, b.top - a.bottom, 0);
  if (hGap > 0 && hGap >= vGap) {
    const y = crossAxis(a.top, a.bottom, b.top, b.bottom);
    const forward = a.right <= b.left;
    return { x1: forward ? a.right : a.left, y1: y, x2: forward ? b.left : b.right, y2: y, gap: hGap, horizontal: true };
  }
  const x = crossAxis(a.left, a.right, b.left, b.right);
  const forward = a.bottom <= b.top;
  return { x1: x, y1: forward ? a.bottom : a.top, x2: x, y2: forward ? b.top : b.bottom, gap: vGap, horizontal: false };
}

const LINE_S = 0.33;
const CAP_S = 0.1;
/** Leaving is quicker than arriving. */
const RETRACT_S = LINE_S * 0.7;
const EASE_IN_OUT = [0.645, 0.045, 0.355, 1] as const;

/**
 * Three beats, in the order the elements were picked: a cap opens on the first
 * element's edge, the line runs straight to the second, and when it lands the
 * cap on that edge opens out with the distance. When one of its elements is
 * unpinned the line draws back into the element that is still there.
 */
function MeasureLine({ a, b, aId, wait }: { a: DOMRect; b: DOMRect; aId: number; wait: number }) {
  const reduce = useReducedMotion();
  const STROKE = tint(useDemo().color, 0.85);
  // Decided once: a line that replaces two removed ones waits for them to pull back.
  const [delay] = useState(wait);
  const { x1, y1, x2, y2, gap, horizontal } = measurePair(a, b);
  const CAP = 4;
  const t = (duration: number, after: number) => (reduce ? { duration: 0 } : { duration, delay: delay + after, ease: EASE_IN_OUT });
  const out = reduce ? { duration: 0 } : { duration: RETRACT_S, ease: EASE_IN_OUT };
  const cap = (x: number, y: number, after: number) => {
    const from = { x1: x, y1: y, x2: x, y2: y };
    const to = horizontal ? { x1: x, y1: y - CAP, x2: x, y2: y + CAP } : { x1: x - CAP, y1: y, x2: x + CAP, y2: y };
    return (
      <motion.line
        initial={from} animate={to} exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={t(CAP_S, after)}
        stroke={STROKE} strokeWidth="1.5" strokeLinecap="round"
      />
    );
  };
  return (
    <>
      <svg data-demo-ui="true" style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 8950, overflow: 'visible' }}>
        {cap(x1, y1, 0)}
        <motion.line
          initial={{ x1, y1, x2: x1, y2: y1 }} animate={{ x1, y1, x2, y2 }} transition={t(LINE_S, 0)}
          // `removed` is the id of the element that was unpinned: pull back towards the other one.
          variants={{ exit: (removed: number) => ({ ...(removed === aId ? { x1: x2, y1: y2 } : { x2: x1, y2: y1 }), transition: out }) }}
          exit="exit"
          stroke={STROKE} strokeWidth="1.5" strokeLinecap="round"
        />
        {cap(x2, y2, LINE_S)}
      </svg>
      <motion.div
        data-demo-ui="true"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.08 } }}
        transition={reduce ? { duration: 0 } : { duration: 0.15, delay: delay + LINE_S }}
        style={{ ...CHIP, left: (x1 + x2) / 2, top: (y1 + y2) / 2, transform: 'translate(-50%, -50%)' } as MotionStyle}
      >
        {Math.round(gap)}px
      </motion.div>
    </>
  );
}

function MeasureOverlay({ setCursor }: { setCursor: (c: DemoCursor) => void }) {
  useViewportTick();
  const { color } = useDemo();
  const [pins, setPins] = useState<{ id: number; el: Element }[]>([]);
  const [hover, setHover] = useState<Element | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const nextId = useRef(0);
  // Which element was last unpinned, and when — its lines pull back and their replacement waits.
  const [removedId, setRemovedId] = useState(-1);
  const removedAt = useRef(0);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      setHover(isOurUI(e.target as Element) ? null : getTarget(e.clientX, e.clientY));
    }
    function onClick(e: MouseEvent) {
      if (isOurUI(e.target as Element)) return;
      const el = getTarget(e.clientX, e.clientY);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      setPins((prev) => {
        // Clicking a pinned element removes just that pin.
        const pinned = prev.find((p) => p.el === el);
        if (pinned) {
          setAnnouncement('Element unpinned.');
          setRemovedId(pinned.id);
          removedAt.current = performance.now();
          return prev.filter((p) => p.el !== el);
        }
        // At the limit, the oldest pin makes room.
        const kept = prev.length >= MAX_PINS ? prev.slice(1) : prev;
        const next = [...kept, { id: nextId.current++, el }];
        setAnnouncement(next.length === 1 ? 'First element pinned. Click a second element to measure.' : 'Distance measured.');
        return next;
      });
    }
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('click', onClick, true);
    };
  }, []);

  const livePins = pins.filter((p) => p.el.isConnected);
  const rects = livePins.map((p) => p.el.getBoundingClientRect());
  const hoverPinned = !!hover && livePins.some((p) => p.el === hover);
  const last = rects[rects.length - 1];

  // Over a pinned element the cursor becomes a minus: a click there unpins it.
  useEffect(() => {
    setCursor(hoverPinned ? 'remove' : 'crosshair');
    return () => setCursor('crosshair');
  }, [hoverPinned, setCursor]);

  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>

      {hover && !hoverPinned && <ElementHighlight box={toBox(hover.getBoundingClientRect())} />}

      {livePins.map((p, i) => (
        <div key={p.id}>
          <ElementHighlight box={toBox(rects[i]!)} selected z={8899} />
          {/* Size only for the pinned element under the pointer, so labels do not pile up */}
          {hover === p.el && (
            <Chip x={rects[i]!.left + 14} y={Math.max(TOOLBAR_H + 4, rects[i]!.top - 28)}>{dims(rects[i]!)}</Chip>
          )}
        </div>
      ))}

      <AnimatePresence custom={removedId}>
        {livePins.slice(1).map((p, i) => (
          <MeasureLine
            key={`${livePins[i]!.id}-${p.id}`} a={rects[i]!} b={rects[i + 1]!} aId={livePins[i]!.id}
            wait={performance.now() - removedAt.current < 100 ? RETRACT_S : 0}
          />
        ))}
      </AnimatePresence>

      {/* Lettered markers, above the lines */}
      {livePins.map((p, i) => (
        <div
          key={p.id} data-demo-ui="true"
          style={{
            position: 'fixed', left: Math.max(10, rects[i]!.left), top: Math.max(TOOLBAR_H + 10, rects[i]!.top),
            width: 16, height: 16, margin: '-8px 0 0 -8px', borderRadius: '50%', boxSizing: 'border-box',
            background: color, border: '1.5px solid #fff', color: onColor(color),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: UI.font, fontSize: 10, fontWeight: 600, lineHeight: 1,
            pointerEvents: 'none', zIndex: 8955,
          }}
        >
          {BADGES[i]}
        </div>
      ))}

      {/* The site has no toasts, so the one next step is shown here, only until a second element is picked */}
      {last && livePins.length === 1 && (
        <Chip x={last.left} y={last.bottom + 8} style={{ fontFamily: UI.font, color: UI.textSecondary }}>
          Click another element to measure
        </Chip>
      )}
    </>
  );
}

// ─── 3. Guides ────────────────────────────────────────────────────────────────
// Click to place; hover a guide to delete it with a click or move it with a drag.
// With the pointer between two parallel guides, the distance between them is shown.
// Placed guides stay on the page when the tool is switched off.

interface Guide { id: number; axis: 'h' | 'v'; pos: number }
interface Gap { x1: number; y1: number; x2: number; y2: number; label: string; avoidY?: number }

const GUIDE_HIT = 4;
const DRAG_THRESHOLD = 4;

/** Closest guide of an axis on each side of a page position. */
function neighbours(guides: Guide[], axis: 'h' | 'v', pos: number, skipId?: number): { before: Guide | null; after: Guide | null } {
  let before: Guide | null = null;
  let after: Guide | null = null;
  for (const g of guides) {
    if (g.axis !== axis || g.id === skipId) continue;
    if (g.pos < pos && (!before || g.pos > before.pos)) before = g;
    if (g.pos > pos && (!after || g.pos < after.pos)) after = g;
  }
  return { before, after };
}

/** Measured gaps between guides: a capped line across each, with the distance beside it. */
function GuideGaps({ gaps }: { gaps: Gap[] }) {
  const { color } = useDemo();
  const vw = window.innerWidth, vh = window.innerHeight;
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const CAP = 4;
  return (
    <svg data-demo-ui="true" aria-hidden="true" style={{ position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh', overflow: 'visible', pointerEvents: 'none', zIndex: 8950 }}>
      {gaps.map((g, i) => {
        const horizontal = Math.abs(g.y2 - g.y1) < 2;
        const w = g.label.length * 6.7 + 12;
        const h = 18;
        // Centred on the part of the gap that is on screen; under a horizontal gap, left of a vertical one.
        let cx: number, cy: number;
        if (horizontal) {
          cx = (clamp(Math.min(g.x1, g.x2), 0, vw) + clamp(Math.max(g.x1, g.x2), 0, vw)) / 2;
          cy = g.y1 + 8 + h / 2 > vh - 4 ? g.y1 - 8 - h / 2 : g.y1 + 8 + h / 2;
        } else {
          cy = (clamp(Math.min(g.y1, g.y2), TOOLBAR_H, vh) + clamp(Math.max(g.y1, g.y2), TOOLBAR_H, vh)) / 2;
          // Between four guides both gaps meet at the pointer; step this label above the crossing.
          if (g.avoidY !== undefined && cy > g.avoidY - h - 6 && cy < g.avoidY + 34) cy = g.avoidY - h - 6;
          cx = g.x1 - 8 - w / 2 < 4 ? g.x1 + 8 + w / 2 : g.x1 - 8 - w / 2;
        }
        const left = Math.round(clamp(cx - w / 2, 4, vw - w - 4));
        const top = Math.round(clamp(cy - h / 2, TOOLBAR_H + 4, vh - h - 4));
        const caps = horizontal
          ? `M${g.x1} ${g.y1 - CAP}v${CAP * 2}M${g.x2} ${g.y2 - CAP}v${CAP * 2}`
          : `M${g.x1 - CAP} ${g.y1}h${CAP * 2}M${g.x2 - CAP} ${g.y2}h${CAP * 2}`;
        return (
          <g key={i}>
            <path d={`M${g.x1} ${g.y1}L${g.x2} ${g.y2}${caps}`} stroke={tint(color, 0.8)} strokeWidth="1.5" strokeLinecap="round" fill="none" />
            <rect x={left} y={top} width={w} height={h} rx="5" fill={color} />
            <text x={left + w / 2} y={top + h / 2 + 4} textAnchor="middle" fill={onColor(color)} fontFamily={UI.mono} fontSize="11" fontWeight="500">{g.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function GuidesOverlay({ active, setCursor }: { active: boolean; setCursor: (c: DemoCursor) => void }) {
  useViewportTick();
  const { color } = useDemo();
  const [mouse, setMouse] = useState({ x: -100, y: -100 });
  const [guides, setGuides] = useState<Guide[]>([]);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const [showGaps, setShowGaps] = useState(true);
  const nextId = useRef(0);
  const guidesRef = useRef<Guide[]>([]);
  guidesRef.current = guides;
  const press = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);
  // A guide you just placed is under the pointer already; it only becomes
  // deletable once you have moved off it and come back.
  const unarmed = useRef(new Set<number>());

  useEffect(() => {
    if (!active) return;
    // Guides are stored in page coordinates so they scroll with the content.
    const view = (g: Guide): number => (g.axis === 'h' ? g.pos - window.scrollY : g.pos - window.scrollX);
    const near = (g: Guide, x: number, y: number): boolean => Math.abs((g.axis === 'h' ? y : x) - view(g)) <= GUIDE_HIT;
    const guideAt = (x: number, y: number): Guide | null =>
      guidesRef.current.find((g) => !unarmed.current.has(g.id) && near(g, x, y)) ?? null;

    function onMove(e: MouseEvent) {
      if (isOurUI(e.target as Element) && !press.current) return;
      setMouse({ x: e.clientX, y: e.clientY });

      const p = press.current;
      if (p) {
        // A press only becomes a move once the pointer has travelled; a still press is a delete.
        if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
        p.moved = true;
        const g = guidesRef.current.find((x) => x.id === p.id);
        if (!g) return;
        setMoving(true);
        setCursor(g.axis === 'h' ? 'move-y' : 'move-x');
        const pos = g.axis === 'h' ? e.clientY + window.scrollY : e.clientX + window.scrollX;
        setGuides((prev) => prev.map((x) => (x.id === p.id ? { ...x, pos } : x)));
        return;
      }

      for (const id of [...unarmed.current]) {
        const g = guidesRef.current.find((x) => x.id === id);
        if (!g || !near(g, e.clientX, e.clientY)) unarmed.current.delete(id);
      }
      const hit = guideAt(e.clientX, e.clientY);
      setHoveredId(hit?.id ?? null);
      setCursor(hit ? 'delete' : 'crosshair');
    }

    function onDown(e: MouseEvent) {
      swallowClick.current = false;
      if (e.button !== 0 || isOurUI(e.target as Element)) return;
      const hit = guideAt(e.clientX, e.clientY);
      if (!hit) return;
      press.current = { id: hit.id, x: e.clientX, y: e.clientY, moved: false };
      e.preventDefault();
    }

    function onUp(e: MouseEvent) {
      const p = press.current;
      if (!p) return;
      press.current = null;
      swallowClick.current = true;
      setMoving(false);
      if (!p.moved) setGuides((prev) => prev.filter((g) => g.id !== p.id));
      const hit = p.moved ? guideAt(e.clientX, e.clientY) : null;
      setHoveredId(hit?.id ?? null);
      setCursor(hit ? 'delete' : 'crosshair');
    }

    function onClick(e: MouseEvent) {
      if (swallowClick.current) { swallowClick.current = false; return; }
      if (isOurUI(e.target as Element) || e.clientY < TOOLBAR_H) return;
      if (guideAt(e.clientX, e.clientY)) return;
      e.preventDefault();
      e.stopPropagation();
      // Placement lands exactly where you click — no snapping.
      const h = { id: nextId.current++, axis: 'h' as const, pos: e.clientY + window.scrollY };
      const v = { id: nextId.current++, axis: 'v' as const, pos: e.clientX + window.scrollX };
      unarmed.current.add(h.id);
      unarmed.current.add(v.id);
      setGuides((prev) => [...prev, h, v]);
    }

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('click', onClick, true);
      // The tool is down: nothing is hovered or mid-drag any more. The guides themselves stay.
      press.current = null;
      setHoveredId(null);
      setMoving(false);
      setMouse({ x: -100, y: -100 });
      setCursor('crosshair');
    };
  }, [active, setCursor]);

  const line = (axis: 'h' | 'v', at: number, opacity: number): CSSProperties => (axis === 'h'
    ? { position: 'fixed', left: 0, right: 0, top: at, height: 1, transform: 'translateY(-0.5px)', background: color, opacity, pointerEvents: 'none', zIndex: 8800 }
    : { position: 'fixed', top: TOOLBAR_H, bottom: 0, left: at, width: 1, transform: 'translateX(-0.5px)', background: color, opacity, pointerEvents: 'none', zIndex: 8800 });

  const overGuide = hoveredId !== null || moving;
  const dragged = moving ? guides.find((g) => g.id === press.current?.id) : undefined;
  const onPage = active && mouse.y > TOOLBAR_H;

  // On a guide: its distance to the neighbour on each side. Otherwise: the gap the pointer is in.
  const gaps: Gap[] = [];
  if (onPage && showGaps) {
    const sx = window.scrollX, sy = window.scrollY;
    const gap = (axis: 'h' | 'v', from: number, to: number): Gap => {
      const label = `${Math.round(Math.abs(to - from))}px`;
      return axis === 'h'
        ? { x1: mouse.x, y1: from - sy, x2: mouse.x, y2: to - sy, label, avoidY: mouse.y }
        : { x1: from - sx, y1: mouse.y, x2: to - sx, y2: mouse.y, label };
    };
    const anchor = dragged ?? guides.find((g) => g.id === hoveredId);
    if (anchor) {
      const { before, after } = neighbours(guides, anchor.axis, anchor.pos, anchor.id);
      if (before) gaps.push(gap(anchor.axis, before.pos, anchor.pos));
      if (after) gaps.push(gap(anchor.axis, anchor.pos, after.pos));
    } else {
      for (const axis of ['h', 'v'] as const) {
        const { before, after } = neighbours(guides, axis, axis === 'h' ? mouse.y + sy : mouse.x + sx);
        if (before && after) gaps.push(gap(axis, before.pos, after.pos));
      }
    }
  }

  return (
    <>
      {active && (
        <Card>
          <SwitchRow label="Measure between guides" on={showGaps} onToggle={() => setShowGaps((v) => !v)} />
          <div style={{ marginTop: 6, padding: '0 2px', fontSize: 10, color: UI.textSecondary, letterSpacing: '-0.01em' }}>
            Click to place · Click a guide to delete · Drag to move
          </div>
        </Card>
      )}

      {/* Placement preview — hidden over a guide, where a click deletes instead of adding */}
      {onPage && !overGuide && (
        <>
          <div data-demo-ui="true" style={line('v', mouse.x, 0.4)} />
          <div data-demo-ui="true" style={line('h', mouse.y, 0.4)} />
        </>
      )}

      <AnimatePresence>
        {guides.map((g) => {
          const at = g.axis === 'h' ? g.pos - window.scrollY : g.pos - window.scrollX;
          const lit = g.id === hoveredId || g.id === dragged?.id;
          return (
            <motion.div
              key={g.id} data-demo-ui="true"
              exit={{ opacity: 0 }} transition={{ duration: 0.16 }}
              style={line(g.axis, at, lit ? 0.8 : 0.5) as MotionStyle}
            />
          );
        })}
      </AnimatePresence>

      {gaps.length > 0 && <GuideGaps gaps={gaps} />}

      {onPage && (
        <Chip x={mouse.x + 10} y={mouse.y - 26}>
          {dragged ? `${Math.round(dragged.pos)}px` : `${Math.round(mouse.x)}, ${Math.round(mouse.y)}`}
        </Chip>
      )}
      {active && hoveredId !== null && !moving && (
        <Chip x={mouse.x + 16} y={mouse.y + 16} style={{ fontFamily: UI.font, color: UI.textSecondary }}>
          Click to delete · Drag to move
        </Chip>
      )}
    </>
  );
}

// ─── 4. Annotate ──────────────────────────────────────────────────────────────
// The extension's Annotate mode: a size callout, notes, arrows and a pen on one
// options card. Arrows can be reshaped and end in a head, a bar, a dot or
// nothing; notes come in four handwriting faces and can be moved, turned and
// deleted; the pen lays down ink that thins with speed. Anything is removed with
// a right-click and every change undone. Marks are stored in page coordinates so
// they scroll with the content, and stay on the page when the tool is switched off.

type AnnoTool = 'size' | 'note' | 'arrow' | 'pen';
const ANNO_TOOLS: { id: AnnoTool; label: string }[] = [
  { id: 'size', label: 'Callout' }, { id: 'note', label: 'Note' }, { id: 'arrow', label: 'Arrow' }, { id: 'pen', label: 'Pen' },
];
const ANNO_KEYS: Record<string, AnnoTool> = { m: 'size', n: 'note', a: 'arrow', p: 'pen' };
const NOTE_SIZES: { id: string; label: string }[] = [{ id: '14', label: 'S' }, { id: '18', label: 'M' }, { id: '24', label: 'L' }, { id: '32', label: 'XL' }];
/** Handwriting faces: stacks of fonts that come with macOS or Windows, nothing shipped. */
const NOTE_FONTS: { id: string; label: string; stack: string }[] = [
  { id: 'hand', label: 'Hand', stack: `'Segoe Print', 'Bradley Hand', 'Comic Sans MS', 'Apple Chancery', cursive` },
  { id: 'marker', label: 'Marker', stack: `'Marker Felt', 'Ink Free', 'Comic Sans MS', cursive` },
  { id: 'neat', label: 'Neat', stack: `'Noteworthy', 'Chalkboard SE', 'MV Boli', 'Comic Sans MS', cursive` },
  { id: 'script', label: 'Script', stack: `'Snell Roundhand', 'Segoe Script', 'Brush Script MT', cursive` },
];
const fontStack = (id: string): string => (NOTE_FONTS.find((f) => f.id === id) ?? NOTE_FONTS[0]!).stack;
const PEN_SIZES: { id: string; label: string }[] = [{ id: '3', label: 'S' }, { id: '5', label: 'M' }, { id: '8', label: 'L' }, { id: '13', label: 'XL' }];
type EndKind = 'none' | 'arrow' | 'bar' | 'dot';
const ARROW_ENDS: { id: EndKind; label: string }[] = [
  { id: 'none', label: 'None' }, { id: 'arrow', label: 'Arrow' }, { id: 'bar', label: 'Bar' }, { id: 'dot', label: 'Dot' },
];
/** A fresh note leans a little, like handwriting. */
const DEFAULT_NOTE_ANGLE = -1.5;
const NOTE_STYLE: CSSProperties = {
  fontWeight: 600, lineHeight: 1.25, letterSpacing: 'normal',
  textShadow: '0 1px 0 rgba(255,255,255,0.85)', transformOrigin: '0 0',
};
const ANNO_HINT: Record<AnnoTool, string> = {
  size: 'Click an element to mark its width and height',
  note: 'Click to write · Drag to move · Handle turns it',
  arrow: 'Drag to draw · Drag a handle to reshape',
  pen: 'Drag to draw · Shift for a straight line',
};

/** The undo shortcut as this visitor would press it. Only read in the browser: the card renders after a click. */
const UNDO_KEYS = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ Z' : 'Ctrl + Z';

const HANDLE_HIT = 9;
const HIT_SLOP = 8;
/** A bend this close to the straight line snaps back to straight. */
const STRAIGHTEN_WITHIN = 6;
const ANGLE_STEP = Math.PI / 12;
const NOTE_DELETE_R = 8;
const NOTE_PAD = 4;
const NOTE_ROTATE_R = 5;
/** How far above the note's top edge the rotate handle sits. */
const NOTE_ROTATE_OFFSET = 14;

interface Pt { x: number; y: number }
type ArrowMark = { id: number; color: string; kind: 'arrow'; from: Pt; to: Pt; bend: Pt | null; start: EndKind; end: EndKind };
type NoteMark = { id: number; color: string; kind: 'note'; at: Pt; text: string; size: number; font: string; angle: number };
type PenMark = { id: number; color: string; kind: 'pen'; points: Pt[]; size: number };
type Mark =
  | { id: number; color: string; kind: 'size'; box: Box }
  | PenMark
  | ArrowMark
  | NoteMark;
type ArrowPart = 'start' | 'end' | 'bend' | 'body';

const chordMid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Control point of the quadratic curve that passes through `bend` at its midpoint. */
function controlPoint(a: Pt, b: Pt, bend: Pt | null): Pt {
  const m = chordMid(a, b);
  return bend ? { x: 2 * bend.x - m.x, y: 2 * bend.y - m.y } : m;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distToPath(p: Pt, points: Pt[]): number {
  // A dot is a path of one point.
  if (points.length === 1) return Math.hypot(p.x - points[0]!.x, p.y - points[0]!.y);
  let best = Infinity;
  for (let i = 1; i < points.length; i++) best = Math.min(best, distToSegment(p, points[i - 1]!, points[i]!));
  return best;
}

function arrowPoints(m: ArrowMark): Pt[] {
  if (!m.bend) return [m.from, m.to];
  const c = controlPoint(m.from, m.to, m.bend);
  return Array.from({ length: 21 }, (_, i) => {
    const t = i / 20;
    const u = 1 - t;
    return { x: u * u * m.from.x + 2 * u * t * c.x + t * t * m.to.x, y: u * u * m.from.y + 2 * u * t * c.y + t * t * m.to.y };
  });
}

/** Which part of an arrow a point is on, if any. Handles win over the body. */
function arrowPartAt(m: ArrowMark, p: Pt): ArrowPart | null {
  const near = (q: Pt): boolean => Math.hypot(q.x - p.x, q.y - p.y) <= HANDLE_HIT;
  if (near(m.to)) return 'end';
  if (near(m.from)) return 'start';
  if (near(m.bend ?? chordMid(m.from, m.to))) return 'bend';
  return distToPath(p, arrowPoints(m)) <= HIT_SLOP ? 'body' : null;
}

/** Keep the distance, round the direction to the nearest 15°. */
function lockAngle(from: Pt, to: Pt): Pt {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / ANGLE_STEP) * ANGLE_STEP;
  return { x: from.x + Math.cos(angle) * len, y: from.y + Math.sin(angle) * len };
}

const shift = (p: Pt, dx: number, dy: number): Pt => ({ x: p.x + dx, y: p.y + dy });

/** A note's box before rotation and the angle (radians) it is turned by about its top-left corner. */
interface NoteBox { x: number; y: number; w: number; h: number; angle: number }

/** A point in the note's own unrotated space, origin at its top-left corner. */
function toNoteSpace(b: NoteBox, x: number, y: number): Pt {
  const dx = x - b.x, dy = y - b.y;
  const cos = Math.cos(b.angle), sin = Math.sin(b.angle);
  return { x: dx * cos + dy * sin, y: dy * cos - dx * sin };
}

function fromNoteSpace(b: NoteBox, x: number, y: number): Pt {
  const cos = Math.cos(b.angle), sin = Math.sin(b.angle);
  return { x: b.x + x * cos - y * sin, y: b.y + x * sin + y * cos };
}

/** Centre of the delete button: just outside the note's top-right corner, kept on screen. */
function noteDeleteCentre(b: NoteBox): Pt {
  const c = fromNoteSpace(b, b.w + 6, -2);
  return { x: Math.min(c.x, window.innerWidth - NOTE_DELETE_R - 2), y: Math.max(c.y, TOOLBAR_H + NOTE_DELETE_R + 2) };
}

/** Finished strokes never change, so each outline is worked out once. */
const inkCache = new WeakMap<Pt[], string>();
function inkOf(mark: PenMark): string {
  let d = inkCache.get(mark.points);
  if (d === undefined) {
    d = inkPathData(mark.points, mark.size);
    inkCache.set(mark.points, d);
  }
  return d;
}

/** One end of an arrow at `tip`, facing away from `from`, as path data. Dots are drawn separately. */
function arrowEnd(kind: EndKind, tip: Pt, from: Pt): string {
  if (kind === 'none' || kind === 'dot') return '';
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  if (kind === 'bar') {
    const nx = -Math.sin(a) * 6, ny = Math.cos(a) * 6;
    return `M${tip.x - nx} ${tip.y - ny}L${tip.x + nx} ${tip.y + ny}`;
  }
  const wing = (spread: number): string => `${tip.x - 12 * Math.cos(a + spread)} ${tip.y - 12 * Math.sin(a + spread)}`;
  return `M${wing(-0.5)}L${tip.x} ${tip.y}L${wing(0.5)}`;
}

function MarkShape({ mark, handles = false, drafting = false }: { mark: Exclude<Mark, NoteMark>; handles?: boolean; drafting?: boolean }) {
  const c = mark.color;
  // White marks need an edge to show on a light page.
  const edge = c === '#FFFFFF' ? { filter: 'drop-shadow(0 0 0.75px rgba(0,0,0,0.55))' } : undefined;
  if (mark.kind === 'size') {
    const { x, y, w, h } = mark.box;
    return (
      <g stroke={c} fill="none" strokeLinecap="round" style={edge}>
        <rect x={x} y={y} width={w} height={h} rx="3" fill={c} fillOpacity="0.12" strokeWidth="1.5" />
        <path d={`M${x} ${y - 10}H${x + w}M${x} ${y - 14}v8M${x + w} ${y - 14}v8M${x - 10} ${y}V${y + h}M${x - 14} ${y}h8M${x - 14} ${y + h}h8`} strokeWidth="1.25" />
        <g fill={c} stroke="none" fontFamily={UI.mono} fontSize="11" fontWeight="600">
          <text x={x + w / 2} y={y - 16} textAnchor="middle">{Math.round(w)}</text>
          <text x={x - 16} y={y + h / 2 + 4} textAnchor="end">{Math.round(h)}</text>
        </g>
      </g>
    );
  }
  if (mark.kind === 'pen') {
    // Ink is a filled outline, not a stroked line; a stroke still under the pen has no tapered end yet.
    return <path d={drafting ? inkPathData(mark.points, mark.size, false) : inkOf(mark)} fill={c} stroke="none" style={edge} />;
  }
  const { from, to, bend, start, end } = mark;
  const ctrl = controlPoint(from, to, bend);
  // Each end faces the direction the shaft arrives from, straight or curved.
  const ends = arrowEnd(end, to, bend ? ctrl : from) + arrowEnd(start, from, bend ? ctrl : to);
  const mid = bend ?? chordMid(from, to);
  return (
    <g stroke={c} strokeWidth="2.25" fill="none" strokeLinecap="round" strokeLinejoin="round" style={edge}>
      <path d={`M${from.x} ${from.y}Q${ctrl.x} ${ctrl.y} ${to.x} ${to.y}${ends}`} />
      {end === 'dot' && <circle cx={to.x} cy={to.y} r="3.5" fill={c} stroke="none" />}
      {start === 'dot' && <circle cx={from.x} cy={from.y} r="3.5" fill={c} stroke="none" />}
      {handles && (
        <g strokeWidth="1.5">
          <circle cx={from.x} cy={from.y} r="4.5" fill="#fff" />
          <circle cx={to.x} cy={to.y} r="4.5" fill="#fff" />
          {/* Filled once the arrow is bent, hollow while it is still straight */}
          <circle cx={mid.x} cy={mid.y} r="3.5" fill={bend ? c : '#fff'} />
        </g>
      )}
    </g>
  );
}

/** A row of tabs with the pill that slides to the active one. */
function Tabs<T extends string>({ label, items, value, onChange }: {
  label: string; items: { id: T; label: string; style?: CSSProperties }[]; value: T; onChange: (id: T) => void;
}) {
  const reduce = useReducedMotion();
  const n = items.length;
  const idx = Math.max(0, items.findIndex((i) => i.id === value));
  return (
    <div role="group" aria-label={label} style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${n}, 1fr)`, background: UI.track, borderRadius: 7, padding: 2 }}>
      <div style={{
        position: 'absolute', top: 2, bottom: 2, left: 2, width: `calc((100% - 4px) / ${n})`, transform: `translateX(${idx * 100}%)`,
        background: UI.bg, borderRadius: 5, boxShadow: UI.shadowPill, pointerEvents: 'none', transition: reduce ? 'none' : `transform 0.22s ${UI.easeMove}`,
      }} />
      {items.map((item) => (
        <button
          key={item.id} type="button" aria-pressed={item.id === value} onClick={() => onChange(item.id)}
          style={{
            position: 'relative', zIndex: 1, height: 24, padding: 0, border: 'none', borderRadius: 5, background: 'transparent', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 10, fontWeight: 500, letterSpacing: '-0.01em',
            color: item.id === value ? UI.textPrimary : UI.textSecondary, transition: reduce ? 'none' : `color 0.22s ${UI.easeMove}`,
            ...item.style,
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** A group of card rows that is only there for the tool it belongs to. */
function ToolRows({ show, children }: { show: boolean; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <div style={{ display: 'grid', gridTemplateRows: show ? '1fr' : '0fr', transition: reduce ? 'none' : `grid-template-rows 0.2s ${UI.easeOut}` }}>
      <div style={{ overflow: 'hidden', minHeight: 0 }}>{children}</div>
    </div>
  );
}

type AnnoDrag =
  | { kind: 'arrow'; id: number; part: ArrowPart; last: Pt; moved: boolean; before: Mark[] }
  | { kind: 'note'; id: number; last: Pt; moved: boolean; before: Mark[] }
  /** `centre` is in page space; `from` is the pointer's direction from it when the drag began. */
  | { kind: 'rotate'; id: number; centre: Pt; from: number; startAngle: number; half: Pt; moved: boolean; before: Mark[] };

function AnnotateOverlay({ active, setCursor }: { active: boolean; setCursor: (c: DemoCursor) => void }) {
  useViewportTick();
  const { color } = useDemo();
  const [tool, setTool] = useState<AnnoTool>('size');
  const [noteSize, setNoteSize] = useState(18);
  const [noteFont, setNoteFont] = useState(NOTE_FONTS[0]!.id);
  const [penSize, setPenSize] = useState(5);
  const [ends, setEnds] = useState<{ start: EndKind; end: EndKind }>({ start: 'none', end: 'arrow' });
  const [marks, setMarks] = useState<Mark[]>([]);
  const [hover, setHover] = useState<Box | null>(null);
  const [draft, setDraft] = useState<Exclude<Mark, NoteMark> | null>(null);
  const [editing, setEditing] = useState<{ at: Pt; text: string } | null>(null);
  /** The arrow or note under the pointer, which is the one a press would grab. */
  const [activeId, setActiveId] = useState<number | null>(null);
  const [overDelete, setOverDelete] = useState(false);
  const [overRotate, setOverRotate] = useState(false);
  const nextId = useRef(0);
  const history = useRef<Mark[][]>([]);
  const drag = useRef<AnnoDrag | null>(null);
  /** The click that ends a drag or a delete must not also start a new note. */
  const swallowClick = useRef(false);
  const noteEls = useRef(new Map<number, HTMLDivElement>());
  // The listeners are attached once and read the latest values from here.
  const live = useRef({ tool, color, noteSize, penSize, ends, marks, draft, editing, activeId });
  live.current = { tool, color, noteSize, penSize, ends, marks, draft, editing, activeId };

  /** Where a note sits on screen right now, unrotated, and how far it is turned. */
  const noteBox = (m: NoteMark): NoteBox | null => {
    const el = noteEls.current.get(m.id);
    if (!el) return null;
    return { x: m.at.x - window.scrollX, y: m.at.y - window.scrollY, w: el.offsetWidth, h: el.offsetHeight, angle: (m.angle * Math.PI) / 180 };
  };

  useEffect(() => {
    if (!active) return;
    setCursor(tool === 'note' ? 'ibeam' : tool === 'pen' ? 'pen' : 'crosshair');
    setHover(null);
    setActiveId(null);
    setOverDelete(false);
    setOverRotate(false);
  }, [active, tool, setCursor]);

  useEffect(() => {
    if (!active) return;
    const page = (e: MouseEvent): Pt => ({ x: e.clientX + window.scrollX, y: e.clientY + window.scrollY });
    const onPage = (e: MouseEvent): boolean => !isOurUI(e.target as Element) && e.clientY >= TOOLBAR_H;
    /** Every change goes through here so it can be undone. */
    const change = (next: Mark[], before: Mark[] = live.current.marks): void => {
      history.current = [...history.current.slice(-49), before];
      setMarks(next);
    };
    const add = (mark: Mark): void => change([...live.current.marks, mark]);
    const baseCursor = (): DemoCursor => (live.current.tool === 'note' ? 'ibeam' : live.current.tool === 'pen' ? 'pen' : 'crosshair');

    const noteAt = (x: number, y: number): NoteMark | null => {
      const all = live.current.marks;
      for (let i = all.length - 1; i >= 0; i--) {
        const m = all[i]!;
        if (m.kind !== 'note') continue;
        const b = noteBox(m);
        if (!b) continue;
        const p = toNoteSpace(b, x, y);
        if (p.x >= -NOTE_PAD && p.x <= b.w + NOTE_PAD && p.y >= -NOTE_PAD && p.y <= b.h + NOTE_PAD) return m;
      }
      return null;
    };
    const arrowAt = (p: Pt): { mark: ArrowMark; part: ArrowPart } | null => {
      const all = live.current.marks;
      for (let i = all.length - 1; i >= 0; i--) {
        const m = all[i]!;
        if (m.kind !== 'arrow') continue;
        const part = arrowPartAt(m, p);
        if (part) return { mark: m, part };
      }
      return null;
    };
    /** Whatever is under the pointer, of any kind — what a right-click removes. */
    const markAt = (e: MouseEvent): Mark | null => {
      const p = page(e);
      const note = noteAt(e.clientX, e.clientY);
      if (note) return note;
      const all = live.current.marks;
      for (let i = all.length - 1; i >= 0; i--) {
        const m = all[i]!;
        if (m.kind === 'arrow' && arrowPartAt(m, p)) return m;
        if (m.kind === 'pen' && distToPath(p, m.points) <= HIT_SLOP) return m;
        if (m.kind === 'size' && p.x >= m.box.x && p.x <= m.box.x + m.box.w && p.y >= m.box.y && p.y <= m.box.y + m.box.h) return m;
      }
      return null;
    };
    const activeNote = (): { mark: NoteMark; box: NoteBox } | null => {
      const mark = live.current.marks.find((m): m is NoteMark => m.kind === 'note' && m.id === live.current.activeId);
      const box = mark ? noteBox(mark) : null;
      return mark && box ? { mark, box } : null;
    };
    /** Is the pointer on the active note's delete button or rotate handle? Both sit outside its box. */
    const noteControl = (e: MouseEvent): 'delete' | 'rotate' | null => {
      const a = activeNote();
      if (!a) return null;
      const d = noteDeleteCentre(a.box);
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) <= NOTE_DELETE_R + 3) return 'delete';
      const r = fromNoteSpace(a.box, a.box.w / 2, -NOTE_ROTATE_OFFSET);
      // Reaches down to the outline, so the note stays active on the way to the handle.
      return Math.hypot(e.clientX - r.x, e.clientY - r.y) <= NOTE_ROTATE_OFFSET - NOTE_PAD + 1 ? 'rotate' : null;
    };

    function onMove(e: MouseEvent) {
      const p = page(e);
      const d = drag.current;
      if (d?.kind === 'rotate') {
        // Turn the note about its centre to follow the pointer; Shift locks to 15° steps.
        let deg = d.startAngle + ((Math.atan2(p.y - d.centre.y, p.x - d.centre.x) - d.from) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        deg = Math.round((((((deg + 180) % 360) + 360) % 360) - 180) * 10) / 10;
        const rad = (deg * Math.PI) / 180;
        // The note turns about its top-left corner, so that corner moves to keep the centre still.
        const at = { x: d.centre.x - (d.half.x * Math.cos(rad) - d.half.y * Math.sin(rad)), y: d.centre.y - (d.half.x * Math.sin(rad) + d.half.y * Math.cos(rad)) };
        d.moved = true;
        setMarks((prev) => prev.map((m) => (m.id === d.id && m.kind === 'note' ? { ...m, angle: deg, at } : m)));
        return;
      }
      if (d) {
        const dx = p.x - d.last.x;
        const dy = p.y - d.last.y;
        if (dx === 0 && dy === 0) return;
        d.last = p;
        d.moved = true;
        setMarks((prev) => prev.map((m) => {
          if (m.id !== d.id) return m;
          if (m.kind === 'note') return { ...m, at: shift(m.at, dx, dy) };
          if (m.kind !== 'arrow' || d.kind !== 'arrow') return m;
          if (d.part === 'body') return { ...m, from: shift(m.from, dx, dy), to: shift(m.to, dx, dy), bend: m.bend && shift(m.bend, dx, dy) };
          if (d.part === 'bend') {
            const mid = chordMid(m.from, m.to);
            return { ...m, bend: Math.hypot(p.x - mid.x, p.y - mid.y) <= STRAIGHTEN_WITHIN ? null : p };
          }
          // Shift keeps a straight arrow on a 15° step while an end is dragged.
          const lock = e.shiftKey && !m.bend;
          return d.part === 'start' ? { ...m, from: lock ? lockAngle(m.to, p) : p } : { ...m, to: lock ? lockAngle(m.from, p) : p };
        }));
        return;
      }

      const dr = live.current.draft;
      if (dr?.kind === 'arrow') { setDraft({ ...dr, to: e.shiftKey ? lockAngle(dr.from, p) : p }); return; }
      // Shift rules a straight line from where the stroke began.
      if (dr?.kind === 'pen') { setDraft({ ...dr, points: e.shiftKey ? [dr.points[0]!, p] : [...dr.points, p] }); return; }

      const t = live.current.tool;
      const on = onPage(e);
      if (t === 'size') {
        const el = on ? getTarget(e.clientX, e.clientY) : null;
        setHover(el ? toBox(el.getBoundingClientRect()) : null);
      } else if (t === 'arrow') {
        const hit = on ? arrowAt(p) : null;
        setActiveId(hit?.mark.id ?? null);
        setCursor(hit ? 'grab' : 'crosshair');
      } else if (t === 'note') {
        // The controls sit outside the note's box, so check them first to keep the note active.
        const ctl = on ? noteControl(e) : null;
        const id = ctl ? live.current.activeId : on ? noteAt(e.clientX, e.clientY)?.id ?? null : null;
        setActiveId(id);
        setOverDelete(ctl === 'delete');
        setOverRotate(ctl === 'rotate');
        setCursor(ctl === 'delete' ? 'delete' : id !== null ? 'grab' : 'ibeam');
      }
    }

    function onDown(e: MouseEvent) {
      swallowClick.current = false;
      if (e.button !== 0 || !onPage(e)) return;
      const { tool: t, color: c, marks: all } = live.current;
      const p = page(e);

      if (t === 'note') {
        const ctl = noteControl(e);
        if (ctl === 'delete') {
          change(all.filter((m) => m.id !== live.current.activeId));
          setActiveId(null);
          setOverDelete(false);
          setCursor('ibeam');
          swallowClick.current = true;
          e.preventDefault();
          return;
        }
        const a = ctl === 'rotate' ? activeNote() : null;
        if (a) {
          const c0 = fromNoteSpace(a.box, a.box.w / 2, a.box.h / 2);
          const centre = { x: c0.x + window.scrollX, y: c0.y + window.scrollY };
          drag.current = {
            kind: 'rotate', id: a.mark.id, centre, from: Math.atan2(p.y - centre.y, p.x - centre.x), startAngle: a.mark.angle,
            half: { x: a.box.w / 2, y: a.box.h / 2 }, moved: false, before: all,
          };
          swallowClick.current = true;
          e.preventDefault();
          return;
        }
        const note = noteAt(e.clientX, e.clientY);
        if (note) {
          drag.current = { kind: 'note', id: note.id, last: p, moved: false, before: all };
          swallowClick.current = true;
          e.preventDefault();
        }
        return;
      }
      if (t !== 'arrow' && t !== 'pen') return;
      // Stops the drag from selecting text on the page underneath.
      e.preventDefault();
      const hit = t === 'arrow' ? arrowAt(p) : null;
      if (hit) {
        drag.current = { kind: 'arrow', id: hit.mark.id, part: hit.part, last: p, moved: false, before: all };
        return;
      }
      setDraft(t === 'arrow'
        ? { id: nextId.current++, color: c, kind: 'arrow', from: p, to: p, bend: null, ...live.current.ends }
        : { id: nextId.current++, color: c, kind: 'pen', points: [p], size: live.current.penSize });
    }

    function onUp() {
      const d = drag.current;
      if (d) {
        drag.current = null;
        // One undo step for the whole drag, however far it went.
        if (d.moved) history.current = [...history.current.slice(-49), d.before];
        return;
      }
      const dr = live.current.draft;
      if (!dr) return;
      setDraft(null);
      // An arrow needs some length; a pen press that never moved leaves a dot.
      if (dr.kind === 'arrow' && Math.hypot(dr.to.x - dr.from.x, dr.to.y - dr.from.y) > 6) add(dr);
      if (dr.kind === 'pen') add(dr);
    }

    function onClick(e: MouseEvent) {
      if (!onPage(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (swallowClick.current) { swallowClick.current = false; return; }
      const { tool: t, color: c } = live.current;
      if (t === 'size') {
        const el = getTarget(e.clientX, e.clientY);
        if (!el) return;
        const r = el.getBoundingClientRect();
        add({ id: nextId.current++, color: c, kind: 'size', box: { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height } });
      } else if (t === 'note') {
        // A note still being written is saved by its own blur before this runs.
        setEditing({ at: page(e), text: '' });
      }
    }

    function onContext(e: MouseEvent) {
      if (!onPage(e)) return;
      const hit = markAt(e);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      change(live.current.marks.filter((m) => m.id !== hit.id));
      setActiveId(null);
      setOverDelete(false);
      setOverRotate(false);
      setCursor(baseCursor());
    }

    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (live.current.editing || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        const before = history.current.pop();
        if (before) setMarks(before);
        return;
      }
      const next = !e.metaKey && !e.ctrlKey && !e.altKey ? ANNO_KEYS[e.key.toLowerCase()] : undefined;
      if (next) setTool(next);
    }

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('click', onClick, true);
    window.addEventListener('contextmenu', onContext, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('contextmenu', onContext, true);
      window.removeEventListener('keydown', onKey);
      // The tool is down: nothing is half-drawn, hovered or held any more. The marks themselves stay.
      drag.current = null;
      setDraft(null);
      setEditing(null);
      setHover(null);
      setActiveId(null);
      setOverDelete(false);
      setOverRotate(false);
      setCursor('crosshair');
    };
    // `noteBox` only reads refs and the live scroll position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, setCursor]);

  const finishNote = (keep: boolean): void => {
    const text = editing?.text.trim();
    if (keep && editing && text) {
      history.current = [...history.current.slice(-49), marks];
      setMarks([...marks, { id: nextId.current++, color, kind: 'note', at: editing.at, text, size: noteSize, font: noteFont, angle: DEFAULT_NOTE_ANGLE }]);
    }
    setEditing(null);
  };

  const sx = window.scrollX;
  const sy = window.scrollY;
  // Read after layout so the outline sits on the note where it is now, including mid-drag.
  const activeMark = active && tool === 'note' ? marks.find((m): m is NoteMark => m.kind === 'note' && m.id === activeId) : undefined;
  const activeBox = activeMark ? noteBox(activeMark) : null;
  const deleteAt = activeBox ? noteDeleteCentre(activeBox) : null;
  const whiteEdge = (c: string): string | undefined => (c === '#FFFFFF' ? 'drop-shadow(0 0 0.75px rgba(0,0,0,0.6))' : undefined);
  const rowLabel: CSSProperties = { width: 30, flexShrink: 0, fontSize: 11, color: UI.textSecondary, letterSpacing: '-0.01em' };

  return (
    <>
      {/* Options card: the same tabs and rows as the extension. The colour is picked on the toolbar. */}
      {active && (
        <Card>
          <Tabs label="Annotation tool" items={ANNO_TOOLS} value={tool} onChange={setTool} />

          {/* Each tool's own settings appear only while it is the tool */}
          <ToolRows show={tool === 'note'}>
            <div style={{ paddingTop: 8 }}>
              <Tabs label="Note size" items={NOTE_SIZES} value={String(noteSize)} onChange={(id) => setNoteSize(Number(id))} />
            </div>
            {/* Each face is named in itself, so the choice can be seen before it is made */}
            <div style={{ paddingTop: 6 }}>
              <Tabs
                label="Note font" value={noteFont} onChange={setNoteFont}
                items={NOTE_FONTS.map((f) => ({ id: f.id, label: f.label, style: { fontFamily: f.stack, fontSize: 12, fontWeight: 600 } }))}
              />
            </div>
          </ToolRows>

          <ToolRows show={tool === 'arrow'}>
            {(['start', 'end'] as const).map((side) => (
              <div key={side} style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: side === 'start' ? 8 : 6 }}>
                <span style={rowLabel}>{side === 'start' ? 'Start' : 'End'}</span>
                <div style={{ flex: 1 }}>
                  <Tabs label={`Arrow ${side}`} items={ARROW_ENDS} value={ends[side]} onChange={(id) => setEnds((prev) => ({ ...prev, [side]: id }))} />
                </div>
              </div>
            ))}
          </ToolRows>

          <ToolRows show={tool === 'pen'}>
            <div style={{ paddingTop: 8 }}>
              <Tabs label="Pen width" items={PEN_SIZES} value={String(penSize)} onChange={(id) => setPenSize(Number(id))} />
            </div>
          </ToolRows>

          <div style={{ marginTop: 10, fontSize: 10, color: UI.textSecondary, letterSpacing: '-0.01em' }}>
            <div>{ANNO_HINT[tool]}</div>
            <div>Right-click deletes · {UNDO_KEYS} undoes</div>
          </div>
        </Card>
      )}

      {/* Everything drawn so far, plus the stroke in progress */}
      <svg
        data-demo-ui="true" aria-hidden="true"
        style={{ position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh', overflow: 'visible', pointerEvents: 'none', zIndex: 8850 }}
      >
        <g transform={`translate(${-sx} ${-sy})`}>
          {marks.map((m) => (m.kind === 'note' ? null : <MarkShape key={m.id} mark={m} handles={active && tool === 'arrow' && m.id === activeId} />))}
          {draft && <MarkShape mark={draft} drafting />}
        </g>
      </svg>

      {/* Notes are text on the page, with no box around them */}
      {marks.map((m) => (m.kind !== 'note' ? null : (
        <div
          key={m.id} data-demo-ui="true"
          ref={(el) => { if (el) noteEls.current.set(m.id, el); else noteEls.current.delete(m.id); }}
          style={{
            ...NOTE_STYLE, position: 'fixed', left: m.at.x - sx, top: m.at.y - sy, zIndex: 8860, maxWidth: 240,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', pointerEvents: 'none', color: m.color, fontSize: m.size,
            fontFamily: fontStack(m.font), transform: `rotate(${m.angle}deg)`, filter: whiteEdge(m.color),
          }}
        >
          {m.text}
        </div>
      )))}

      {/* The note you would move: outlined as it is turned, with a handle that rotates it and a delete button on the corner */}
      {activeBox && deleteAt && (
        <svg data-demo-ui="true" aria-hidden="true" style={{ position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh', overflow: 'visible', pointerEvents: 'none', zIndex: 8870 }}>
          <g transform={`translate(${activeBox.x} ${activeBox.y}) rotate(${(activeBox.angle * 180) / Math.PI})`} fill="none">
            <rect x={-NOTE_PAD} y={-NOTE_PAD} width={activeBox.w + NOTE_PAD * 2} height={activeBox.h + NOTE_PAD * 2} rx="4" stroke={tint(color, 0.6)} strokeDasharray="4 3" />
            <path d={`M${activeBox.w / 2} ${-NOTE_PAD}V${-NOTE_ROTATE_OFFSET + NOTE_ROTATE_R}`} stroke={tint(color, 0.6)} />
            <circle cx={activeBox.w / 2} cy={-NOTE_ROTATE_OFFSET} r={overRotate ? NOTE_ROTATE_R + 1 : NOTE_ROTATE_R} fill="#fff" stroke={color} strokeWidth="1.5" />
          </g>
          <g transform={`translate(${deleteAt.x} ${deleteAt.y})`}>
            <circle r={overDelete ? NOTE_DELETE_R + 1 : NOTE_DELETE_R} fill={color} stroke="#fff" strokeWidth="1.5" />
            <path d="M-2.75 -2.75L2.75 2.75M2.75 -2.75L-2.75 2.75" stroke={onColor(color)} strokeWidth="1.5" strokeLinecap="round" />
          </g>
        </svg>
      )}

      {active && tool === 'size' && hover && (
        <>
          <ElementHighlight box={hover} />
          <Chip x={hover.x} y={Math.max(TOOLBAR_H + 4, hover.y - 26)}>{dims({ width: hover.w, height: hover.h })}</Chip>
        </>
      )}

      {active && editing && (
        <input
          data-demo-ui="true" autoFocus name="note" autoComplete="off" aria-label="Note text" value={editing.text} spellCheck={false} placeholder="Write a note…"
          size={Math.max(12, editing.text.length + 1)}
          onChange={(e) => setEditing({ at: editing.at, text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finishNote(true);
            else if (e.key === 'Escape') finishNote(false);
          }}
          onBlur={() => finishNote(true)}
          style={{
            ...NOTE_STYLE, position: 'fixed', left: editing.at.x - sx, top: editing.at.y - sy, zIndex: 8900,
            margin: 0, padding: 0, border: 'none', outline: 'none', background: 'transparent', color, caretColor: color, fontSize: noteSize,
            fontFamily: fontStack(noteFont), transform: `rotate(${DEFAULT_NOTE_ANGLE}deg)`,
          }}
        />
      )}
    </>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function DemoOverlay() {
  const demo = useDemo();
  return (
    <>
      {/* Hover states for the details panel, and the text highlight in the mark colour */}
      <style>{`
        .demo-row { transition: background 0.1s ease; }
        .demo-row:hover { background: ${UI.hover}; }
        ::highlight(${HIGHLIGHT_NAME}) { background-color: ${demo.color}; color: ${onColor(demo.color)}; }
      `}</style>
      {demo.inspect && <InspectOverlay setCursor={demo.setCursor} />}
      {demo.measure && <MeasureOverlay setCursor={demo.setCursor} />}
      {/* Guides and annotations stay on the page while the demo is open, whichever tool is on,
          and with none on: the page is browsed as usual with the marks still drawn. */}
      {demo.isOpen && <GuidesOverlay active={demo.guides} setCursor={demo.setCursor} />}
      {demo.isOpen && <AnnotateOverlay active={demo.annotate} setCursor={demo.setCursor} />}
    </>
  );
}
