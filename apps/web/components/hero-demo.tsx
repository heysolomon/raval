'use client';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, type MotionStyle } from 'framer-motion';
import { Geist, Geist_Mono } from 'next/font/google';

/**
 * A scripted simulation of someone using the extension, played in a mock macOS
 * browser window. Nothing here is a video: a fake cursor follows a timeline and
 * visual copies of the real UI react to it — hover states, cursor changes,
 * panels, toasts — then it loops. The interactive demo (the "View demo"
 * button) is separate and lets visitors try the tools on this page themselves.
 *
 * The page in the window is Vercel's real pricing page, rebuilt from its live
 * layout and styles (measured at vercel.com/pricing) and drawn at VS of its real
 * size, so what Raval reads out is what it would read there. The window is a
 * corner bleed: inset from the stage's top and left, running off its right and
 * bottom, past the Pro plan. Where the wide stage would be drawn smaller than
 * MIN_SCALE, a compact design takes over: Vercel's own single-column layout at
 * 840px, cropped, with the toolbar centred on the part shown.
 *
 * Coordinates are page coordinates: VS × Vercel's px, from the top of the bar.
 */

/** The width the toolbar's own geometry was laid out against; it centres on W / 2. */
const W = 640;
/** Height of the browser's title bar. */
const BAR = 38;
/** The page was laid out against a 28px bar; this shifts it under the real one. */
const SHIFT = BAR - 28;
const H = 400 + SHIFT;
/** Vercel's page is drawn at this share of its real size. */
const VS = 0.805;
/** Where the browser's viewport starts, under the bar, in page coordinates. */
const VY = 28;
/** How much of the window is drawn below the bar, past the stage's crop. */
const PAGE_H = 560;
/** The window's inset from the stage's top and left: the one gutter. */
const INSET = 36;
const STAGE_W = 736;
/** The wide stage is never drawn smaller than this; below it the compact design is used. */
const MIN_SCALE = 0.8;
/** The compact design: a smaller gutter, and a stage that ends just past the second card. */
const COMPACT_INSET = 16;
const COMPACT_W = 440;

const ACCENT = '#FF4500';
const MONO = `'JetBrains Mono', 'SF Mono', ui-monospace, monospace`;
const SANS = `'Neue Plak Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
const SYSTEM = `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif`;
const BORDER = 'rgba(0, 0, 0, 0.08)';
const SHADOW_SM = '0 1px 2px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.04)';
const SHADOW = '0 1px 2px rgba(0, 0, 0, 0.04), 0 6px 20px rgba(0, 0, 0, 0.06)';
const SPRING = { type: 'spring', stiffness: 1000, damping: 63, mass: 1 } as const;
const EASE_IN_OUT = [0.645, 0.045, 0.355, 1] as const;
/** How a hand travels, and the camera with it: away, across, and a soft arrival. */
const TRAVEL = [0.45, 0, 0.1, 1] as const;

/** Vercel's own type, so the page reads as theirs and Inspect reads out what is really there. */
const geist = Geist({ subsets: ['latin'] });
const geistMono = Geist_Mono({ subsets: ['latin'] });

// ─── Tuning ───────────────────────────────────────────────────────────────────
// Everything about the demo that is a matter of taste rather than structure: how
// fast it plays, how long it rests on each thing worth looking at, and the small
// optical corrections. These are the values the site ships with. In development
// the panel on /record edits them live and copies out what was changed, to be
// written back here.

export const HERO_TUNING = {
  /** Below 1 plays the whole script faster. */
  pace: 0.78,
  /** Multiplies how long the cursor takes to travel between things. */
  travel: 1,
  /** Seconds the demo rests on each beat before moving on. */
  hold: {
    sized: 0.8,
    typography: 1.6,
    measured: 2,
  },
  /**
   * Small labels are centred on their capitals by FineText. These are optical corrections on top,
   * in stage pixels, positive is down: `caps` for capitals-only ones (HEX), `badgeY` for the measure
   * badges' letters. Flex centres a glyph by its advance width, not its ink, so `badgeBX` moves the
   * B sideways.
   */
  nudge: { caps: 0, badgeY: 0, badgeBX: -0.26 },
};

export type HeroTuning = typeof HERO_TUNING;
/** Any subset of the settings, as the tuning panel copies them out. */
export type HeroTuningPatch = { [K in keyof HeroTuning]?: HeroTuning[K] extends object ? Partial<HeroTuning[K]> : HeroTuning[K] };

/** The shipped settings with a patch laid over them. Unknown keys and non-numbers are ignored. */
export function mergeTuning(patch: HeroTuningPatch | undefined): HeroTuning {
  if (!patch) return HERO_TUNING;
  const out = structuredClone(HERO_TUNING) as unknown as Record<string, number | Record<string, number>>;
  const given = patch as Record<string, unknown>;
  for (const [key, base] of Object.entries(HERO_TUNING)) {
    const value = given[key];
    if (typeof base === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    } else if (value && typeof value === 'object') {
      const group = out[key] as Record<string, number>;
      for (const inner of Object.keys(base)) {
        const v = (value as Record<string, unknown>)[inner];
        if (typeof v === 'number' && Number.isFinite(v)) group[inner] = v;
      }
    }
  }
  return out as unknown as HeroTuning;
}

const Tune = createContext<HeroTuning>(HERO_TUNING);

/** Small text is laid out this many times larger and scaled down. */
const FINE = 4;
/**
 * How far Neue Plak's capitals sit above the middle of a line-height:1 box, in em: its ascent
 * is 0.77em, descent 0.23em and capitals 0.706em tall, so their middle is at
 * (0.77 − 0.23) / 2 − 0.706 / 2 = −0.083em.
 */
const CAP_RISE = 0.083;

/**
 * A short label centred on its capitals in whatever box it sits in. At 7.5px the browser rounds
 * the font's ascent and descent to whole pixels, so plain text lands up to a pixel off, and by a
 * different amount at each zoom level. Laid out at FINE× its size and scaled down, that rounding
 * shrinks to a fraction of a pixel. `dy` and `dx` are optical corrections in stage pixels.
 */
function FineText({ size, dy = 0, dx = 0, children }: { size: number; dy?: number; dx?: number; children: ReactNode }) {
  return (
    // A zero-size anchor, so the flex box around it centres a point, whatever the text measures.
    <span style={{ position: 'relative', display: 'inline-block', width: 0, height: 0, flexShrink: 0 }}>
      <span style={{
        position: 'absolute', left: 0, top: 0, fontSize: size * FINE, lineHeight: 1, whiteSpace: 'nowrap',
        transformOrigin: '0 0', transform: `translate(${dx}px, ${CAP_RISE * size + dy}px) scale(${1 / FINE}) translate(-50%, -50%)`,
      }}>
        {children}
      </span>
    </span>
  );
}

// ─── The page: Vercel's pricing page, in page coordinates ──────────────────────

interface Box { x: number; y: number; w: number; h: number }

type Pin = 'a' | 'b' | 'c';

/** One composition of one site: the boxes the story touches, measured on the live page. */
interface Layout {
  /** The site's page is drawn at this share of its real size. */
  s: number;
  /** The site's viewport width, in its px. */
  viewport: number;
  /** The lowest page coordinate the stage shows. */
  viewBottom: number;
  /** Where the cursor rests at the start and end of the loop, on empty page. */
  rest: { x: number; y: number };
  /** Inspect hovers this, with where the pointer rests in it (off its words) and its corner radius. */
  cell: Box; cellAt: { x: number; y: number }; cellRadius: number;
  heading: Box;
  /** A word in the heading: its range's bounding box, which the extension outlines and fills. */
  word: Box;
  /** Measure pins these, in order; `pins` is how many of them the story uses. */
  a: Box; b: Box; c: Box;
  pins: Pin[];
  /** Where the cursor waits while the measurement holds. */
  hold: { x: number; y: number };
  /** What the details panel reads from the heading, as `extractTypography` formats it. */
  type: { tag: string; size: string; font: string; rows: [string, string][] };
}

interface Site {
  /** What the address field shows. */
  url: string;
  wide: Layout;
  compact: Layout;
  /** The heading's colour, which the panel's Colours row reports, in each theme. */
  ink: { light: string; dark: string };
}

/**
 * Builds a layout from measurements taken in the site's own px (its viewport, already scrolled):
 * `at` turns a box into page coordinates at scale `s`.
 */
function measured(s: number, build: (at: (x: number, y: number, w: number, h: number) => Box, pt: (x: number, y: number) => { x: number; y: number }) => Omit<Layout, 's'>): Layout {
  const at = (x: number, y: number, w: number, h: number): Box => ({ x: x * s, y: VY + y * s, w: w * s, h: h * s });
  const pt = (x: number, y: number) => ({ x: x * s, y: VY + y * s });
  return { s, ...build(at, pt) };
}

const GEIST_TYPE = (size: number, line: number, ls: string, w: number, h: number) => ({
  tag: 'h1', size: `${w} × ${h}`, font: 'GeistSans',
  rows: [['Font', 'GeistSans'], ['Size', `${size}px`], ['Weight', '450'], ['Line height', `${line}px / ${line / size}`], ['Letter spacing', ls]] as [string, string][],
});

/** vercel.com/pricing: a 1280 desktop scrolled 100px to the plans (its header is sticky), or its 840 layout. */
const VERCEL: Site = {
  url: 'vercel.com',
  ink: { light: '#171717', dark: '#ededed' },
  wide: measured(VS, (at, pt) => ({
    viewport: 1280,
    viewBottom: VY + 490 * VS,
    rest: pt(700, 248),
    cell: at(435, 285, 410, 549), cellAt: { x: 330 * VS, y: 100 * VS }, cellRadius: 0,
    heading: at(24, 84, 813.3, 128),
    // "costs": Geist's ascent and descent make its box 83px tall, past the 64px line on both sides.
    word: at(346.1, 138, 142.6, 83),
    // The Hobby plan's name, price and description: 16px apart, twice.
    a: at(57, 317, 42.3, 20), b: at(57, 353, 66.3, 56), c: at(57, 425, 345, 24), pins: ['a', 'b', 'c'],
    hold: pt(300, 395),
    type: GEIST_TYPE(64, 64, '-3.84px / -0.06em', 813, 128),
  })),
  compact: measured(VS, (at, pt) => ({
    viewport: 840,
    viewBottom: VY + 510 * VS,
    rest: pt(400, 296),
    cell: at(25, 329, 790, 494), cellAt: { x: 420 * VS, y: 90 * VS }, cellRadius: 0,
    heading: at(24, 136, 792, 128),
    word: at(346.1, 190, 142.6, 83),
    a: at(49, 353, 42.3, 20), b: at(49, 389, 39.2, 40), c: at(49, 445, 352, 24), pins: ['a', 'b', 'c'],
    hold: pt(300, 412),
    type: GEIST_TYPE(64, 64, '-3.84px / -0.06em', 792, 128),
  })),
};

/** gidl's own scale for its desktop: the crop falls in the gap after the third card. */
const GS = 0.732;
/** On a phone gidl's single-column layout is shown whole across, a gutter each side. */
const GS_COMPACT = 0.785;
const SYSTEM_TYPE = (size: number, line: number, ls: string, w: number, h: number) => ({
  tag: 'h1', size: `${w} × ${h}`, font: '-apple-system',
  rows: [['Font', '-apple-system'], ['Size', `${size}px`], ['Weight', '700 Bold'], ['Line height', `${line}px / ${line / size}`], ['Letter spacing', ls]] as [string, string][],
});

/** gidl.dev: the 1280 home page scrolled 60px (its header scrolls away), or its 520 single column scrolled 80px. */
const GIDL: Site = {
  url: 'gidl.dev',
  ink: { light: '#171717', dark: '#f5f5f5' },
  wide: measured(GS, (at, pt) => ({
    viewport: 1280,
    viewBottom: VY + 600 * GS,
    rest: pt(700, 290),
    // Animated Tabs: its card, with gidl's 16px corners.
    cell: at(340, 357.1, 284, 317.5), cellAt: { x: 258 * GS, y: 150 * GS }, cellRadius: 16,
    heading: at(438.3, 88, 403.5, 90),
    word: at(674.4, 134, 167.3, 43),
    // Three cards side by side: 32px apart, twice.
    a: at(24, 357.1, 284, 317.5), b: at(340, 357.1, 284, 317.5), c: at(656, 357.1, 284, 317.5), pins: ['a', 'b', 'c'],
    hold: pt(800, 300),
    type: SYSTEM_TYPE(36, 45, '-0.9px / -0.025em', 404, 90),
  })),
  compact: measured(GS_COMPACT, (at, pt) => ({
    viewport: 520,
    viewBottom: VY + 640 * GS_COMPACT,
    rest: pt(420, 285),
    cell: at(16, 317.1, 488, 298), cellAt: { x: 120 * GS_COMPACT, y: 200 * GS_COMPACT }, cellRadius: 16,
    heading: at(101.8, 68, 316.4, 70),
    word: at(287, 104, 131.2, 33),
    // The hero's rhythm, all in view on a phone: heading, subtitle and button, 16px then 24px apart.
    a: at(101.8, 68, 316.4, 70), b: at(98.9, 154, 322.2, 21.1), c: at(177.4, 199.1, 165.2, 30), pins: ['a', 'b', 'c'],
    hold: pt(420, 285),
    type: SYSTEM_TYPE(28, 35, '-0.7px / -0.025em', 316, 70),
  })),
};

export type DemoSite = 'vercel' | 'gidl';
const SITES: Record<DemoSite, Site> = { vercel: VERCEL, gidl: GIDL };

type Mode = 'inspect' | 'measure' | 'guides' | 'annotate';
const MODES: Mode[] = ['inspect', 'measure', 'guides', 'annotate'];
/** Centres of things on the mock toolbar. */
const MODE_BTN: Record<Mode, { x: number; y: number }> = {
  inspect: { x: 267, y: 56 }, measure: { x: 293, y: 56 }, guides: { x: 319, y: 56 }, annotate: { x: 345, y: 56 },
};
/** Left edge of the mock toolbar. The mode buttons above are measured from it. */
const TOOLBAR_X = 197;
/** The details panel's width and the height of its header rows. */
const PANEL_W = 196;
const PANEL_HEAD = 22;

type CursorKind = 'pointer' | 'crosshair' | 'text';

/** A measurement between two pinned boxes: horizontal or vertical, as the extension draws it. */
interface Line { id: string; x1: number; y1: number; x2: number; y2: number; label: string }

interface Frame {
  mode: Mode;
  /** Every move is a shallow arc, as a hand travels. */
  cursor: { x: number; y: number; kind: CursorKind; dur: number };
  clicks: number;
  hover: Box | null;
  wordHover: boolean;
  wordSelected: boolean;
  panel: boolean;
  pins: Pin[];
  lines: Line[];
  toast: { text: string; ok: boolean } | null;
  /** Keycaps being pressed, shown so a keyboard step has a visible cause; the count replays the press. */
  keys: { label: string[]; presses: number } | null;
  /** The camera is pulled back to the whole browser window (only when the camera is on). */
  wide: boolean;
}

const START: Frame = {
  mode: 'inspect',
  cursor: { ...VERCEL.wide.rest, kind: 'crosshair', dur: 0 },
  clicks: 0,
  hover: null, wordHover: false, wordSelected: false, panel: false,
  pins: [], lines: [],
  toast: null, keys: null, wide: false,
};

/**
 * The line between two boxes, as the extension's measurePair places it: across the gap between
 * them, along the middle of where they overlap. The label is the gap in the site's own px.
 */
function lineBetween(id: string, a: Box, b: Box, scale: number): Line {
  const vertical = a.y + a.h <= b.y;
  if (vertical) {
    const x = (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2;
    return { id, x1: x, y1: a.y + a.h, x2: x, y2: b.y, label: `${Math.round((b.y - a.y - a.h) / scale)}px` };
  }
  const y = (Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2;
  return { id, x1: a.x + a.w, y1: y, x2: b.x, y2: y, label: `${Math.round((b.x - a.x - a.w) / scale)}px` };
}


// ─── Small pieces ─────────────────────────────────────────────────────────────

const chip: CSSProperties = {
  position: 'absolute', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 5,
  boxShadow: SHADOW_SM, color: '#000', fontFamily: MONO, fontSize: 9.5, fontWeight: 500,
  letterSpacing: '-0.01em', padding: '2px 6px', whiteSpace: 'nowrap',
};

/** How a highlight leaves. `true` (from AnimatePresence's `custom`) means at once: something has just taken its place. */
const LEAVE = { gone: (replaced: boolean) => ({ opacity: 0, transition: { duration: replaced ? 0 : 0.2 } }) };
const HOVER_LOOK = { backgroundColor: 'rgba(255,69,0,0.06)', borderColor: 'rgba(255,69,0,0.75)' };
const SELECTED_LOOK = { backgroundColor: 'rgba(255,69,0,0.14)', borderColor: 'rgba(255,69,0,1)' };

/**
 * The hover highlight fades in and glides between elements. A selected one is created by a
 * click on something that was already highlighted, so it starts fully visible in the hover
 * look and only deepens. Fading it in from nothing, while the hover one faded out beneath it,
 * read as a blink, as if the click had landed twice.
 */
function Highlight({ box, selected, radius = 3, text = false }: { box: Box; selected?: boolean; radius?: number; text?: boolean }) {
  // `radius` follows the element's own corners. On a word the extension draws an outline only,
  // 1.5px with 3px corners, since the word itself is filled with the accent (renderer's drawColorPickHighlight).
  const place = { x: box.x, y: box.y, width: box.w, height: box.h, borderRadius: radius };
  const look = text
    ? { backgroundColor: 'rgba(255,69,0,0)', borderColor: selected ? 'rgba(255,69,0,1)' : 'rgba(255,69,0,0.8)' }
    : selected ? SELECTED_LOOK : HOVER_LOOK;
  return (
    <motion.div
      initial={{ opacity: selected ? 1 : 0, ...place, ...HOVER_LOOK }}
      animate={{ opacity: 1, ...place, ...look }}
      variants={LEAVE} exit="gone"
      transition={{ ...SPRING, opacity: { duration: 0.12 }, backgroundColor: { duration: 0.18 }, borderColor: { duration: 0.18 } }}
      style={{
        position: 'absolute', left: 0, top: 0, boxSizing: 'border-box',
        borderStyle: 'solid', borderWidth: selected || text ? 1.5 : 1,
      }}
    />
  );
}

function Badge({ box, letter }: { box: Box; letter: string }) {
  const { nudge } = useContext(Tune);
  const dx = letter === 'B' ? nudge.badgeBX : 0;
  return (
    <motion.div
      initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.16, ease: 'easeOut' }}
      style={{
        position: 'absolute', left: box.x - 7, top: box.y - 7, width: 14, height: 14, borderRadius: '50%',
        background: ACCENT, border: '1.5px solid #fff', boxSizing: 'border-box', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: SANS, fontWeight: 600,
      }}
    >
      <FineText size={8.5} dx={dx} dy={nudge.badgeY}>{letter}</FineText>
    </motion.div>
  );
}

const STROKE = 'rgba(255,69,0,0.85)';

/** Start cap, line, end cap and distance — and the line drawing back when its element is unpinned. */
function MeasureLine({ line }: { line: Line }) {
  const { x1, y1, x2, y2 } = line;
  const vertical = x1 === x2;
  const t = (duration: number, delay: number) => ({ duration, delay, ease: EASE_IN_OUT });
  // The caps cross the line: upright on a horizontal line, flat on a vertical one.
  const cap = (x: number, y: number, after: number) => (
    <motion.line
      // Opacity is set from the start so the exit has something to fade from.
      initial={{ x1: x, x2: x, y1: y, y2: y, opacity: 1 }} animate={vertical ? { x1: x - 4, x2: x + 4, opacity: 1 } : { y1: y - 4, y2: y + 4, opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={t(0.1, after)}
    />
  );
  return (
    <>
      <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }} stroke={STROKE} strokeWidth="1.5" strokeLinecap="round">
        {cap(x1, y1, 0)}
        <motion.line
          x1={x1} y1={y1} initial={{ x2: x1, y2: y1 }} animate={{ x2, y2 }} exit={{ x2: x1, y2: y1, transition: { duration: 0.24, ease: EASE_IN_OUT } }}
          transition={t(0.3, 0)}
        />
        {cap(x2, y2, 0.3)}
      </svg>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={{ duration: 0.15, delay: 0.3 }}
        style={{ ...chip, left: (x1 + x2) / 2, top: (y1 + y2) / 2, transform: 'translate(-50%, -50%)' } as MotionStyle}
      >
        {line.label}
      </motion.div>
    </>
  );
}

const ICON = { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const MODE_ICON: Record<Mode, ReactNode> = {
  inspect:  <svg {...ICON}><path d="M5 3l5.5 17 2.5-5.5L18.5 12 5 3z" /><path d="M13 14.5l4.5 4.5" /></svg>,
  measure:  <svg {...ICON}><rect x="2" y="8" width="20" height="8" rx="1.5" /><path d="M6 8v5M10 8v3.5M14 8v3.5M18 8v5" /></svg>,
  guides:   <svg {...ICON}><path d="M12 3v18M3 12h18" /><circle cx="12" cy="12" r="2.5" /></svg>,
  annotate: <svg {...ICON}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>,
};

function Toolbar({ mode }: { mode: Mode }) {
  const slot: CSSProperties = { width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
  const rule = <span style={{ width: 1, height: 12, background: BORDER, margin: '0 3px' }} />;
  return (
    <div style={{
      position: 'absolute', left: TOOLBAR_X, top: 40, height: 32, padding: '0 5px', display: 'flex', alignItems: 'center',
      background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: SHADOW, color: '#737373',
    }}>
      <span style={{ ...slot, width: 20, color: '#000' }}>
        <svg width="11" height="11" viewBox="0 0 256 256"><path d="M 256 256 L 128 256 L 0 128 L 128 128 Z M 256 128 L 128 128 L 0 0 L 128 0 Z" fill="currentColor" /></svg>
      </span>
      {rule}
      {/* Browse: no tool, the page works as usual and the marks stay */}
      <span style={{ ...slot, marginRight: 2 }}>
        <svg {...ICON}><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" /><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" /><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" /></svg>
      </span>
      {MODES.map((m) => (
        <span key={m} style={{
          ...slot, marginRight: 2,
          background: m === mode ? 'rgba(255,69,0,0.12)' : 'transparent', color: m === mode ? ACCENT : '#737373',
          transition: 'background 0.15s ease, color 0.15s ease',
        }}>
          {MODE_ICON[m]}
        </span>
      ))}
      {rule}
      <span style={slot}><svg {...ICON}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg></span>
      <span style={slot}>
        <svg {...ICON}><path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><rect x="7" y="7" width="10" height="10" rx="1" /></svg>
      </span>
      <span style={slot}><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18.5" cy="12" r="1.6" /></svg></span>
    </div>
  );
}

/** Raval's crosshair is drawn in its accent; the arrow and I-beam are the system's. */
function CursorGlyph({ kind }: { kind: CursorKind }) {
  const centred: CSSProperties = { display: 'block', overflow: 'visible', marginLeft: -9, marginTop: -9 };
  if (kind === 'pointer') {
    return <svg width="16" height="18" viewBox="0 0 16 18" style={{ display: 'block' }}><path d="M1.5 1.2v13.2l3.6-3.3 2.3 5.3 2.2-.95-2.3-5.25h4.9L1.5 1.2z" fill="#000" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" /></svg>;
  }
  if (kind === 'text') {
    return <svg width="10" height="18" viewBox="-5 -9 10 18" style={{ display: 'block', marginLeft: -5, marginTop: -9 }}><path d="M-3 -8h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-2M3 -8h-2a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h2" stroke="var(--hd-ink)" strokeWidth="1.3" fill="none" strokeLinecap="round" /></svg>;
  }
  return <svg width="18" height="18" viewBox="-9 -9 18 18" style={centred} stroke={ACCENT} strokeWidth="1.5" strokeLinecap="round" fill="none"><path d="M-9 0h5M4 0h5M0 -9v5M0 4v5" /><circle r="2.5" /></svg>;
}

function PanelRow({ label, value, swatch }: { label: string; value: string; swatch?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, height: 14 }}>
      {swatch && <span style={{ width: 9, height: 9, borderRadius: 2.5, background: swatch, border: `1px solid ${BORDER}`, flexShrink: 0 }} />}
      <span style={{ color: '#737373', fontSize: 9, flex: swatch ? 1 : undefined }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 9 }}>{value}</span>
    </div>
  );
}

function PanelSection({ title, open, summary, children }: { title: string; open?: boolean; summary?: ReactNode; children?: ReactNode }) {
  return (
    <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: PANEL_HEAD, padding: '0 9px', fontSize: 9, fontWeight: 500, boxSizing: 'border-box' }}>
        <span style={{ flex: 1 }}>{title}</span>
        <span style={{ display: 'inline-flex', opacity: open ? 0 : 1, transition: 'opacity 0.15s ease' }}>{summary}</span>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#A3A3A3" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${open ? 90 : 0}deg)`, transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)' }}><path d="M9 6l6 6-6 6" /></svg>
      </div>
      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}>
        <div style={{ overflow: 'hidden', minHeight: 0 }}><div style={{ padding: '0 9px 7px' }}>{children}</div></div>
      </div>
    </div>
  );
}

/**
 * Safari on macOS: traffic lights, navigation, a centred address field, and the trailing controls.
 * `centre` is where the address field sits, the middle of as much of the bar as is shown.
 */
function BrowserBar({ width, centre, url }: { width: number; centre: number; url: string }) {
  const glyph = { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: '#8E8E93', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  const lights: [string, string][] = [['#FF5F57', '#E0443E'], ['#FEBC2E', '#DEA123'], ['#28C840', '#1AAB29']];
  return (
    <div style={{
      position: 'absolute', left: 0, top: 0, width, height: BAR, boxSizing: 'border-box', display: 'flex', alignItems: 'center',
      padding: '0 12px', background: 'var(--hd-bar)', borderBottom: '1px solid var(--hd-bar-line)', fontFamily: SYSTEM,
    }}>
      <div style={{ display: 'flex', gap: 6.5, marginRight: 16 }}>
        {lights.map(([fill, ring]) => (
          <span key={fill} style={{ width: 10, height: 10, borderRadius: '50%', background: fill, boxShadow: `inset 0 0 0 0.5px ${ring}` }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <svg {...glyph}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M9 5v14" /></svg>
        <svg {...glyph}><path d="M15 5l-7 7 7 7" /></svg>
        <svg {...glyph} style={{ stroke: 'var(--hd-glyph-off)' }}><path d="M9 5l7 7-7 7" /></svg>
      </div>
      <div style={{
        position: 'absolute', left: centre, top: '50%', transform: 'translate(-50%, -50%)', width: 250, height: 22, borderRadius: 7,
        background: 'var(--hd-field)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 10.5, color: 'var(--hd-bar-text)', letterSpacing: '-0.01em',
      }}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="#8E8E93"><path d="M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1zm2 0h6V7a3 3 0 0 0-6 0v3z" /></svg>
        {url}
        <svg {...glyph} width="10" height="10" style={{ position: 'absolute', right: 7 }}><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>
      </div>
      <div style={{ display: 'flex', gap: 11, alignItems: 'center', marginLeft: 'auto' }}>
        <svg {...glyph}><path d="M12 15V3M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>
        <svg {...glyph}><path d="M12 5v14M5 12h14" /></svg>
        <svg {...glyph}><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" /></svg>
      </div>
    </div>
  );
}

// ─── Vercel's pricing page ────────────────────────────────────────────────────

const NAV = [{ label: 'Products', menu: true, x: 65 }, { label: 'Resources', menu: true, x: 159 }, { label: 'Enterprise', x: 264 }, { label: 'Pricing', x: 353, current: true }];
const PLANS: { name: string; price: string; per?: boolean; popular?: boolean; text: string[]; rule: number; plus?: string; features: string[] }[] = [
  {
    name: 'Hobby', price: '$0', per: true, text: ['The perfect starting place for your web app.'], rule: 473,
    features: ['Import your repo, deploy in seconds', 'Automatic CI/CD', 'Web Application Firewall', 'Global, automated CDN', 'Fluid compute', 'DDoS Mitigation', 'Traffic & performance insights'],
  },
  {
    name: 'Pro', price: '$20', per: true, popular: true, text: ['Everything you need to', 'build and scale your app.'], rule: 497, plus: 'All Hobby features, plus:',
    features: ['$20 of included usage credit', 'Flat Rate CDN with traffic spike protection', 'Advanced spend management', 'Team collaboration & free viewer seats', 'Cold start prevention', 'Free custom domain'],
  },
  {
    name: 'Enterprise', price: 'Custom', text: ['Critical security, performance,', 'observability, platform SLAs, and support.'], rule: 497, plus: 'All Pro features, plus:',
    features: ['Guest & Team access controls', 'SCIM & Directory Sync', 'Managed WAF Rulesets', 'Multi-region compute & failover', '99.99% SLA', 'Advanced Support'],
  },
];

/** The triangle, at the size and place the header draws it. */
function VercelMark({ x, y }: { x: number; y: number }) {
  return (
    <svg width="21" height="18" viewBox="0 0 76 65" style={{ position: 'absolute', left: x, top: y }} aria-hidden="true">
      <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" fill="var(--vc-ink)" />
    </svg>
  );
}

/**
 * vercel.com/pricing, rebuilt in its own px from the live page and scaled by VS: the 1280 desktop
 * scrolled to the plans, or the 840 layout with one plan per row. `marked` paints "costs" as the
 * extension's CSS highlight does on a hovered or clicked word: the accent behind it, white text.
 */
function VercelPage({ compact, marked }: { compact: boolean; marked: boolean }) {
  const text = (size: number, line: number, weight: number, extra: CSSProperties = {}): CSSProperties => ({
    position: 'absolute', margin: 0, fontSize: size, lineHeight: `${line}px`, fontWeight: weight, color: 'var(--vc-ink)', whiteSpace: 'nowrap', ...extra,
  });
  // The wide page is scrolled 100px: the header stays, everything under it moves up.
  const top = compact ? 0 : -100;
  const plans = compact ? PLANS.slice(0, 1) : PLANS;
  return (
    <div style={{
      position: 'absolute', left: 0, top: VY, width: compact ? 840 : 1280, height: PAGE_H / VS, transform: `scale(${VS})`, transformOrigin: '0 0',
      background: 'var(--vc-bg)', fontFamily: geist.style.fontFamily, letterSpacing: 'normal', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', left: 0, top, width: '100%' }}>
        <h1 style={text(64, 64, 450, { left: 24, top: compact ? 136 : 184, letterSpacing: '-3.84px' })}>
          {/* An inline background paints the same box the Highlight API does: the word's content area. */}
          Scale your app,<br />control your{' '}
          <span style={{ background: marked ? ACCENT : 'transparent', color: marked ? '#fff' : 'inherit', transition: 'background 0.14s ease, color 0.14s ease' }}>costs</span>
        </h1>

        {/* The plans: one bordered grid, the Pro column raised on its own surface */}
        <div style={{ position: 'absolute', left: 24, top: compact ? 328 : 384, width: compact ? 792 : 1232, height: 600, boxSizing: 'border-box', border: '1px solid var(--vc-line)', borderRadius: 2 }}>
          {plans.map((plan, i) => {
            const left = i * 410;
            const pro = plan.name === 'Pro';
            const priceSize = compact ? 32 : 56;
            // The single-column cards pad 24; the desktop columns pad 32.
            const pad = compact ? 24 : 32;
            return (
              <div key={plan.name} style={{
                position: 'absolute', left, top: 0, width: compact ? 790 : 410, height: '100%',
                background: pro ? 'var(--vc-cell)' : 'transparent', boxSizing: 'border-box',
                borderLeft: pro ? '1px solid var(--vc-line)' : 'none', borderRight: pro ? '1px solid var(--vc-line)' : 'none',
              }}>
                <div style={text(14, 20, 500, { left: pad, top: pad })}>{plan.name}</div>
                {plan.popular && (
                  <div style={text(11, 16, 500, { left: 62.3, top: 32, padding: '2px 8px', borderRadius: 999, background: 'var(--vc-pill)', letterSpacing: '0.2px' })}>Popular</div>
                )}
                <div style={text(priceSize, compact ? 40 : 56, 450, { left: pad, top: compact ? 60 : 68, letterSpacing: compact ? '-1.28px' : '-3.36px' })}>
                  {plan.price}
                  {plan.per && (
                    <span style={{ marginLeft: 10, fontFamily: geistMono.style.fontFamily, fontSize: 14, fontWeight: 400, letterSpacing: 'normal', color: 'var(--vc-ink-2)' }}>/mo.</span>
                  )}
                </div>
                {plan.text.map((t, j) => (
                  <div key={t} style={text(16, 24, 400, { left: pad, top: (compact ? 116 : 140) + j * 24, color: 'var(--vc-ink-2)' })}>{t}</div>
                ))}
                <div style={{ position: 'absolute', left: pad, top: compact ? 164 : plan.rule - 285, width: compact ? 742 : 345, height: 1, background: 'var(--vc-hair)' }} />
                {/* The feature list, which only the camera's wide shot shows. Vercel draws an icon before
                    each line; the site has no icon set yet, so the lines start at the column's edge instead. */}
                {!compact && plan.plus && <div style={text(14, 20, 400, { left: pad, top: 237, color: 'var(--vc-ink-2)' })}>{plan.plus}</div>}
                {!compact && plan.features.map((feature, j) => (
                  <div key={feature} style={text(14, 20, 400, { left: pad, top: (plan.plus ? 269 : 213) + j * 32 })}>{feature}</div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* The sticky header, with its rule once the page is scrolled under it */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: 64, background: 'var(--vc-bg)', borderBottom: compact ? 'none' : '1px solid var(--vc-hair)', boxSizing: 'border-box' }}>
        <VercelMark x={24} y={23} />
        {!compact && NAV.map((n) => (
          <div key={n.label} style={text(14, 20, 400, { left: n.x, top: 22, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 4, color: n.current ? 'var(--vc-ink)' : 'var(--vc-ink-2)' })}>
            {n.label}
            {n.menu && <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>}
          </div>
        ))}
        {!compact && (
          <>
            <div style={text(14, 32, 500, { left: 992.3, top: 16, padding: '0 12px', borderRadius: 6, background: 'var(--vc-cell)', boxShadow: '0 0 0 1px var(--vc-line)' })}>Get a Demo</div>
            <div style={text(14, 32, 500, { left: 1104.9, top: 16, padding: '0 12px', borderRadius: 6, background: 'var(--vc-cell)', boxShadow: '0 0 0 1px var(--vc-line)' })}>Log In</div>
            <div style={text(14, 32, 500, { left: 1180.8, top: 16, padding: '0 12px', borderRadius: 6, background: 'var(--vc-ink)', color: 'var(--vc-bg)' })}>Sign Up</div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── gidl's home page ─────────────────────────────────────────────────────────

const GIDL_CARDS: { title: string; text: string; isNew?: boolean }[] = [
  { title: 'Agentation Toolbar', text: "A recreation of agentation's toolbar." },
  { title: 'Animated Tabs', text: 'Animated tabs component inspired by Raul.' },
  { title: 'Collins Carousel', text: "Carousel Interaction from Collins, heavily inspired by Dimi's work." },
  { title: 'Expanding Gallery', text: 'A clipped image strip where the hovered card expands while the strip slides.', isNew: true },
];
const GIDL_FONT = `-apple-system, "system-ui", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

/** A rounded block in a card's preview, at the place and size gidl draws it (preview px). */
function Sk({ x, y, w, h, r = 9999, fill = 'var(--gd-sk1)', line }: { x: number; y: number; w: number; h: number; r?: number; fill?: string; line?: boolean }) {
  return <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, borderRadius: r, background: fill, boxSizing: 'border-box', border: line ? '1px solid var(--gd-line)' : 'none' }} />;
}

/** Each card's resting preview, measured off the live page; `dx` centres it in a wider card. */
function GidlPreview({ i, dx }: { i: number; dx: number }) {
  const at = (x: number) => x + dx;
  if (i === 0) return (
    <>
      <Sk x={at(218)} y={92} w={36} h={36} />
      <Sk x={at(229)} y={103} w={14} h={3} fill="var(--gd-sk3)" /><Sk x={at(229)} y={109} w={10} h={3} fill="var(--gd-sk3)" /><Sk x={at(229)} y={115} w={6} h={3} fill="var(--gd-sk3)" />
    </>
  );
  if (i === 1) return (
    <>
      <Sk x={at(62)} y={33} w={160} h={32} />
      <Sk x={at(66)} y={37} w={50} h={24} fill="var(--gd-sk2)" />
      <Sk x={at(78)} y={46} w={26} h={6} fill="var(--gd-sk4)" /><Sk x={at(128)} y={46} w={30} h={6} fill="var(--gd-sk2)" /><Sk x={at(182)} y={46} w={24} h={6} fill="var(--gd-sk2)" />
      <Sk x={at(54)} y={75} w={176} h={112} r={18} />
      <Sk x={at(66)} y={87} w={40} h={4} fill="var(--gd-sk2)" /><Sk x={at(66)} y={97} w={84} h={6} fill="var(--gd-sk3)" /><Sk x={at(66)} y={109} w={129} h={6} fill="var(--gd-sk2)" />
      <Sk x={at(58)} y={127} w={168} h={56} r={14} fill="var(--gd-sk2)" />
    </>
  );
  if (i === 2) return (
    <>
      <Sk x={at(102)} y={62} w={44} h={79} r={12} line /><Sk x={at(107)} y={70} w={35} h={64} r={8} fill="var(--gd-sk2)" />
      <Sk x={at(138)} y={62} w={44} h={79} r={12} line /><Sk x={at(142)} y={70} w={35} h={64} r={8} fill="var(--gd-sk2)" />
      <Sk x={at(109)} y={57} w={66} h={88} r={12} line /><Sk x={at(116)} y={64} w={52} h={74} r={8} fill="var(--gd-sk2)" />
      <Sk x={at(117)} y={157} w={50} h={6} fill="var(--gd-sk3)" />
    </>
  );
  return (
    <>
      <Sk x={19} y={49} w={148} h={123} r={15.7} /><Sk x={175} y={49} w={79} h={123} r={15.7} /><Sk x={264} y={49} w={79} h={123} r={15.7} />
    </>
  );
}

/**
 * gidl.dev, rebuilt in its own px from the live page and scaled: the 1280 home page scrolled 60px,
 * or the 520 single column scrolled 80px. `marked` paints "inspiration" as the extension's text
 * highlight does.
 */
function GidlPage({ compact, marked }: { compact: boolean; marked: boolean }) {
  const s = compact ? GS_COMPACT : GS;
  const vw = compact ? 520 : 1280;
  const top = compact ? -80 : -60;
  const cardW = compact ? 488 : 284;
  const cardH = compact ? 298 : 317.5;
  const cards = compact ? GIDL_CARDS.slice(0, 3) : GIDL_CARDS;
  return (
    <div style={{
      position: 'absolute', left: 0, top: VY, width: vw, height: PAGE_H / s, transform: `scale(${s})`, transformOrigin: '0 0',
      background: 'var(--gd-bg)', fontFamily: GIDL_FONT, letterSpacing: 'normal', overflow: 'hidden', color: 'var(--gd-ink)',
    }}>
      <div style={{ position: 'absolute', left: 0, top, width: '100%' }}>
        <h1 style={{
          position: 'absolute', left: 0, top: 148, width: '100%', margin: 0, textAlign: 'center',
          fontSize: compact ? 28 : 36, lineHeight: compact ? '35px' : '45px', fontWeight: 700, letterSpacing: compact ? '-0.7px' : '-0.9px',
        }}>
          Animated components<br />I recreate from{' '}
          <span style={{ background: marked ? ACCENT : 'transparent', color: marked ? '#fff' : 'inherit', transition: 'background 0.14s ease, color 0.14s ease' }}>inspiration</span>
        </h1>
        <p style={{ position: 'absolute', left: 0, top: compact ? 234 : 254, width: '100%', margin: 0, textAlign: 'center', fontSize: 13, lineHeight: '21.125px', color: 'var(--gd-ink-2)' }}>
          found around the web, rebuilt here for you to explore.
        </p>
        <div style={{
          position: 'absolute', left: (vw - 165.2) / 2, top: compact ? 279.1 : 299.1, width: 165.2, height: 30, borderRadius: 9999,
          background: 'var(--gd-ink)', color: 'var(--gd-bg)', fontSize: 12, fontWeight: 500, lineHeight: '18px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          Browse Components
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>
        </div>

        {cards.map((c, i) => {
          const x = compact ? 16 : 24 + i * 316;
          const y = compact ? 397.1 + i * 322 : 417.1;
          return (
            <div key={c.title}>
              {/* The card's outer ring, 4px out */}
              <div style={{ position: 'absolute', left: x - 4, top: y - 4, width: cardW + 8, height: cardH + 8, borderRadius: 20, border: '1px solid var(--gd-ring)', boxSizing: 'border-box' }} />
              <div style={{ position: 'absolute', left: x, top: y, width: cardW, height: cardH, borderRadius: 16, border: '1px solid var(--gd-line)', background: 'var(--gd-card)', boxSizing: 'border-box', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', left: 24, top: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, lineHeight: '22.5px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {c.title}
                  {c.isNew && <span style={{ fontSize: 10, lineHeight: '10px', fontWeight: 500, color: '#ff7b00', background: 'rgba(255, 123, 0, 0.12)', borderRadius: 9999, padding: '2px 6px' }}>New</span>}
                </div>
                <p style={{
                  position: 'absolute', left: 24, top: 42.5, width: cardW - 50, margin: 0, fontSize: 13, lineHeight: '19.5px', color: 'var(--gd-ink-3)',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>{c.text}</p>
                {/* The preview, on the page's own ground */}
                <div style={{ position: 'absolute', left: -1, top: 96.5, width: cardW, height: 220, borderRadius: 16, border: '1px solid var(--gd-line)', background: 'var(--gd-bg)', boxSizing: 'border-box', overflow: 'hidden' }}>
                  <GidlPreview i={i} dx={(cardW - 284) / 2} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── The demo ─────────────────────────────────────────────────────────────────

class Cancelled extends Error {}

/**
 * The story: Inspect reads a plan and a word's type, then Measure pins three elements and reads the
 * gaps; ⌘Z undoes them. `camera` (on for the homepage) opens each loop on the whole browser window,
 * pushes in to the crop when Raval starts working, and pulls back out after the reset. `tuning` and
 * `paused` are for the development tuning panel: settings laid over the shipped ones (changing them
 * restarts the script), and a hold on the clock.
 */
export function HeroDemo({ tuning, paused = false, site = 'vercel', camera = false }: { tuning?: HeroTuningPatch; paused?: boolean; site?: DemoSite; camera?: boolean }) {
  const reduce = useReducedMotion();
  const T = useMemo(() => mergeTuning(tuning), [tuning]);
  const PACE = T.pace;
  const hold = useRef(paused);
  hold.current = paused;
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(STAGE_W);
  const lastHover = useRef<Box | null>(null);
  const [f, setF] = useState<Frame>(START);
  const compact = width < STAGE_W * MIN_SCALE;
  const S = SITES[site];
  // The wide shot is a desktop's whole window; on a phone it would be too small to read.
  const cam = camera && !compact;
  const L = compact ? S.compact : S.wide;
  const inset = compact ? COMPACT_INSET : INSET;
  const stageW = compact ? COMPACT_W : STAGE_W;
  const stageH = inset + SHIFT + L.viewBottom;
  const windowW = L.viewport * L.s;
  const boxes: Record<Pin, Box> = { a: L.a, b: L.b, c: L.c };
  /** The middle of the window as far as it is shown: where the extension centres its toolbar, and Safari its address field. */
  const windowMiddle = Math.min(windowW, stageW - inset) / 2;
  const toolbarShift = Math.round((compact ? windowMiddle : windowW / 2) - W / 2);
  // Colours follow the theme through CSS variables; this is only for the colour value the Inspect panel prints.
  const [dark, setDark] = useState(false);
  // Only play while it can be seen: in the viewport and in a visible tab.
  const visible = useRef(false);
  // Where the cursor is drawn, frame by frame, on its way to `f.cursor`.
  const cx = useMotionValue(START.cursor.x);
  const cy = useMotionValue(START.cursor.y);

  // Travel like a hand: a shallow arc, bowing more on longer trips.
  useEffect(() => {
    const to = f.cursor;
    const from = { x: cx.get(), y: cy.get() };
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    if (to.dur === 0 || dist < 0.5) { cx.set(to.x); cy.set(to.y); return; }
    const bow = Math.min(dist * 0.08, 24);
    const ctrl = { x: (from.x + to.x) / 2 - ((to.y - from.y) / dist) * bow, y: (from.y + to.y) / 2 + ((to.x - from.x) / dist) * bow };
    const run = animate(0, 1, {
      duration: to.dur, ease: TRAVEL,
      onUpdate: (t) => {
        const u = 1 - t;
        cx.set(u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x);
        cy.set(u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y);
      },
    });
    return () => run.stop();
  }, [f.cursor, cx, cy]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    const io = new IntersectionObserver(([entry]) => { visible.current = !!entry?.isIntersecting; }, { threshold: 0.35 });
    io.observe(el);
    const root = document.documentElement;
    const readTheme = (): void => setDark(root.dataset['theme'] === 'dark');
    readTheme();
    const mo = new MutationObserver(readTheme);
    mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { ro.disconnect(); io.disconnect(); mo.disconnect(); };
  }, []);

  useEffect(() => {
    const lineAB = lineBetween('ab', L.a, L.b, L.s);
    const lineBC = lineBetween('bc', L.b, L.c, L.s);
    const three = L.pins.length === 3;
    // The poster, instead of the animation when motion is reduced: the finished measurement.
    if (reduce) { setF({ ...START, mode: 'measure', cursor: { ...L.hold, kind: 'crosshair', dur: 0 }, pins: L.pins, lines: three ? [lineAB, lineBC] : [lineAB] }); return; }

    let cancelled = false;
    const patch = (p: Partial<Frame>): void => setF((prev) => ({ ...prev, ...p }));
    /** Wait `ms` of *visible* time, so the script pauses off-screen instead of running unseen. */
    const wait = async (ms: number): Promise<void> => {
      let left = ms * PACE;
      while (left > 0) {
        await new Promise((r) => setTimeout(r, 30));
        if (cancelled) throw new Cancelled();
        if (!hold.current && visible.current && document.visibilityState === 'visible') left -= 30;
      }
    };
    /** Where the cursor is headed, so a move can be timed by how far it goes. */
    let at = { ...L.rest };
    /** Move like a hand: quicker over short hops, longer across the page. `dur` (seconds) overrides the distance timing. */
    const move = async (x: number, y: number, dur?: number, kind: CursorKind = 'crosshair'): Promise<void> => {
      const dist = Math.hypot(x - at.x, y - at.y);
      at = { x, y };
      const took = (dur ?? Math.min(Math.max(0.26 + dist * 0.0009, 0.3), 0.65)) * T.travel;
      setF((prev) => ({ ...prev, cursor: { x, y, kind, dur: took * PACE } }));
      await wait(took * 1000);
    };
    /** Press keys with their caps on screen; `then` is what the press does. */
    const press = async (label: string[], then: Partial<Frame>): Promise<void> => {
      setF((prev) => ({ ...prev, ...then, keys: { label, presses: (prev.keys?.presses ?? 0) + 1 } }));
      await wait(240);
    };
    const click = async (): Promise<void> => {
      setF((prev) => ({ ...prev, clicks: prev.clicks + 1 }));
      await wait(150);
    };
    const toast = (text: string, ok = false): void => {
      patch({ toast: { text, ok } });
      setTimeout(() => { if (!cancelled) setF((prev) => (prev.toast?.text === text ? { ...prev, toast: null } : prev)); }, 1900 * PACE);
    };
    /** Hover an element the way a real pointer would: arrive, and the highlight follows. */
    const hoverOn = async (box: Box, dur?: number, point: { x: number; y: number } = { x: box.w / 2, y: box.h / 2 }): Promise<void> => {
      await move(box.x + point.x, box.y + point.y, dur);
      patch({ hover: box });
      await wait(260);
    };
    /** Go up to the toolbar and pick a mode. On the controls the mode goes quiet, as in the extension. */
    const pick = async (mode: Mode, settle = 260): Promise<void> => {
      patch({ hover: null, wordHover: false });
      await move(MODE_BTN[mode].x + toolbarShift, MODE_BTN[mode].y, undefined, 'pointer');
      await wait(100);
      await click();
      patch({ mode, wordSelected: false, panel: false });
      await wait(settle);
    };

    const run = async (): Promise<void> => {
      let loops = 0;
      for (;;) {
        // Counts the loops on the element, so a recording can start and stop on a loop boundary.
        wrap.current?.setAttribute('data-loop', String(++loops));
        setF({ ...START, cursor: { ...L.rest, kind: 'crosshair', dur: 0 }, wide: cam });
        at = { ...L.rest };
        await wait(500);
        if (cam) {
          // The whole page first, then in to where Raval works.
          await wait(900);
          patch({ wide: false });
          await wait(1000);
        }

        // ── Inspect ────────────────────────────────────────────────────────────
        // Onto a plan: the highlight finds its cell, with its size.
        await hoverOn(L.cell, undefined, L.cellAt);
        await wait(T.hold.sized * 1000);
        // Up to a word in the heading. The highlight stays on the cell until the pointer is on the
        // word, then glides to it and shrinks to fit.
        await move(L.word.x + L.word.w * 0.4, L.word.y + L.word.h * 0.55, undefined, 'text');
        // On the word: it is filled at once, as the extension's highlight does, and outlined.
        patch({ hover: L.word, wordHover: true });
        await wait(230);
        // Landed: the click comes at once, and the word takes the accent as the panel opens.
        setF((prev) => ({ ...prev, clicks: prev.clicks + 1, hover: null, wordHover: true, wordSelected: true, panel: true }));
        await wait(T.hold.typography * 1000);

        // ── Measure ────────────────────────────────────────────────────────────
        await pick('measure');
        // Each element in turn (on Vercel the plan's name, price and description), aiming off their words.
        const aim = (b: Box) => ({ x: b.w * 0.85, y: b.h * 0.6 });
        await hoverOn(L.a, undefined, aim(L.a));
        await click();
        patch({ pins: ['a'], hover: null });
        toast('Click another element to measure');
        await wait(200);
        await hoverOn(L.b, undefined, aim(L.b));
        await click();
        patch({ pins: ['a', 'b'], hover: null, lines: [lineAB] });
        if (three) {
          await wait(400);
          await hoverOn(L.c, undefined, { x: L.c.w * 0.92, y: L.c.h * 0.6 });
          await click();
          patch({ pins: ['a', 'b', 'c'], hover: null, lines: [lineAB, lineBC] });
        }
        // Off the words, so the result is clear, and hold it.
        await move(L.hold.x, L.hold.y);
        await wait(T.hold.measured * 1000);

        // The loop rewinds with a cause: undo, last measurement first, with the keys on screen;
        // then back to Inspect and to where the cursor began.
        toast('Undone');
        if (three) await press(['⌘', 'Z'], { pins: ['a', 'b'], lines: [lineAB] });
        await press(['⌘', 'Z'], { pins: ['a'], lines: [] });
        await press(['⌘', 'Z'], { pins: [] });
        await wait(300);
        patch({ keys: null });
        await pick('inspect', 120);
        await move(L.rest.x, L.rest.y);
        await wait(400);
        // Back out to the whole page, which the next loop opens on.
        if (cam) { patch({ wide: true }); await wait(1000); }
      }
    };

    run().catch((err) => { if (!(err instanceof Cancelled)) throw err; });
    return () => { cancelled = true; };
    // `T` holds everything tunable the script reads; `PACE`, the note and the ink come from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce, T, compact, site, cam]);

  // Over the toolbar the pointer is the arrow, as it is over the extension's controls.
  const onControls = f.cursor.y < 80;
  // When a click turns the hovered element into a pinned or marked one, the hover highlight
  // goes at once: the new highlight is already drawn in the same place.
  if (f.hover) lastHover.current = f.hover;
  const hoverReplaced = !f.hover && !!lastHover.current && f.pins.some((p) => boxes[p] === lastHover.current);
  // Only Inspect reads corners: it outlines along them and adds the radius to the size.
  const hoverRadius = f.mode === 'inspect' && f.hover === L.cell && L.cellRadius ? L.cellRadius : undefined;
  const hoverIsPinned = !!f.hover && f.pins.some((p) => boxes[p] === f.hover);
  // The heading's colour on Vercel, in each theme.
  const textColour = dark ? S.ink.dark : S.ink.light;
  // The details panel opens under the word, kept a gutter inside what is shown.
  const panelX = Math.min(L.word.x - 24, stageW - inset - 16 - PANEL_W);
  const panelY = L.word.y + L.word.h + 8;

  const scale = width / stageW;
  /**
   * The camera's wide shot: the whole window (its bar and its full height) fitted to the stage with a
   * gutter all round. Pushed in, the transform is none and the stage shows its usual crop.
   */
  const fit = Math.min((stageW - 2 * 24) / windowW, (stageH - 2 * 24) / (SHIFT + PAGE_H));
  const shot = cam && f.wide
    ? { scale: fit, x: (stageW - windowW * fit) / 2 - inset * fit, y: (stageH - (SHIFT + PAGE_H) * fit) / 2 - inset * fit }
    : { scale: 1, x: 0, y: 0 };
  /** How much of the page is in view, in page coordinates, for what sits on the visible window's edges. */
  const shownRight = stageW - inset;
  const label = `Animated simulation of Raval on ${S.url}: reading a plan's size and a word's typography, then measuring the gaps between three elements.`;

  return (
    <div
      ref={wrap}
      role="img"
      aria-label={label}
      // The interactive demo should not treat this picture as part of the page.
      data-demo-ui="true"
      // The stage is the page's own ground: the window bleeds off its right and bottom, with no plate behind it.
      style={{ position: 'relative', width: '100%', height: stageH * scale, overflow: 'hidden', userSelect: 'none', pointerEvents: 'none' }}
    >
      <Tune.Provider value={T}>
      <div aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, width: stageW, height: stageH, transform: `scale(${scale})`, transformOrigin: '0 0', fontFamily: SANS,
        // The stage sets its own type; it must not pick up the page's body size, leading or tracking.
        fontSize: 16, lineHeight: 1.5, letterSpacing: 'normal', textAlign: 'left',
        // Raval' own UI is light in both themes, so its text is always dark; the mock page sets its own colours.
        color: '#000',
      }}>
        {/* The camera: one push-in from the whole window to the crop, and back out */}
        <motion.div initial={false} animate={shot} transition={{ duration: reduce ? 0 : 0.9, ease: TRAVEL }} style={{ position: 'absolute', left: 0, top: 0, width: stageW, height: stageH, transformOrigin: '0 0' }}>
        <div
          style={{
            position: 'absolute', left: inset, top: inset, width: windowW, height: SHIFT + PAGE_H, overflow: 'hidden',
            borderRadius: 10, border: '1px solid var(--hd-edge)', background: 'var(--hd-page)',
            boxShadow: '0 18px 44px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.05)',
          }}
        >
        <BrowserBar width={windowW} centre={compact ? windowMiddle : windowW / 2} url={S.url} />

        {/* Everything below the bar; coordinates inside are page coordinates */}
        <div style={{ position: 'absolute', left: 0, top: SHIFT, width: windowW, height: PAGE_H }}>
          {/* The page being worked on */}
          {site === 'gidl'
            ? <GidlPage compact={compact} marked={f.wordHover || f.wordSelected} />
            : <VercelPage compact={compact} marked={f.wordHover || f.wordSelected} />}
          {/* The clicked word keeps its outline, solid now, under the panel it opened */}
          <AnimatePresence>{f.wordSelected && <Highlight key="word" box={L.word} selected text />}</AnimatePresence>

          {/* ── Raval, drawn over the page ── */}

          {/* Measure: pinned elements and the lines between them */}
          <AnimatePresence>
            {f.pins.map((p) => <Highlight key={p} box={boxes[p]} selected />)}
          </AnimatePresence>
          <AnimatePresence>
            {f.lines.map((l) => <MeasureLine key={l.id} line={l} />)}
          </AnimatePresence>
          <AnimatePresence>
            {f.pins.map((p) => <Badge key={p} box={boxes[p]} letter={p.toUpperCase()} />)}
          </AnimatePresence>

          {/* Hover highlight and the size of what is under the pointer */}
          <AnimatePresence custom={hoverReplaced}>
            {f.hover && !hoverIsPinned && <Highlight key="hover" box={f.hover} radius={hoverRadius ? hoverRadius * L.s : 3} text={f.hover === L.word} />}
          </AnimatePresence>
          {/* A word has no size label of its own; the details panel reports its paragraph. */}
          {/* In Vercel's own px, as the extension reads them */}
          {f.hover && f.hover !== L.word && (
            <div style={{ ...chip, left: f.hover.x + (hoverIsPinned ? 12 : 0), top: f.hover.y - 22 }}>
              {Math.round(f.hover.w / L.s)} × {Math.round(f.hover.h / L.s)}{hoverRadius ? ` · R ${hoverRadius}` : ''}
            </div>
          )}

          {/* Inspect details */}
          <AnimatePresence>
            {f.panel && (
              <motion.div
                key="panel"
                initial={{ opacity: 0, y: panelY - 4, scale: 0.98 }} animate={{ opacity: 1, y: panelY, scale: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.16, ease: 'easeOut' }}
                style={{ position: 'absolute', left: panelX, top: 0, width: PANEL_W, background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 10, boxShadow: SHADOW, overflow: 'hidden', transformOrigin: 'top left' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: PANEL_HEAD, padding: '0 9px', fontFamily: MONO, fontSize: 9, boxSizing: 'border-box' }}>
                  <span style={{ color: '#737373' }}>&lt;{L.type.tag}&gt;</span><span>{L.type.size}</span>
                </div>
                {/* What the extension reads from the site's heading: its computed style, formatted as Inspect does */}
                <PanelSection title="Typography" open={f.panel} summary={<span style={{ color: '#A3A3A3', fontWeight: 400 }}>{L.type.font}</span>}>
                  {L.type.rows.map(([label, value]) => <PanelRow key={label} label={label} value={value} />)}
                </PanelSection>
                <PanelSection title="Colours" open={false} summary={<span style={{ width: 8, height: 8, borderRadius: '50%', background: textColour, border: `1px solid ${BORDER}` }} />}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', height: 16, background: 'rgba(0,0,0,0.05)', borderRadius: 5, padding: 1.5, boxSizing: 'border-box', marginBottom: 5, fontSize: 7.5, fontWeight: 500 }}>
                    {['HEX', 'RGB', 'HSL'].map((t, i) => (
                      <span key={t} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, background: i === 0 ? '#fff' : 'transparent', boxShadow: i === 0 ? '0 1px 2px rgba(0,0,0,0.08)' : 'none', color: i === 0 ? '#000' : '#737373', lineHeight: 1 }}><FineText size={7.5} dy={T.nudge.caps}>{t}</FineText></span>
                    ))}
                  </div>
                  <PanelRow label="Color" value={textColour} swatch={textColour} />
                </PanelSection>
                <PanelSection title="Box" />
              </motion.div>
            )}
          </AnimatePresence>

          <div style={{ position: 'absolute', left: toolbarShift, top: 0 }}><Toolbar mode={f.mode} /></div>

          {/* Toast */}
          <AnimatePresence>
            {f.toast && (
              <motion.div
                key={f.toast.text}
                initial={{ opacity: 0, y: 14, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: 14, x: '-50%' }} transition={{ duration: 0.3, ease: 'easeOut' }}
                style={{ position: 'absolute', left: shownRight / 2, bottom: PAGE_H - L.viewBottom + 14, display: 'flex', alignItems: 'center', gap: 5, padding: '5px 9px', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 7, boxShadow: SHADOW_SM, fontSize: 9.5, fontWeight: 500, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}
              >
                {f.toast.ok && <svg width="10" height="10" viewBox="0 0 20 20" fill="#16a34a"><path fillRule="evenodd" clipRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" /></svg>}
                {f.toast.text}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Keys being pressed, at the foot of the visible window, so a keyboard step has a cause on screen */}
          <AnimatePresence>
            {f.keys && (
              <motion.div
                key="keys"
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.2, ease: 'easeOut' }}
                style={{ position: 'absolute', left: 16, bottom: PAGE_H - L.viewBottom + 14, display: 'flex', gap: 4 }}
              >
                {f.keys.label.map((k) => (
                  <motion.span
                    key={`${k}-${f.keys!.presses}`}
                    initial={{ y: 1.5, boxShadow: '0 0 0 rgba(0,0,0,0.12)' }} animate={{ y: 0, boxShadow: '0 1.5px 0 rgba(0,0,0,0.12)' }} transition={{ duration: 0.16, ease: 'easeOut' }}
                    style={{ minWidth: 22, height: 22, padding: '0 6px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 6, fontFamily: SYSTEM, fontSize: 11, fontWeight: 500, color: '#000' }}
                  >
                    {k}
                  </motion.span>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* The cursor, pressing on each click, with a ring */}
          <motion.div style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, x: cx, y: cy }}>
            {f.clicks > 0 && (
              <motion.span
                key={`ring-${f.clicks}`}
                initial={{ opacity: 0.5, scale: 0.4 }} animate={{ opacity: 0, scale: 1.6 }} transition={{ duration: 0.4, ease: 'easeOut' }}
                style={{ position: 'absolute', left: -9, top: -9, width: 18, height: 18, borderRadius: '50%', border: `1.5px solid ${ACCENT}`, boxSizing: 'border-box' }}
              />
            )}
            <motion.div key={`press-${f.clicks}`} initial={f.clicks > 0 ? { scale: 0.84 } : false} animate={{ scale: 1 }} transition={{ duration: 0.2, ease: 'easeOut' }} style={{ transformOrigin: '0 0' }}>
              <CursorGlyph kind={onControls ? 'pointer' : f.cursor.kind} />
            </motion.div>
          </motion.div>
        </div>
        </div>
        </motion.div>
      </div>
      </Tune.Provider>
    </div>
  );
}
