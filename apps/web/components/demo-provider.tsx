'use client';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/** Same modes as the extension. Colours and box values live inside Inspect. With none on, the page is simply browsed. */
export type DemoKey = 'inspect' | 'measure' | 'guides' | 'annotate';

/** What the demo cursor should look like, set by the active tool. */
export type DemoCursor = 'crosshair' | 'text' | 'delete' | 'remove' | 'move-x' | 'move-y' | 'pen' | 'ibeam' | 'grab';

/** The colour every tool draws in: the brand accent, as the extension starts out. */
const MARK_COLOR = '#FF4500';

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A mark colour at the given opacity. */
export function tint(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** What to draw on top of a mark colour: white, or near-black on a light one. */
export function onColor(hex: string): string {
  const [r, g, b] = channels(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.75 ? '#111111' : '#ffffff';
}

interface DemoCtx {
  isOpen:    boolean;
  inspect:   boolean;
  measure:   boolean;
  guides:    boolean;
  annotate:  boolean;
  anyTool:   boolean;
  cursor:    DemoCursor;
  setCursor: (c: DemoCursor) => void;
  /** The one colour every tool draws in: guides, highlights, measurements, annotations. */
  color:     string;
  open:      () => void;
  close:     () => void;
  toggle:    (k: DemoKey) => void;
  reset:     () => void;
}

const Ctx = createContext<DemoCtx | null>(null);
const OFF = { inspect: false, measure: false, guides: false, annotate: false };

export function DemoProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [tools, setTools]   = useState(OFF);
  const [cursor, setCursorState] = useState<DemoCursor>('crosshair');

  // Stable identity: tools pass this to effects that must not re-run on every render.
  const setCursor = useCallback((c: DemoCursor) => setCursorState(c), []);

  const value = useMemo<DemoCtx>(() => ({
    isOpen,
    ...tools,
    anyTool: tools.inspect || tools.measure || tools.guides || tools.annotate,
    cursor,
    setCursor,
    color: MARK_COLOR,
    open:   () => setIsOpen(true),
    close:  () => { setIsOpen(false); setTools(OFF); setCursorState('crosshair'); },
    toggle: (k) => { setCursorState('crosshair'); setTools((p) => (p[k] ? { ...OFF } : { ...OFF, [k]: true })); },
    reset:  () => { setTools(OFF); setCursorState('crosshair'); },
  }), [isOpen, tools, cursor, setCursor]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDemo(): DemoCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDemo must be inside <DemoProvider>');
  return ctx;
}
