'use client';
import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

const ACCENT = '#FF4500';
const BLUE = '#2F6BFF';
const MONO = `'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace`;
/** How the drawings move: away, across, and a soft arrival. */
const TRAVEL = { duration: 0.45, ease: [0.45, 0, 0.1, 1] } as const;

/** A small drawing of each tool, in the colours the extension itself uses. */
const SVG = { viewBox: '0 0 200 96', width: '100%', fill: 'none', 'aria-hidden': true } as const;
// Neutrals come from classes in globals.css so the drawings follow the theme.
const block = { className: 'tile-block' } as const;
const label = { fontFamily: MONO, fontSize: 8.5, fontWeight: 500 } as const;

/**
 * A value that changes rolls: the old one leaves upward as the new one arrives from below.
 * `x` and `y` are the text's anchor; the rest are passed to the text.
 */
function Roll({ value, x, y, ...text }: { value: string; x: number; y: number } & React.SVGProps<SVGTextElement>) {
  return (
    // On SVG, motion's `y` is a transform, so the anchor is the group's and the text only travels.
    <g transform={`translate(${x} ${y})`}>
      <AnimatePresence initial={false}>
        <motion.text
          key={value}
          initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          {...(text as object)}
        >
          {value}
        </motion.text>
      </AnimatePresence>
    </g>
  );
}

/**
 * Each tile's drawing is a finished still at rest. On hover the tool does its one small thing,
 * and leaving glides it back. `hot` is the hover.
 */
type Art = (hot: boolean) => ReactNode;

const TILES: { name: string; hint: string; art: Art }[] = [
  {
    // The highlight moves from the card to a line of text in it, and reads out that line's size.
    name: 'Inspect', hint: '1',
    art: (hot) => (
      <svg {...SVG}>
        <rect x="52" y="30" width="56" height="6" rx="3" className="tile-bar" fillOpacity="0.16" />
        <rect x="52" y="43" width="84" height="6" rx="3" className="tile-bar" fillOpacity="0.08" />
        <motion.rect
          initial={false} rx="3" fill="rgba(255,69,0,0.12)" stroke={ACCENT}
          animate={hot ? { attrX: 49, attrY: 27, width: 62, height: 12 } : { attrX: 40, attrY: 18, width: 120, height: 44 }} transition={TRAVEL}
        />
        <rect x="72" y="70" width="56" height="16" rx="5" className="tile-chip" />
        <Roll value={hot ? '112 × 12' : '240 × 88'} x={100} y={81} textAnchor="middle" className="tile-ink" {...label} />
      </svg>
    ),
  },
  {
    // The second element moves away, and the gap is measured again.
    name: 'Measure', hint: '2',
    art: (hot) => {
      const bx = hot ? 140 : 124;
      return (
        <svg {...SVG}>
          <rect x="22" y="26" width="54" height="44" rx="3" fill="rgba(255,69,0,0.12)" stroke={ACCENT} />
          <motion.g initial={false} animate={{ x: bx - 124 }} transition={TRAVEL}>
            <rect x="124" y="26" width="54" height="44" rx="3" fill="rgba(255,69,0,0.12)" stroke={ACCENT} />
            <circle cx="124" cy="26" r="7" fill={ACCENT} />
            <text x="124" y="29" textAnchor="middle" fill="#fff" {...label}>B</text>
            <path d="M124 44v8" stroke={ACCENT} />
          </motion.g>
          <path d="M76 44v8" stroke={ACCENT} />
          <motion.path initial={false} animate={{ d: `M76 48H${bx}` }} transition={TRAVEL} stroke={ACCENT} />
          <motion.g initial={false} animate={{ x: (bx - 124) / 2 }} transition={TRAVEL}>
            <rect x="88" y="29" width="24" height="14" rx="4" fill={ACCENT} />
            <Roll value={hot ? '64' : '48'} x={100} y={39} textAnchor="middle" fill="#fff" {...label} />
          </motion.g>
          <circle cx="22" cy="26" r="7" fill={ACCENT} />
          <text x="22" y="29" textAnchor="middle" fill="#fff" {...label}>A</text>
        </svg>
      );
    },
  },
  {
    // A guide is brought up and snaps to the block's bottom edge, with its position.
    name: 'Guides', hint: '3',
    art: (hot) => (
      <svg {...SVG}>
        <rect x="58" y="28" width="84" height="40" rx="3" {...block} />
        <path d="M58 0v96M0 28h200" stroke={ACCENT} />
        <path d="M142 0v96" stroke={ACCENT} strokeOpacity="0.4" strokeDasharray="3 3" />
        <motion.g initial={false} animate={hot ? { y: 0, opacity: 1 } : { y: 22, opacity: 0 }} transition={TRAVEL}>
          <path d="M0 68h200" stroke={ACCENT} />
          <rect x="20" y="72" width="26" height="14" rx="4" className="tile-chip" />
          <text x="33" y="82" textAnchor="middle" className="tile-ink" {...label}>68</text>
        </motion.g>
        <rect x="146" y="76" width="30" height="14" rx="4" className="tile-chip" />
        <text x="161" y="86" textAnchor="middle" className="tile-ink" {...label}>142</text>
      </svg>
    ),
  },
  {
    // The note is underlined with the pen, drawn as a hand would.
    name: 'Annotate', hint: '4',
    art: (hot) => (
      <svg {...SVG}>
        <rect x="24" y="44" width="70" height="34" rx="3" {...block} />
        <path d="M150 30C132 22 112 30 100 46" stroke={BLUE} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M100 46l1.5-9M100 46l9-2" stroke={BLUE} strokeWidth="1.5" strokeLinecap="round" />
        <text x="122" y="52" fill={BLUE} fontFamily={`'Caveat', 'Bradley Hand', 'Segoe Print', cursive`} fontSize="13">
          more space
        </text>
        <motion.path
          d="M121 59C138 57 156 58 176 56" stroke={BLUE} strokeWidth="1.5" strokeLinecap="round"
          initial={false} animate={{ pathLength: hot ? 1 : 0, opacity: hot ? 1 : 0 }}
          transition={{ pathLength: { duration: 0.5, ease: [0.45, 0, 0.1, 1] }, opacity: { duration: hot ? 0.05 : 0.25 } }}
        />
      </svg>
    ),
  },
  {
    // The selection tightens to the content it holds, and its size follows.
    name: 'Screenshot', hint: 'S',
    art: (hot) => {
      const r = hot ? { x: 26, y: 16, w: 110, h: 66 } : { x: 20, y: 10, w: 124, h: 76 };
      return (
        <svg {...SVG}>
          <rect x="30" y="20" width="62" height="20" rx="3" {...block} />
          <rect x="30" y="48" width="100" height="28" rx="3" {...block} />
          <motion.rect initial={false} animate={{ attrX: r.x, attrY: r.y, width: r.w, height: r.h }} transition={TRAVEL} className="tile-rule" strokeDasharray="4 3" />
          {[[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j]) => (
            <motion.rect
              key={`${i}-${j}`} initial={false} width="5" height="5" className="tile-chip tile-rule"
              animate={{ attrX: r.x + i! * r.w - 2.5, attrY: r.y + j! * r.h - 2.5 }} transition={TRAVEL}
            />
          ))}
          <motion.g initial={false} animate={{ x: r.x + r.w - 144, y: r.y + r.h - 86 }} transition={TRAVEL}>
            <Roll value={`${r.w} × ${r.h}`} x={150} y={94} className="tile-dim" {...label} />
          </motion.g>
        </svg>
      );
    },
  },
  {
    // A token is picked and copied.
    name: 'Design tokens', hint: 'D',
    art: (hot) => (
      <svg {...SVG}>
        <motion.rect
          x="26" y="11" width="146" height="16" rx="4" className="tile-chip"
          initial={false} animate={{ opacity: hot ? 1 : 0 }} transition={{ duration: 0.15 }}
        />
        {[
          ['--accent', '#FF4500', ACCENT],
          ['--text', '#000000', '#000'],
          ['--muted', '#737373', '#737373'],
          ['--surface', '#F7F7F7', '#F7F7F7'],
        ].map(([name, value, fill], i) => (
          <g key={name} transform={`translate(34 ${14 + i * 20})`}>
            <rect width="10" height="10" rx="2" fill={fill} stroke="rgba(128,128,128,0.35)" />
            <text x="18" y="8.5" className="tile-ink" {...label}>{name}</text>
            {i === 0
              ? <Roll value={hot ? 'Copied' : value!} x={132} y={8.5} textAnchor="end" className="tile-dim" {...label} />
              : <text x="132" y="8.5" textAnchor="end" className="tile-dim" {...label}>{value}</text>}
          </g>
        ))}
      </svg>
    ),
  },
];

function Tile({ name, hint, art }: { name: string; hint: string; art: Art }) {
  const reduce = useReducedMotion();
  const [hot, setHot] = useState(false);
  // Only a mouse hovers; a tap on a touch screen leaves the still as it is.
  const enter = (e: React.PointerEvent): void => { if (e.pointerType === 'mouse' && !reduce) setHot(true); };
  return (
    <li className="lp-tile">
      <div className="lp-tile-card" onPointerEnter={enter} onPointerLeave={() => setHot(false)}>
        <span className="lp-tile-art">{art(hot)}</span>
        <span className="lp-tile-caption">
          <span>{name}</span>
          <kbd><span className="sr-only">, shortcut </span>{hint}</kbd>
        </span>
      </div>
    </li>
  );
}

/** The six-cell grid from the landing page: one cell per tool, each doing its one thing on hover. */
export function FeatureTiles() {
  return (
    <ul className="lp-tiles" aria-label="What Raval does">
      {TILES.map((t) => <Tile key={t.name} {...t} />)}
    </ul>
  );
}
