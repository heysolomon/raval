'use client';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion, type MotionStyle } from 'framer-motion';
import { inkPathData } from '@raval/shared';

/**
 * A scripted simulation of someone using the extension, played in a mock macOS
 * browser window. Nothing here is a video: a fake cursor follows a timeline and
 * visual copies of the real UI react to it — hover states, cursor changes,
 * panels, toasts — then it loops. The interactive demo (the "View demo"
 * button) is separate and lets visitors try the tools on this page themselves.
 *
 * Everything is laid out on a fixed stage and scaled to fit, so the
 * choreography can use plain coordinates. On narrow screens the stage stops
 * shrinking at MIN_SCALE and the window shows part of it instead, panning to
 * keep the cursor in view, so the UI stays readable on a phone.
 */

const W = 640;
/** Height of the browser's title bar. */
const BAR = 38;
/** The page was laid out against a 28px bar; this shifts it under the real one. */
const SHIFT = BAR - 28;
const H = 400 + SHIFT;
/** The stage is never drawn smaller than this; below it the window crops and follows the cursor. */
const MIN_SCALE = 0.8;
/** How close the cursor may get to the window's edge before the view pans. */
const PAN_MARGIN = 96;

const ACCENT = '#FF4500';
const BLUE = '#2563EB';
const MONO = `'JetBrains Mono', 'SF Mono', ui-monospace, monospace`;
const SANS = `'Neue Plak Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
const SYSTEM = `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif`;
const BORDER = 'rgba(0, 0, 0, 0.08)';
const SHADOW_SM = '0 1px 2px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.04)';
const SHADOW = '0 1px 2px rgba(0, 0, 0, 0.04), 0 6px 20px rgba(0, 0, 0, 0.06)';
const SPRING = { type: 'spring', stiffness: 1000, damping: 63, mass: 1 } as const;
const EASE = [0.4, 0, 0.2, 1] as const;
const EASE_IN_OUT = [0.645, 0.045, 0.355, 1] as const;

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
  /** Milliseconds per letter while the note is typed, and per sample while the pen draws. */
  typing: 50,
  inkStep: 34,
  /** Seconds the demo rests on each beat before moving on. */
  hold: {
    spacing: 1.5,
    typography: 1.5,
    colours: 1.5,
    measured: 1,
    unpinHover: 0.8,
    gaps: 1.6,
    guideHint: 1,
    gapAfterDrag: 1,
    callout: 0.6,
    arrowBent: 0.45,
    noteTyped: 0.4,
    noteTurned: 0.5,
    ink: 0.5,
    saved: 2.2,
  },
  /**
   * Small labels are centred on their capitals by FineText. These are optical corrections on top,
   * in stage pixels, positive is down: `tab` for tab labels, `caps` for capitals-only ones (HEX,
   * S, XL), `badgeY` for the measure badges' letters. Flex centres a glyph by its advance width,
   * not its ink, so `badgeBX` moves the B sideways.
   */
  nudge: { tab: 0, caps: 0, badgeY: 0, badgeBX: -0.26 },
  /** The note: where it is written, how it leans when fresh, and how far the handle turns it. */
  note: { x: 508, y: 352, size: 16, tilt: -1.5, turned: -9 },
  /** The pen stroke under the second card's price. `wave` is how far it wanders from straight. */
  ink: { x: 272, y: 263, length: 44, size: 3.4, wave: 1.6, rise: 1.5 },
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

// ─── The mock page, in page coordinates ───────────────────────────────────────

interface Box { x: number; y: number; w: number; h: number }

const HEADING: Box = { x: 56, y: 96, w: 196, h: 34 };
/** Where "team" lands in its sentence (measured): its glyph box, as a text selection covers it. */
const WORD: Box = { x: 202.5, y: 145, w: 28.4, h: 13 };
const CARD_A: Box = { x: 56, y: 200, w: 140, h: 112 };
const CARD_B: Box = { x: 260, y: 200, w: 140, h: 112 };
const CARD_C: Box = { x: 444, y: 96, w: 140, h: 216 };
const BOXES = { a: CARD_A, b: CARD_B, c: CARD_C } as const;
/** Corner radius of the mock page's rounded elements, which Inspect reads out and outlines along. */
const CARD_RADIUS = 8;
const RADIUS_OF = new Map<Box, number>([[CARD_A, CARD_RADIUS], [CARD_B, CARD_RADIUS], [CARD_C, CARD_RADIUS]]);
/** The cards' padding, shown when Inspect's spacing is on. */
const CARD_PAD = 12;
type Pin = keyof typeof BOXES;

type Mode = 'inspect' | 'measure' | 'guides' | 'annotate';
const MODES: Mode[] = ['inspect', 'measure', 'guides', 'annotate'];
/** Centres of things on the mock toolbar. */
const MODE_BTN: Record<Mode, { x: number; y: number }> = {
  inspect: { x: 267, y: 56 }, measure: { x: 293, y: 56 }, guides: { x: 319, y: 56 }, annotate: { x: 345, y: 56 },
};
/** Left edge of the mock toolbar. The mode buttons above are measured from it. */
const TOOLBAR_X = 197;
/** Capture a region: next to the whole-view camera on the toolbar. */
const REGION_BTN = { x: 402, y: 56 };
/** What the demo captures: the marked-up card, its arrow and the note. */
const REGION: Box = { x: 236, y: 170, w: 372, h: 222 };

// Details panel geometry, so the script can click its "Colours" header.
const PANEL = { x: WORD.x - 24, y: WORD.y + WORD.h + 8, w: 168 };
const PANEL_HEAD = 22;
const PANEL_TYPE_BODY = 63;
const COLOURS_HEADER = { x: PANEL.x + 60, y: PANEL.y + PANEL_HEAD * 2 + PANEL_TYPE_BODY + PANEL_HEAD / 2 };

// Annotate options card, under the toolbar's right end. `h` is its height with no tool rows open.
const TRAY: Box = { x: 281, y: 80, w: 150, h: 54 };
type Tool = 'size' | 'note' | 'arrow' | 'pen';
const TOOLS: Tool[] = ['size', 'note', 'arrow', 'pen'];
/** The first tool is called Callout on the card; `size` is only its name in here. */
const TOOL_LABEL: Record<Tool, string> = { size: 'Callout', note: 'Note', arrow: 'Arrow', pen: 'Pen' };
const TOOL_W = (TRAY.w - 16) / 4;
// The card, top to bottom: colour swatches, tool tabs, then the rows of the tool that is on.
const SWATCH_ROW = 12;
const TAB_ROW = 18;
const SUB_ROW = 16;
const ROW_GAP = 7;
const SUB_GAP = 5;
const TABS_Y = 8 + SWATCH_ROW + ROW_GAP;
const SUB_Y = TABS_Y + TAB_ROW + SUB_GAP + 1;
const toolBtn = (t: Tool): { x: number; y: number } => ({ x: TRAY.x + 8 + TOOL_W * (TOOLS.indexOf(t) + 0.5), y: TRAY.y + TABS_Y + TAB_ROW / 2 });
/** How many rows each tool adds under the tabs: note has size and font, arrow has start and end, pen has width. */
const SUB_ROWS: Record<Tool, number> = { size: 0, note: 2, arrow: 2, pen: 1 };
const trayHeight = (t: Tool): number => TRAY.h + (SUB_ROWS[t] ? 1 + SUB_ROWS[t] * (SUB_ROW + SUB_GAP) : 0);
/** Arrow rows carry a label, so their tabs are narrower. */
const END_LABEL_W = 28;
const ARROW_ENDS = ['None', 'Arrow', 'Bar', 'Dot'] as const;
type ArrowEnd = (typeof ARROW_ENDS)[number];
/** Centre of an end choice on the arrow tool's Start (row 0) or End (row 1) row. */
const endBtn = (row: 0 | 1, end: ArrowEnd): { x: number; y: number } => {
  const w = (TRAY.w - 16 - END_LABEL_W) / ARROW_ENDS.length;
  return { x: TRAY.x + 8 + END_LABEL_W + w * (ARROW_ENDS.indexOf(end) + 0.5), y: TRAY.y + SUB_Y + row * (SUB_ROW + SUB_GAP) + SUB_ROW / 2 };
};
const SWATCHES = [ACCENT, '#FF2D85', BLUE, '#16A34A', '#7C3AED', '#111111'];
const swatchAt = (i: number): { x: number; y: number } => ({ x: TRAY.x + 16 + i * 23.6, y: TRAY.y + 8 + SWATCH_ROW / 2 });

// Arrow endpoints and the point it is bent through.
const ARROW_FROM = { x: 500, y: 356 };
const ARROW_TO = { x: CARD_B.x + CARD_B.w - 10, y: CARD_B.y + CARD_B.h + 8 };
const ARROW_MID = { x: (ARROW_FROM.x + ARROW_TO.x) / 2, y: (ARROW_FROM.y + ARROW_TO.y) / 2 };
const ARROW_BEND = { x: ARROW_MID.x + 4, y: ARROW_MID.y + 22 };

/** Roughly how wide and tall the finished note is; only used to aim the cursor at it and its handle. */
const NOTE_SIZE = { w: 70, h: 20 };

/** The pen stroke's samples: slow at the ends, quick through the middle, so the ink thins there. */
function inkSamples(ink: HeroTuning['ink']): { x: number; y: number }[] {
  return Array.from({ length: 26 }, (_, i) => {
    const t = i / 25;
    // Ease in and out along the line, so samples bunch up at the ends.
    const along = t * t * (3 - 2 * t);
    return { x: ink.x + along * ink.length, y: ink.y + Math.sin(t * Math.PI * 2.2) * ink.wave - along * ink.rise };
  });
}

interface Gap { x1: number; y1: number; x2: number; y2: number; label: string; at: { x: number; y: number } }

type CursorKind = 'pointer' | 'crosshair' | 'text' | 'pen' | 'remove' | 'delete' | 'move' | 'grab';

interface Line { id: string; x1: number; x2: number; y: number }

interface Frame {
  mode: Mode;
  cursor: { x: number; y: number; kind: CursorKind; dur: number };
  clicks: number;
  hover: Box | null;
  wordHover: boolean;
  wordSelected: boolean;
  panel: false | 'type' | 'colours';
  pins: Pin[];
  lines: Line[];
  /** The placement preview follows the cursor; `at` holds it on an edge while it is snapped. */
  preview: { snapped: boolean; at?: { x: number; y: number } } | null;
  guideV: number | null;
  guideH: { y: number; dur: number; strong: boolean } | null;
  /** A second pair of guides, so there is a gap to measure. */
  guideV2: number | null;
  guideH2: number | null;
  /** Distances between guides being shown. */
  gaps: Gap[];
  /** Inspect: the second card is clicked with spacing on, so its padding is drawn on it. */
  spacing: boolean;
  hint: string | null;
  tool: Tool;
  colour: string;
  arrow: false | 'straight' | 'bent';
  arrowHandles: boolean;
  /** What the arrow's tail is drawn with. */
  arrowStart: ArrowEnd;
  note: string;
  /** The note is pointed at: outlined, with its rotate handle. */
  noteActive: boolean;
  noteAngle: number;
  /** How many samples of the pen stroke have been drawn. */
  ink: number;
  sizeMark: boolean;
  toast: { text: string; ok: boolean } | null;
  flash: number;
  /** Region capture is switched on (its toolbar button is lit). */
  capturing: boolean;
  /** The rectangle being dragged out, with how long the current step of the drag takes. */
  region: (Box & { dur: number }) | null;
  fading: boolean;
}

const START: Frame = {
  mode: 'inspect',
  cursor: { x: 520, y: 350, kind: 'crosshair', dur: 0 },
  clicks: 0,
  hover: null, wordHover: false, wordSelected: false, panel: false,
  pins: [], lines: [],
  preview: null, guideV: null, guideH: null, guideV2: null, guideH2: null, gaps: [], spacing: false, hint: null,
  tool: 'size', colour: ACCENT, arrow: false, arrowHandles: false, arrowStart: 'None', note: '', noteActive: false, noteAngle: HERO_TUNING.note.tilt, ink: 0, sizeMark: false,
  toast: null, flash: 0, capturing: false, region: null,
  fading: false,
};

const lineAB: Line = { id: 'ab', x1: CARD_A.x + CARD_A.w, x2: CARD_B.x, y: CARD_A.y + CARD_A.h / 2 };
const lineBC: Line = { id: 'bc', x1: CARD_B.x + CARD_B.w, x2: CARD_C.x, y: CARD_B.y + CARD_B.h / 2 };

/** What is shown instead of the animation when motion is reduced: a finished measurement. */
const STILL: Frame = { ...START, mode: 'measure', cursor: { x: 330, y: 268, kind: 'crosshair', dur: 0 }, pins: ['a', 'b'], lines: [lineAB] };

const NOTE_TEXT = 'Align these';

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
function Highlight({ box, selected, radius = 3, hollow = false }: { box: Box; selected?: boolean; radius?: number; hollow?: boolean }) {
  // `radius` follows the element's own corners; `hollow` leaves the inside clear for the spacing bands.
  const place = { x: box.x, y: box.y, width: box.w, height: box.h, borderRadius: radius };
  return (
    <motion.div
      initial={{ opacity: selected ? 1 : 0, ...place, ...HOVER_LOOK }}
      animate={{ opacity: 1, ...place, ...(selected ? SELECTED_LOOK : HOVER_LOOK), ...(hollow ? { backgroundColor: 'rgba(255,69,0,0)' } : null) }}
      variants={LEAVE} exit="gone"
      transition={{ ...SPRING, opacity: { duration: 0.12 }, backgroundColor: { duration: 0.18 }, borderColor: { duration: 0.18 } }}
      style={{
        position: 'absolute', left: 0, top: 0, boxSizing: 'border-box',
        borderStyle: 'solid', borderWidth: selected ? 1.5 : 1,
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
  const { x1, x2, y } = line;
  const t = (duration: number, delay: number) => ({ duration, delay, ease: EASE_IN_OUT });
  const cap = (x: number, after: number) => (
    <motion.line
      initial={{ x1: x, x2: x, y1: y, y2: y }} animate={{ y1: y - 4, y2: y + 4 }} exit={{ opacity: 0, transition: { duration: 0.08 } }}
      transition={t(0.1, after)}
    />
  );
  return (
    <>
      <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }} stroke={STROKE} strokeWidth="1.5" strokeLinecap="round">
        {cap(x1, 0)}
        <motion.line
          x1={x1} y1={y} y2={y} initial={{ x2: x1 }} animate={{ x2 }} exit={{ x2: x1, transition: { duration: 0.24, ease: EASE_IN_OUT } }}
          transition={t(0.3, 0)}
        />
        {cap(x2, 0.3)}
      </svg>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={{ duration: 0.15, delay: 0.3 }}
        style={{ ...chip, left: (x1 + x2) / 2, top: y, transform: 'translate(-50%, -50%)' } as MotionStyle}
      >
        {x2 - x1}px
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

function Toolbar({ mode, capturing }: { mode: Mode; capturing: boolean }) {
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
      <span style={{ ...slot, background: capturing ? 'rgba(255,69,0,0.12)' : 'transparent', color: capturing ? ACCENT : '#737373', transition: 'background 0.15s ease, color 0.15s ease' }}>
        <svg {...ICON}><path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><rect x="7" y="7" width="10" height="10" rx="1" /></svg>
      </span>
      <span style={slot}><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18.5" cy="12" r="1.6" /></svg></span>
    </div>
  );
}

/**
 * A row of tabs with the pill that slides to the active one. Labels are centred on their capitals
 * (FineText); `caps` picks the correction for labels made only of capitals (HERO_TUNING.nudge).
 */
function TabRow({ items, active, height, caps = false }: { items: readonly string[]; active: number; height: number; caps?: boolean }) {
  const { nudge } = useContext(Tune);
  const n = items.length;
  return (
    <div style={{ position: 'relative', flex: 1, display: 'grid', gridTemplateColumns: `repeat(${n}, 1fr)`, height, background: 'rgba(0,0,0,0.05)', borderRadius: 5, padding: 1.5, boxSizing: 'border-box' }}>
      <div style={{ position: 'absolute', top: 1.5, bottom: 1.5, width: `calc((100% - 3px) / ${n})`, left: `calc(1.5px + ${active} * ((100% - 3px) / ${n}))`, background: '#fff', borderRadius: 4, boxShadow: '0 1px 2px rgba(0,0,0,0.08)', transition: 'left 0.22s cubic-bezier(0.4, 0, 0.2, 1)' }} />
      {items.map((label, i) => (
        <span key={label} style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7.5, fontWeight: 500, lineHeight: 1, color: i === active ? '#000' : '#737373', transition: 'color 0.22s ease' }}>
          <FineText size={7.5} dy={caps ? nudge.caps : nudge.tab}>{label}</FineText>
        </span>
      ))}
    </div>
  );
}

/** Rows that belong to one tool: they open under the tabs while it is the tool. */
function TrayRows({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateRows: show ? '1fr' : '0fr', transition: 'grid-template-rows 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}>
      <div style={{ overflow: 'hidden', minHeight: 0 }}><div style={{ paddingTop: 1 }}>{children}</div></div>
    </div>
  );
}

/**
 * The Annotate options card: the colour everything is drawn in, the tool tabs, and under them
 * the settings of the tool that is on (note size and font, arrow ends, pen width).
 */
function Tray({ tool, colour, arrowStart }: { tool: Tool; colour: string; arrowStart: ArrowEnd }) {
  const { nudge } = useContext(Tune);
  const sub: CSSProperties = { display: 'flex', alignItems: 'center', marginTop: SUB_GAP };
  // Left-aligned rather than centred: the anchor sits half the word's width in from the left.
  const endLabel: CSSProperties = { width: END_LABEL_W, flexShrink: 0, alignSelf: 'stretch', display: 'flex', alignItems: 'center', color: '#737373' };
  return (
    <motion.div
      initial={{ opacity: 0, y: TRAY.y - 4, scale: 0.98 }} animate={{ opacity: 1, y: TRAY.y, scale: 1 }} exit={{ opacity: 0, y: TRAY.y - 4, scale: 0.98, transition: { duration: 0.12 } }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      style={{ position: 'absolute', left: TRAY.x, top: 0, width: TRAY.w, boxSizing: 'border-box', padding: 8, background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 10, boxShadow: SHADOW, transformOrigin: 'top right' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 2px', height: SWATCH_ROW }}>
        {SWATCHES.map((c) => (
          <span key={c} style={{ position: 'relative', width: 12, height: 12 }}>
            <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: c, transform: 'scale(1.25)', opacity: c === colour ? 1 : 0, transition: 'opacity 0.2s ease' }} />
            <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#fff' }} />
            <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: c, transform: `scale(${c === colour ? 0.78 : 1})`, transition: 'transform 0.2s ease' }} />
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', marginTop: ROW_GAP }}>
        <TabRow items={TOOLS.map((t) => TOOL_LABEL[t])} active={TOOLS.indexOf(tool)} height={TAB_ROW} />
      </div>

      <TrayRows show={tool === 'note'}>
        <div style={sub}><TabRow items={['S', 'M', 'L', 'XL']} active={1} height={SUB_ROW} caps /></div>
        <div style={sub}><TabRow items={['Hand', 'Marker', 'Neat', 'Script']} active={0} height={SUB_ROW} /></div>
      </TrayRows>
      <TrayRows show={tool === 'arrow'}>
        <div style={sub}>
          <span style={endLabel}><span style={{ marginLeft: 9 }}><FineText size={7.5} dy={nudge.tab}>Start</FineText></span></span>
          <TabRow items={ARROW_ENDS} active={ARROW_ENDS.indexOf(arrowStart)} height={SUB_ROW} />
        </div>
        <div style={sub}>
          <span style={endLabel}><span style={{ marginLeft: 7 }}><FineText size={7.5} dy={nudge.tab}>End</FineText></span></span>
          <TabRow items={ARROW_ENDS} active={1} height={SUB_ROW} />
        </div>
      </TrayRows>
      <TrayRows show={tool === 'pen'}>
        <div style={sub}><TabRow items={['S', 'M', 'L', 'XL']} active={1} height={SUB_ROW} caps /></div>
      </TrayRows>
    </motion.div>
  );
}

/** Padding of a clicked card, drawn on it as Inspect's spacing setting does: a light accent band with each side's size. */
function PaddingBands({ box, pad }: { box: Box; pad: number }) {
  // Inside the 1px border.
  const o = { l: box.x + 1, t: box.y + 1, r: box.x + box.w - 1, b: box.y + box.h - 1 };
  const i = { l: o.l + pad, t: o.t + pad, r: o.r - pad, b: o.b - pad };
  const rect = (e: typeof o): string => `M${e.l} ${e.t}H${e.r}V${e.b}H${e.l}Z`;
  const cx = (o.l + o.r) / 2;
  const cy = (o.t + o.b) / 2;
  const label = (x: number, y: number): ReactNode => (
    <g>
      <rect x={x - 7} y={y - 5} width="14" height="10" rx="3" fill="rgba(255,255,255,0.94)" />
      <text x={x} y={y + 2.7} textAnchor="middle" fill={ACCENT} fontFamily={MONO} fontSize="7.5" fontWeight="500">{pad}</text>
    </g>
  );
  return (
    <motion.svg
      width={W} height={H} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
    >
      <path d={rect(o) + rect(i)} fillRule="evenodd" fill="rgba(255, 69, 0, 0.18)" />
      {label(cx, (o.t + i.t) / 2)}{label(cx, (o.b + i.b) / 2)}{label((o.l + i.l) / 2, cy)}{label((o.r + i.r) / 2, cy)}
    </motion.svg>
  );
}

/** The distance between two guides: a capped line across the gap and the value in a pill beside it. */
function GapMark({ gap, colour }: { gap: Gap; colour: string }) {
  const horizontal = gap.y1 === gap.y2;
  const w = gap.label.length * 5.4 + 9;
  const caps = horizontal ? `M${gap.x1} ${gap.y1 - 3.5}v7M${gap.x2} ${gap.y2 - 3.5}v7` : `M${gap.x1 - 3.5} ${gap.y1}h7M${gap.x2 - 3.5} ${gap.y2}h7`;
  return (
    <motion.svg
      width={W} height={H} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={{ duration: 0.15 }}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
    >
      <path d={`M${gap.x1} ${gap.y1}L${gap.x2} ${gap.y2}${caps}`} stroke={colour} strokeOpacity="0.85" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <rect x={gap.at.x - w / 2} y={gap.at.y - 7} width={w} height="14" rx="4" fill={colour} />
      <text x={gap.at.x} y={gap.at.y + 3.2} textAnchor="middle" fill="#fff" fontFamily={MONO} fontSize="9" fontWeight="500">{gap.label}</text>
    </motion.svg>
  );
}

/** Raval's own marks are drawn in the colour everything else is; the arrow and I-beam are the system's. */
function CursorGlyph({ kind, colour }: { kind: CursorKind; colour: string }) {
  const centred: CSSProperties = { display: 'block', overflow: 'visible', marginLeft: -9, marginTop: -9 };
  if (kind === 'pointer') {
    return <svg width="16" height="18" viewBox="0 0 16 18" style={{ display: 'block' }}><path d="M1.5 1.2v13.2l3.6-3.3 2.3 5.3 2.2-.95-2.3-5.25h4.9L1.5 1.2z" fill="#000" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" /></svg>;
  }
  if (kind === 'text') {
    return <svg width="10" height="18" viewBox="-5 -9 10 18" style={{ display: 'block', marginLeft: -5, marginTop: -9 }}><path d="M-3 -8h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-2M3 -8h-2a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h2" stroke="var(--hd-ink)" strokeWidth="1.3" fill="none" strokeLinecap="round" /></svg>;
  }
  if (kind === 'pen') {
    const d = 'M0 0L1.3 -4.4L10.2 -13.3a1.9 1.9 0 0 1 2.7 0l0.4 0.4a1.9 1.9 0 0 1 0 2.7L4.4 -1.3Z';
    return <svg width="18" height="18" viewBox="-9 -9 18 18" style={centred} strokeLinejoin="round" strokeLinecap="round"><path d={d} fill="#fff" stroke="#fff" strokeWidth="4" /><path d={d} fill="#fff" stroke={colour} strokeWidth="1.5" /></svg>;
  }
  if (kind === 'remove' || kind === 'delete') {
    return (
      <svg width="18" height="18" viewBox="-9 -9 18 18" style={centred}>
        <circle r="8" fill={colour} stroke="#fff" strokeWidth="1.5" />
        <path d={kind === 'remove' ? 'M-3.5 0H3.5' : 'M-2.75 -2.75L2.75 2.75M2.75 -2.75L-2.75 2.75'} stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'move') {
    const d = 'M0 -8V8M-3.2 -4.8L0 -8L3.2 -4.8M-3.2 4.8L0 8L3.2 4.8';
    return <svg width="18" height="18" viewBox="-9 -9 18 18" style={centred} fill="none" strokeLinecap="round" strokeLinejoin="round"><path d={d} stroke="#fff" strokeWidth="4.2" /><path d={d} stroke={colour} strokeWidth="1.6" /></svg>;
  }
  if (kind === 'grab') {
    return <svg width="18" height="18" viewBox="-9 -9 18 18" style={centred}><circle r="6" fill="#fff" /><circle r="4.6" fill="#fff" stroke={colour} strokeWidth="1.6" /></svg>;
  }
  return <svg width="18" height="18" viewBox="-9 -9 18 18" style={centred} stroke={colour} strokeWidth="1.5" strokeLinecap="round" fill="none"><path d="M-9 0h5M4 0h5M0 -9v5M0 4v5" /><circle r="2.5" /></svg>;
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

/** Safari on macOS: traffic lights, navigation, a centred address field, and the trailing controls. */
function BrowserBar({ width }: { width: number }) {
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
        position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: Math.min(250, width - 270), height: 22, borderRadius: 7,
        background: 'var(--hd-field)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 10.5, color: 'var(--hd-bar-text)', letterSpacing: '-0.01em',
      }}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="#8E8E93"><path d="M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1zm2 0h6V7a3 3 0 0 0-6 0v3z" /></svg>
        acme.design
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

// ─── The demo ─────────────────────────────────────────────────────────────────

class Cancelled extends Error {}

export type DemoScene = 'inspect' | 'measure' | 'guides' | 'annotate' | 'screenshot';
const ALL_SCENES: DemoScene[] = ['inspect', 'measure', 'guides', 'annotate', 'screenshot'];

/**
 * `scenes` plays only part of the script, in the usual order; the homepage plays all of it.
 * `tuning` and `paused` are for the development tuning panel: settings laid over the shipped
 * ones (changing them restarts the script), and a hold on the clock.
 */
export function HeroDemo({ scenes = ALL_SCENES, tuning, paused = false }: { scenes?: DemoScene[]; tuning?: HeroTuningPatch; paused?: boolean }) {
  const reduce = useReducedMotion();
  const T = useMemo(() => mergeTuning(tuning), [tuning]);
  const PACE = T.pace;
  const NOTE_AT = T.note;
  const NOTE_HANDLE = { x: NOTE_AT.x + NOTE_SIZE.w / 2, y: NOTE_AT.y - 11 };
  const INK = useMemo(() => inkSamples(T.ink), [T]);
  const hold = useRef(paused);
  hold.current = paused;
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(W);
  // Where the window sits on the stage when it is too narrow to show all of it.
  const pan = useRef(0);
  const lastHover = useRef<Box | null>(null);
  const [f, setF] = useState<Frame>(START);
  const sceneKey = scenes.join(',');
  // Colours follow the theme through CSS variables; this is only for the colour value the Inspect panel prints.
  const [dark, setDark] = useState(false);
  // Only play while it can be seen: in the viewport and in a visible tab.
  const visible = useRef(false);

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
    if (reduce) { setF(STILL); return; }

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
    const move = async (x: number, y: number, dur: number, kind: CursorKind = 'crosshair'): Promise<void> => {
      const took = dur * T.travel;
      setF((prev) => ({ ...prev, cursor: { x, y, kind, dur: took * PACE } }));
      await wait(took * 1000);
    };
    const look = (kind: CursorKind): void => setF((prev) => ({ ...prev, cursor: { ...prev.cursor, kind, dur: 0 } }));
    const click = async (): Promise<void> => {
      setF((prev) => ({ ...prev, clicks: prev.clicks + 1 }));
      await wait(150);
    };
    const toast = (text: string, ok = false): void => {
      patch({ toast: { text, ok } });
      setTimeout(() => { if (!cancelled) setF((prev) => (prev.toast?.text === text ? { ...prev, toast: null } : prev)); }, 1900 * PACE);
    };
    /** Hover an element the way a real pointer would: arrive, and the highlight follows. */
    const hoverOn = async (box: Box, dur: number, at: { x: number; y: number } = { x: box.w / 2, y: box.h / 2 }): Promise<void> => {
      await move(box.x + at.x, box.y + at.y, dur);
      patch({ hover: box });
      await wait(260);
    };
    /** Go up to the toolbar and pick a mode. On the controls the mode goes quiet, as in the extension. */
    const pick = async (mode: Mode, settle = 260): Promise<void> => {
      patch({ hover: null, wordHover: false, preview: null, hint: null });
      await move(MODE_BTN[mode].x, MODE_BTN[mode].y, 0.5, 'pointer');
      await wait(100);
      await click();
      patch({ mode, wordSelected: false, panel: false });
      await wait(settle);
    };

    const want = (scene: DemoScene): boolean => sceneKey.split(',').includes(scene);

    const run = async (): Promise<void> => {
      let loops = 0;
      for (;;) {
        // Counts the loops on the element, so a recording can start and stop on a loop boundary.
        wrap.current?.setAttribute('data-loop', String(++loops));
        setF({ ...START, noteAngle: T.note.tilt });
        await wait(500);

        // ── Inspect ────────────────────────────────────────────────────────────
        if (want('inspect')) {
        // Roam: the highlight glides from element to element, each with its size.
        await hoverOn(CARD_C, 0.5);
        await wait(300);
        await hoverOn(CARD_B, 0.45);
        await wait(350);
        // Spacing on (the B key), then a click: the card's padding is drawn on it.
        toast('Spacing on');
        await wait(450);
        await click();
        patch({ hover: null, spacing: true });
        await wait(T.hold.spacing * 1000);
        patch({ spacing: false });
        await wait(150);
        await hoverOn(HEADING, 0.5, { x: 60, y: 18 });
        await wait(450);
        // Down to a word. The highlight stays on the heading until the pointer is on the word,
        // then glides to it and shrinks to fit, and the word takes the accent as it lands.
        await move(WORD.x + 16, WORD.y + 9, 0.45, 'text');
        patch({ hover: WORD });
        await wait(230);
        // Landed: the click comes at once, and the word takes the accent as the panel opens.
        setF((prev) => ({ ...prev, clicks: prev.clicks + 1, hover: null, wordHover: true, wordSelected: true, panel: 'type' }));
        await wait(T.hold.typography * 1000);
        // Open another section: the first closes, so the panel stays short.
        await move(COLOURS_HEADER.x, COLOURS_HEADER.y, 0.45, 'pointer');
        patch({ wordHover: false });
        await wait(120);
        await click();
        patch({ panel: 'colours' });
        await wait(T.hold.colours * 1000);

        }
        // ── Measure ────────────────────────────────────────────────────────────
        if (want('measure')) {
        await pick('measure');
        await hoverOn(CARD_A, 0.5);
        await click();
        patch({ pins: ['a'], hover: null });
        toast('Click another element to measure');
        await wait(200);
        await hoverOn(CARD_B, 0.5);
        await click();
        patch({ pins: ['a', 'b'], hover: null, lines: [lineAB] });
        await wait(800);
        await hoverOn(CARD_C, 0.5, { x: 70, y: 150 });
        await click();
        patch({ pins: ['a', 'b', 'c'], hover: null, lines: [lineAB, lineBC] });
        await wait(T.hold.measured * 1000);
        // Leave and come back: over a pinned element the cursor is a minus, and its size shows.
        await move(520, 352, 0.4);
        await wait(200);
        await move(CARD_C.x + 70, CARD_C.y + 130, 0.4, 'remove');
        patch({ hover: CARD_C });
        await wait(T.hold.unpinHover * 1000);
        await click();
        // Unpinned: its line draws back into the element it came from.
        patch({ pins: ['a', 'b'], lines: [lineAB], hover: null });
        look('crosshair');
        await wait(900);

        }
        // ── Guides ─────────────────────────────────────────────────────────────
        if (want('guides')) {
        await pick('guides', 90);
        // Straight from the toolbar to the card's corner in one motion. The preview lines are the
        // cursor's own crosshair extended, so they stay exactly on it the whole way.
        patch({ pins: [], lines: [], preview: { snapped: false } });
        await move(CARD_A.x, CARD_A.y, 0.95);
        // On the corner the lines lock to the card's edges and brighten.
        patch({ preview: { snapped: true } });
        await wait(550);
        await click();
        patch({ guideV: CARD_A.x, guideH: { y: CARD_A.y, dur: 0, strong: false }, preview: null });
        await wait(300);
        // A second pair on the far corner of the next card, so the two cards are boxed in.
        const right = CARD_B.x + CARD_B.w;
        const bottom = CARD_A.y + CARD_A.h;
        patch({ preview: { snapped: false } });
        await move(right, bottom, 0.7);
        patch({ preview: { snapped: true } });
        await wait(450);
        await click();
        patch({ guideV2: right, guideH2: bottom, preview: null });
        await wait(250);
        // Rest between them: the distance across and the distance down.
        const rest = { x: 228, y: 264 };
        patch({ preview: { snapped: false } });
        await move(rest.x, rest.y, 0.5);
        patch({ gaps: [
          { x1: CARD_A.x, y1: rest.y, x2: right, y2: rest.y, label: `${right - CARD_A.x}px`, at: { x: 300, y: rest.y + 14 } },
          { x1: rest.x, y1: CARD_A.y, x2: rest.x, y2: bottom, label: `${bottom - CARD_A.y}px`, at: { x: rest.x - 24, y: 232 } },
        ] });
        await wait(T.hold.gaps * 1000);
        // Onto the first guide: delete cursor, a hint about what a click or a drag does, and how far its neighbour is.
        patch({ gaps: [] });
        await move(330, CARD_A.y, 0.4);
        patch({
          preview: null, hint: 'Click to delete · Drag to move', guideH: { y: CARD_A.y, dur: 0, strong: true },
          gaps: [{ x1: 330, y1: CARD_A.y, x2: 330, y2: bottom, label: `${bottom - CARD_A.y}px`, at: { x: 357, y: 266 } }],
        });
        look('delete');
        await wait(T.hold.guideHint * 1000);
        // Drag it up; it catches the top edge of the tall block, and the gap is measured again.
        // One continuous drag: the guide and the cursor travel together and stop on the edge.
        patch({ hint: null, gaps: [], guideH: { y: CARD_C.y, dur: 0.85 * PACE, strong: true } });
        await move(330, CARD_C.y, 0.85, 'move');
        await wait(150);
        patch({ gaps: [{ x1: 330, y1: CARD_C.y, x2: 330, y2: bottom, label: `${bottom - CARD_C.y}px`, at: { x: 358, y: 184 } }] });
        await wait(T.hold.gapAfterDrag * 1000);
        patch({ guideH: { y: CARD_C.y, dur: 0, strong: false }, gaps: [] });
        look('delete');
        await wait(350);
        // Away from any guide, Delete clears them all.
        await move(330, 160, 0.3);
        patch({ guideV: null, guideH: null, guideV2: null, guideH2: null });
        toast('Guides cleared');
        await wait(500);

        }
        // ── Annotate ───────────────────────────────────────────────────────────
        if (want('annotate')) {
        await pick('annotate');
        await wait(250);
        // Size callout on a card
        await hoverOn(CARD_B, 0.45);
        await click();
        patch({ sizeMark: true, hover: null });
        await wait(T.hold.callout * 1000);
        // Arrow tool: draw, then grab the middle and bend it
        await move(toolBtn('arrow').x, toolBtn('arrow').y, 0.4, 'pointer');
        await click();
        patch({ tool: 'arrow' });
        await wait(350);
        // Its ends are a choice: give the tail a dot.
        await move(endBtn(0, 'Dot').x, endBtn(0, 'Dot').y, 0.35, 'pointer');
        await click();
        patch({ arrowStart: 'Dot' });
        await wait(300);
        await move(ARROW_FROM.x, ARROW_FROM.y, 0.5);
        await wait(120);
        patch({ arrow: 'straight' });
        await move(ARROW_TO.x, ARROW_TO.y, 0.5);
        await wait(250);
        await move(ARROW_MID.x, ARROW_MID.y, 0.35, 'grab');
        patch({ arrowHandles: true });
        await wait(350);
        patch({ arrow: 'bent' });
        await move(ARROW_BEND.x, ARROW_BEND.y, 0.4, 'grab');
        await wait(T.hold.arrowBent * 1000);
        // Note tool, in another colour
        patch({ arrowHandles: false });
        await move(toolBtn('note').x, toolBtn('note').y, 0.45, 'pointer');
        await click();
        patch({ tool: 'note' });
        await wait(200);
        await move(swatchAt(2).x, swatchAt(2).y, 0.3, 'pointer');
        await click();
        patch({ colour: BLUE });
        await wait(300);
        await move(NOTE_AT.x - 4, NOTE_AT.y + NOTE_SIZE.h, 0.45, 'text');
        await click();
        for (let i = 1; i <= NOTE_TEXT.length; i++) {
          patch({ note: NOTE_TEXT.slice(0, i) });
          await wait(T.typing);
        }
        await wait(T.hold.noteTyped * 1000);
        // Saved. Point at it and it is outlined, with a handle above it: drag the handle to turn the note.
        await move(NOTE_AT.x + NOTE_SIZE.w / 2, NOTE_AT.y + NOTE_SIZE.h / 2, 0.3, 'grab');
        patch({ noteActive: true });
        await wait(300);
        await move(NOTE_HANDLE.x, NOTE_HANDLE.y, 0.3, 'grab');
        await wait(200);
        patch({ noteAngle: T.note.turned });
        await move(NOTE_HANDLE.x - 3, NOTE_HANDLE.y + 1, 0.5, 'grab');
        await wait(T.hold.noteTurned * 1000);
        patch({ noteActive: false });
        // Pen: ink that is fuller where the hand is slow and thinner where it is quick.
        await move(toolBtn('pen').x, toolBtn('pen').y, 0.45, 'pointer');
        await click();
        patch({ tool: 'pen' });
        await wait(250);
        await move(INK[0]!.x, INK[0]!.y, 0.5, 'pen');
        await wait(150);
        for (let i = 1; i <= INK.length; i++) {
          const at = INK[i - 1]!;
          setF((prev) => ({ ...prev, ink: i, cursor: { x: at.x, y: at.y, kind: 'pen', dur: 0 } }));
          await wait(T.inkStep);
        }
        await wait(T.hold.ink * 1000);

        }
        // ── Screenshot: drag out a region ───────────────────────────────────────
        if (want('screenshot')) {
        await move(REGION_BTN.x, REGION_BTN.y, 0.5, 'pointer');
        await click();
        patch({ capturing: true });
        await wait(250);
        await move(REGION.x, REGION.y, 0.55);
        await wait(150);
        // Press, then drag to the opposite corner; the box grows with the cursor.
        patch({ region: { x: REGION.x, y: REGION.y, w: 0, h: 0, dur: 0 } });
        await wait(60);
        patch({ region: { ...REGION, dur: 0.75 * PACE } });
        await move(REGION.x + REGION.w, REGION.y + REGION.h, 0.75);
        await wait(380);
        // Released: that area is captured, and selection mode ends.
        setF((prev) => ({ ...prev, flash: prev.flash + 1, region: null, capturing: false }));
        await wait(250);
        toast('Screenshot saved', true);
        await wait(T.hold.saved * 1000);
        }

        patch({ fading: true });
        await wait(420);
      }
    };

    run().catch((err) => { if (!(err instanceof Cancelled)) throw err; });
    return () => { cancelled = true; };
    // `T` holds everything tunable the script reads; `PACE`, the note and the ink come from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce, sceneKey, T]);

  const onControls = f.cursor.y < 80 || (f.mode === 'annotate' && f.cursor.y < TRAY.y + trayHeight(f.tool) && f.cursor.x > TRAY.x && f.cursor.x < TRAY.x + TRAY.w);
  // The curve's control point: on the line while straight, pulled out so the curve passes through the bend handle.
  const arrowCtrl = f.arrow === 'bent' ? { x: 2 * ARROW_BEND.x - ARROW_MID.x, y: 2 * ARROW_BEND.y - ARROW_MID.y } : ARROW_MID;
  const arrowPath = `M${ARROW_FROM.x} ${ARROW_FROM.y} Q${arrowCtrl.x} ${arrowCtrl.y} ${ARROW_TO.x} ${ARROW_TO.y}`;
  // The head follows the direction the curve arrives from, so it stays in line with the shaft when bent.
  const arrowBack = Math.atan2(arrowCtrl.y - ARROW_TO.y, arrowCtrl.x - ARROW_TO.x);
  const wing = (spread: number): string => `${(ARROW_TO.x + 10 * Math.cos(arrowBack + spread)).toFixed(2)} ${(ARROW_TO.y + 10 * Math.sin(arrowBack + spread)).toFixed(2)}`;
  const arrowHead = `M${wing(-0.5)} L${ARROW_TO.x} ${ARROW_TO.y} L${wing(0.5)}`;
  const guideLine = (axis: 'h' | 'v', strong: boolean, at = 0): CSSProperties => ({
    position: 'absolute', background: f.colour, opacity: strong ? 0.85 : 0.5, transition: 'opacity 0.15s ease',
    ...(axis === 'h' ? { left: 0, right: 0, top: at, height: 1 } : { top: 28, bottom: 0, left: at, width: 1 }),
  });
  const previewAt = f.preview?.at ?? { x: f.cursor.x, y: f.cursor.y };
  // Hidden over the toolbar, as in the extension, and whenever nothing is being placed.
  const previewOpacity = f.preview && !onControls ? (f.preview.snapped ? 0.85 : 0.5) : 0;
  // When a click turns the hovered element into a pinned or marked one, the hover highlight
  // goes at once: the new highlight is already drawn in the same place.
  if (f.hover) lastHover.current = f.hover;
  const hoverReplaced = !f.hover && !!lastHover.current && (f.pins.some((p) => BOXES[p] === lastHover.current) || ((f.sizeMark || f.spacing) && lastHover.current === CARD_B));
  // Only Inspect reads corners: it outlines along them and adds the radius to the size.
  const hoverRadius = f.mode === 'inspect' && f.hover ? RADIUS_OF.get(f.hover) : undefined;
  const hoverIsPinned = !!f.hover && f.pins.some((p) => BOXES[p] === f.hover);
  const textColour = dark ? '#a3a3a3' : '#5c5c5c';

  const scale = Math.max(width / W, MIN_SCALE);
  /** How much of the stage the window shows, in stage pixels. */
  const view = Math.min(W, width / scale);
  // Pan only when the cursor nears an edge, so the view holds still while it works in one place.
  const margin = Math.min(PAN_MARGIN, view / 3);
  if (f.cursor.x < pan.current + margin) pan.current = f.cursor.x - margin;
  else if (f.cursor.x > pan.current + view - margin) pan.current = f.cursor.x - view + margin;
  pan.current = Math.max(0, Math.min(W - view, pan.current));
  const panX = pan.current;

  return (
    <div
      ref={wrap}
      role="img"
      aria-label="Animated simulation of Raval in a browser window: inspecting elements and a word, reading its typography and colours, reading a card's corner radius and padding, measuring gaps between cards and unpinning one, placing guides that snap to edges, reading the distance between them and dragging one, annotating with a size callout, an arrow, a note that is turned and a pen stroke, and dragging out a region to save as a screenshot."
      // The interactive demo should not treat this picture as part of the page.
      data-demo-ui="true"
      style={{
        position: 'relative', width: '100%', height: H * scale, overflow: 'hidden',
        borderRadius: 10 * scale, border: '1px solid var(--hd-edge)', background: 'var(--hd-page)',
        boxShadow: '0 18px 44px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.05)',
        userSelect: 'none', pointerEvents: 'none',
      }}
    >
      <Tune.Provider value={T}>
      <div aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, width: view, height: H, transform: `scale(${scale})`, transformOrigin: '0 0', fontFamily: SANS,
        // The stage sets its own type; it must not pick up the page's body size, leading or tracking.
        fontSize: 16, lineHeight: 1.5, letterSpacing: 'normal', textAlign: 'left',
        // Raval' own UI is light in both themes, so its text is always dark; the mock page sets its own colours.
        color: '#000',
      }}>
        <BrowserBar width={view} />

        {/* Everything below the bar; coordinates inside are page coordinates */}
        <motion.div
          initial={false} animate={{ x: -panX }} transition={{ duration: reduce ? 0 : Math.max(f.cursor.dur, 0.3), ease: EASE }}
          style={{ position: 'absolute', left: 0, top: SHIFT, width: W, height: H - SHIFT, opacity: f.fading ? 0 : 1, transition: 'opacity 0.4s ease' }}
        >
          {/* The page being worked on */}
          <div style={{ position: 'absolute', left: HEADING.x, top: HEADING.y, width: HEADING.w, height: HEADING.h, fontFamily: '"Ashbury", Georgia, serif', fontSize: 27, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: `${HEADING.h}px`, color: 'var(--hd-ink)' }}>
            Simple pricing
          </div>
          <div style={{ position: 'absolute', left: 56, top: 143, width: 320, fontSize: 12.5, lineHeight: '18px', color: 'var(--hd-ink-2)', whiteSpace: 'nowrap' }}>
            {/* "team" stays in the sentence's own flow, so the spaces either side of it are ordinary
                spaces and its highlight covers just the word, as a text selection would. WORD is
                where it lands. */}
            Start free, then pay as your{' '}
            <span data-hero-word="" style={{
              background: f.wordHover || f.wordSelected ? ACCENT : 'transparent', color: f.wordHover || f.wordSelected ? '#fff' : 'inherit',
              boxShadow: f.wordHover || f.wordSelected ? `0 0 0 1.5px ${ACCENT}` : 'none', borderRadius: 2,
              transition: 'background 0.14s ease, color 0.14s ease, box-shadow 0.14s ease',
            }}>
              team
            </span>{' '}
            grows.
          </div>
          {[CARD_A, CARD_B].map((c, i) => (
            <div key={i} style={{ position: 'absolute', left: c.x, top: c.y, width: c.w, height: c.h, boxSizing: 'border-box', borderRadius: 8, border: '1px solid var(--hd-card-line)', background: 'var(--hd-card)', padding: 12 }}>
              <div style={{ fontSize: 9, color: '#A3A3A3', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{i === 0 ? 'Starter' : 'Team'}</div>
              <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.03em', margin: '5px 0 9px', color: 'var(--hd-ink)' }}>{i === 0 ? '$0' : '$12'}</div>
              <div style={{ height: 5, width: '80%', borderRadius: 3, background: 'var(--hd-fill)', marginBottom: 5 }} />
              <div style={{ height: 5, width: '55%', borderRadius: 3, background: 'var(--hd-fill)' }} />
            </div>
          ))}
          <div style={{ position: 'absolute', left: CARD_C.x, top: CARD_C.y, width: CARD_C.w, height: CARD_C.h, boxSizing: 'border-box', borderRadius: 8, background: 'var(--hd-block)' }} />

          {/* ── Raval, drawn over the page ── */}

          {/* Guides */}
          {f.guideV !== null && <div style={guideLine('v', false, f.guideV)} />}
          {f.guideV2 !== null && <div style={guideLine('v', false, f.guideV2)} />}
          {f.guideH2 !== null && <div style={guideLine('h', false, f.guideH2)} />}
          {f.guideH && (
            <motion.div initial={false} animate={{ y: f.guideH.y }} transition={{ duration: f.guideH.dur, ease: EASE }} style={guideLine('h', f.guideH.strong) as MotionStyle} />
          )}
          {/* Always mounted and always tracking the cursor, only shown while placing: a preview
              that was created at its destination would sit there waiting for the cursor to arrive. */}
          <motion.div initial={false} animate={{ y: previewAt.y }} transition={{ duration: f.cursor.dur, ease: EASE }} style={{ ...guideLine('h', !!f.preview?.snapped), opacity: previewOpacity } as MotionStyle} />
          <motion.div initial={false} animate={{ x: previewAt.x }} transition={{ duration: f.cursor.dur, ease: EASE }} style={{ ...guideLine('v', !!f.preview?.snapped), opacity: previewOpacity } as MotionStyle} />
          {/* The distance between guides, where the pointer rests or from the guide it is on */}
          <AnimatePresence>
            {f.gaps.map((g) => <GapMark key={`${g.x1}-${g.y1}-${g.x2}-${g.y2}`} gap={g} colour={f.colour} />)}
          </AnimatePresence>
          {f.hint && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} style={{ ...chip, fontFamily: SANS, color: '#737373', left: f.cursor.x + 14, top: f.cursor.y + 14 } as MotionStyle}>
              {f.hint}
            </motion.div>
          )}

          {/* Measure: pinned elements and the lines between them */}
          <AnimatePresence>
            {f.pins.map((p) => <Highlight key={p} box={BOXES[p]} selected />)}
          </AnimatePresence>
          <AnimatePresence>
            {f.lines.map((l) => <MeasureLine key={l.id} line={l} />)}
          </AnimatePresence>
          <AnimatePresence>
            {f.pins.map((p) => <Badge key={p} box={BOXES[p]} letter={p.toUpperCase()} />)}
          </AnimatePresence>

          {/* Hover highlight and the size of what is under the pointer */}
          {/* Inspect, spacing on: the clicked card is outlined and its padding drawn on it */}
          <AnimatePresence>{f.spacing && <PaddingBands key="bands" box={CARD_B} pad={CARD_PAD} />}</AnimatePresence>
          <AnimatePresence>{f.spacing && <Highlight key="picked" box={CARD_B} selected hollow radius={CARD_RADIUS} />}</AnimatePresence>
          <AnimatePresence custom={hoverReplaced}>
            {f.hover && !hoverIsPinned && <Highlight key="hover" box={f.hover} radius={hoverRadius ?? 3} />}
          </AnimatePresence>
          {/* A word has no size label of its own; the details panel reports its paragraph. */}
          {f.hover && f.hover !== WORD && (
            <div style={{ ...chip, left: f.hover.x + (hoverIsPinned ? 12 : 0), top: f.hover.y - 22 }}>
              {f.hover.w} × {f.hover.h}{hoverRadius ? ` · R ${hoverRadius}` : ''}
            </div>
          )}

          {/* Annotate */}
          {f.sizeMark && (
            <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
              {/* The box is already highlighted when it is clicked, so the callout's box is there at once; only its measurement fades in. */}
              <rect x={CARD_B.x} y={CARD_B.y} width={CARD_B.w} height={CARD_B.h} rx="2" fill="rgba(255,69,0,0.12)" stroke={ACCENT} strokeWidth="1.5" />
              <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
                <path d={`M${CARD_B.x} ${CARD_B.y - 10}H${CARD_B.x + CARD_B.w}M${CARD_B.x} ${CARD_B.y - 13}v6M${CARD_B.x + CARD_B.w} ${CARD_B.y - 13}v6`} stroke={ACCENT} strokeWidth="1.2" strokeLinecap="round" />
                <text x={CARD_B.x + CARD_B.w / 2} y={CARD_B.y - 14} textAnchor="middle" fill={ACCENT} fontFamily={MONO} fontSize="9" fontWeight="600">{CARD_B.w}</text>
              </motion.g>
            </svg>
          )}
          {f.arrow && (
            <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }} fill="none" stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <motion.path initial={{ pathLength: 0, d: arrowPath }} animate={{ pathLength: 1, d: arrowPath }} transition={{ pathLength: { duration: 0.5 * PACE, ease: EASE }, d: { duration: 0.4 * PACE, ease: EASE } }} />
              <motion.path
                initial={{ opacity: 0, d: arrowHead }} animate={{ opacity: 1, d: arrowHead }}
                transition={{ opacity: { duration: 0.1, delay: 0.42 * PACE }, d: { duration: 0.4 * PACE, ease: EASE } }}
              />
              {/* The tail's dot is there from the first moment of the drag */}
              {f.arrowStart === 'Dot' && <circle cx={ARROW_FROM.x} cy={ARROW_FROM.y} r="2.8" fill={ACCENT} stroke="none" />}
              {f.arrowHandles && [ARROW_FROM, ARROW_TO, f.arrow === 'bent' ? ARROW_BEND : ARROW_MID].map((p, i) => (
                <motion.circle key={i} r={i === 2 ? 3 : 3.6} fill={i === 2 && f.arrow === 'bent' ? ACCENT : '#fff'} strokeWidth="1.3" initial={false} animate={{ cx: p.x, cy: p.y }} transition={{ duration: 0.4 * PACE, ease: EASE }} />
              ))}
            </svg>
          )}
          {f.note && (
            <motion.div
              // Turns about its centre, so it stays where it was put.
              initial={false} animate={{ rotate: f.noteAngle }} transition={{ duration: 0.5 * PACE, ease: EASE }}
              style={{ position: 'absolute', left: NOTE_AT.x, top: NOTE_AT.y, color: BLUE, fontFamily: '"Caveat", "Bradley Hand", "Segoe Print", cursive', fontSize: NOTE_AT.size, fontWeight: 600, whiteSpace: 'nowrap', textShadow: 'var(--hd-note-shadow)' }}
            >
              {f.note}
              {/* Pointed at: outlined, with the handle that turns it. Drawn inside the note so they turn together. */}
              {f.noteActive && (
                <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.12 }} style={{ position: 'absolute', inset: -3, border: '1px dashed rgba(37, 99, 235, 0.6)', borderRadius: 3 }}>
                  <span style={{ position: 'absolute', left: '50%', top: -7, width: 1, height: 6, marginLeft: -0.5, background: 'rgba(37, 99, 235, 0.6)' }} />
                  <span style={{ position: 'absolute', left: '50%', top: -14, width: 7, height: 7, marginLeft: -4.5, borderRadius: '50%', background: '#fff', border: `1.3px solid ${BLUE}` }} />
                </motion.span>
              )}
            </motion.div>
          )}
          {f.ink > 0 && (
            <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
              {/* A filled outline, not a stroked line; the end tapers once the pen lifts */}
              <path d={inkPathData(INK.slice(0, f.ink), T.ink.size, f.ink >= INK.length)} fill={BLUE} />
            </svg>
          )}

          {/* Inspect details */}
          <AnimatePresence>
            {f.panel && (
              <motion.div
                key="panel"
                initial={{ opacity: 0, y: PANEL.y - 4, scale: 0.98 }} animate={{ opacity: 1, y: PANEL.y, scale: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.16, ease: 'easeOut' }}
                style={{ position: 'absolute', left: PANEL.x, top: 0, width: PANEL.w, background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 10, boxShadow: SHADOW, overflow: 'hidden', transformOrigin: 'top left' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: PANEL_HEAD, padding: '0 9px', fontFamily: MONO, fontSize: 9, boxSizing: 'border-box' }}>
                  <span style={{ color: '#737373' }}>&lt;p&gt;</span><span>320 × 18</span>
                </div>
                <PanelSection title="Typography" open={f.panel === 'type'} summary={<span style={{ color: '#A3A3A3', fontWeight: 400 }}>Neue Plak</span>}>
                  <PanelRow label="Font" value="Neue Plak" />
                  <PanelRow label="Size" value="12.5px" />
                  <PanelRow label="Weight" value="400 Regular" />
                  <PanelRow label="Line height" value="18px / 1.44" />
                </PanelSection>
                <PanelSection title="Colours" open={f.panel === 'colours'} summary={<span style={{ width: 8, height: 8, borderRadius: '50%', background: textColour, border: `1px solid ${BORDER}` }} />}>
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

          <Toolbar mode={f.mode} capturing={f.capturing} />
          <AnimatePresence>{f.mode === 'annotate' && <Tray key="tray" tool={f.tool} colour={f.colour} arrowStart={f.arrowStart} />}</AnimatePresence>

          {/* Toast */}
          <AnimatePresence>
            {f.toast && (
              <motion.div
                key={f.toast.text}
                initial={{ opacity: 0, y: 14, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: 14, x: '-50%' }} transition={{ duration: 0.3, ease: 'easeOut' }}
                style={{ position: 'absolute', left: panX + view / 2, bottom: 14, display: 'flex', alignItems: 'center', gap: 5, padding: '5px 9px', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 7, boxShadow: SHADOW_SM, fontSize: 9.5, fontWeight: 500, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}
              >
                {f.toast.ok && <svg width="10" height="10" viewBox="0 0 20 20" fill="#16a34a"><path fillRule="evenodd" clipRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" /></svg>}
                {f.toast.text}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Region capture: everything outside the box is dimmed while it is dragged out */}
          {f.region && (
            <motion.div
              initial={false} animate={{ width: f.region.w, height: f.region.h }} transition={{ duration: f.region.dur, ease: EASE }}
              style={{ position: 'absolute', left: f.region.x, top: f.region.y, boxSizing: 'border-box', border: `1.5px solid ${ACCENT}`, boxShadow: '0 0 0 2000px rgba(0,0,0,0.32)' }}
            >
              {/* The size is shown once the drag has reached its corner, when the number is true */}
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: f.region.w > 0 ? 1 : 0 }} transition={{ duration: 0.12, delay: f.region.dur }} style={{ ...chip, right: 0, top: '100%', marginTop: 6 } as MotionStyle}>
                {REGION.w} × {REGION.h}
              </motion.div>
            </motion.div>
          )}

          {/* The captured area flashes */}
          {f.flash > 0 && (
            <motion.div key={f.flash} initial={{ opacity: 0.8 }} animate={{ opacity: 0 }} transition={{ duration: 0.45, ease: 'easeOut' }} style={{ position: 'absolute', left: REGION.x, top: REGION.y, width: REGION.w, height: REGION.h, background: '#fff' }} />
          )}

          {/* The cursor, with a ring on each click */}
          <motion.div
            animate={{ x: f.cursor.x, y: f.cursor.y }} transition={{ duration: f.cursor.dur, ease: EASE }}
            style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0 }}
          >
            {f.clicks > 0 && (
              <motion.span
                key={f.clicks}
                initial={{ opacity: 0.5, scale: 0.4 }} animate={{ opacity: 0, scale: 1.6 }} transition={{ duration: 0.4, ease: 'easeOut' }}
                style={{ position: 'absolute', left: -9, top: -9, width: 18, height: 18, borderRadius: '50%', border: `1.5px solid ${ACCENT}`, boxSizing: 'border-box' }}
              />
            )}
            <CursorGlyph kind={onControls ? 'pointer' : f.cursor.kind} colour={f.colour} />
          </motion.div>
        </motion.div>
      </div>
      </Tune.Provider>
    </div>
  );
}
