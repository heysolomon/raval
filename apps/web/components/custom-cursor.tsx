'use client';
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useDemo, onColor, type DemoCursor } from './demo-provider';

const ARROWS = 'M0 -8.5V8.5M-3.5 -5L0 -8.5L3.5 -5M-3.5 5L0 8.5L3.5 5';

type Glyph = 'crosshair' | 'delete' | 'remove' | 'move' | 'pen' | 'grab';

const GLYPH_OF: Record<DemoCursor, Glyph | null> = {
  crosshair: 'crosshair', text: null, delete: 'delete', remove: 'remove', 'move-x': 'move', 'move-y': 'move', pen: 'pen', ibeam: null, grab: 'grab',
};

/** A pen whose tip is the hot spot, for drawing freehand. */
const PEN = 'M0 0L1.3 -4.4L10.2 -13.3a1.9 1.9 0 0 1 2.7 0l0.4 0.4a1.9 1.9 0 0 1 0 2.7L4.4 -1.3Z';

/**
 * The demo's cursor, matching the extension: a crosshair that pops into a
 * delete badge over a guide and into arrows while one is dragged, and steps
 * aside for the browser's own text cursor over words and while placing a note.
 */
export function CustomCursor() {
  const { anyTool, cursor, color } = useDemo();
  // Drawn in the mark colour; what sits on or around it flips to dark when that colour is light.
  const on = onColor(color);
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [overUI, setOverUI] = useState(false);

  const enabled = anyTool && !reduceMotion;
  const glyph = GLYPH_OF[cursor];
  const showMark = enabled && !overUI && glyph !== null;

  useEffect(() => {
    if (!enabled) return;
    function onMove(e: MouseEvent) {
      // Written straight to the element: a transform, no re-render, no layout.
      if (ref.current) ref.current.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
      const el = e.target as HTMLElement | null;
      setOverUI(!!el?.closest?.('[data-demo-ui="true"]'));
    }
    document.addEventListener('mousemove', onMove, { passive: true });
    return () => document.removeEventListener('mousemove', onMove);
  }, [enabled]);

  if (!enabled) return null;

  const layer = (name: Glyph, turn = ''): React.CSSProperties => ({
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    opacity: glyph === name ? 1 : 0,
    transform: `scale(${glyph === name ? 1 : 0.6})${turn}`,
    // Slight overshoot so a change of meaning reads as a "pop"
    transition: 'opacity 0.14s ease-out, transform 0.18s cubic-bezier(0.34, 1.4, 0.64, 1)',
  });

  return (
    <>
      {/* Links and buttons set their own cursor, which would otherwise show next to the mark. */}
      {showMark && <style>{`body, body * { cursor: none !important; }`}</style>}
      {/* A note can go anywhere, so the I-beam is asked for rather than left to whatever is underneath. */}
      {cursor === 'ibeam' && !overUI && <style>{`body, body *:not([data-demo-ui="true"], [data-demo-ui="true"] *) { cursor: text !important; }`}</style>}
      <div
        ref={ref}
        data-demo-ui="true"
        aria-hidden="true"
        style={{
          position: 'fixed', left: 0, top: 0, width: 18, height: 18, margin: '-9px 0 0 -9px',
          transform: 'translate3d(-200px, -200px, 0)', willChange: 'transform',
          pointerEvents: 'none', zIndex: 99999, visibility: showMark ? 'visible' : 'hidden',
        }}
      >
        <div style={layer('crosshair')}>
          <svg width="18" height="18" viewBox="-9 -9 18 18" style={{ display: 'block', overflow: 'visible' }}>
            <line x1="-9" y1="0" x2="-4" y2="0" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="4" y1="0" x2="9" y2="0" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="0" y1="-9" x2="0" y2="-4" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="0" y1="4" x2="0" y2="9" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="0" cy="0" r="2.5" stroke={color} strokeWidth="1.5" fill="none" />
          </svg>
        </div>
        <div style={layer('delete')}>
          <svg width="22" height="22" viewBox="-11 -11 22 22" style={{ display: 'block', overflow: 'visible', flexShrink: 0 }}>
            <circle r="9.5" fill={color} stroke={on} strokeWidth="1.5" />
            <path d="M-3.25 -3.25L3.25 3.25M3.25 -3.25L-3.25 3.25" stroke={on} strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </div>
        <div style={layer('remove')}>
          <svg width="22" height="22" viewBox="-11 -11 22 22" style={{ display: 'block', overflow: 'visible', flexShrink: 0 }}>
            <circle r="9.5" fill={color} stroke={on} strokeWidth="1.5" />
            <path d="M-4.25 0H4.25" stroke={on} strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </div>
        <div style={layer('pen')}>
          <svg width="18" height="18" viewBox="-9 -9 18 18" strokeLinejoin="round" strokeLinecap="round" style={{ display: 'block', overflow: 'visible', flexShrink: 0 }}>
            <path d={PEN} fill={on} stroke={on} strokeWidth="4" />
            <path d={PEN} fill={on} stroke={color} strokeWidth="1.5" />
          </svg>
        </div>
        <div style={layer('grab')}>
          <svg width="18" height="18" viewBox="-9 -9 18 18" style={{ display: 'block', overflow: 'visible', flexShrink: 0 }}>
            <circle r="6.5" fill={on} />
            <circle r="5" fill={on} stroke={color} strokeWidth="1.75" />
          </svg>
        </div>
        <div style={layer('move', cursor === 'move-x' ? ' rotate(90deg)' : '')}>
          <svg width="22" height="22" viewBox="-11 -11 22 22" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', overflow: 'visible', flexShrink: 0 }}>
            <path d={ARROWS} stroke={on} strokeWidth="4.5" />
            <path d={ARROWS} stroke={color} strokeWidth="1.75" />
          </svg>
        </div>
      </div>
    </>
  );
}
