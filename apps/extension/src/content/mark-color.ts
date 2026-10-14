/**
 * The one colour Raval draws on the page with: guide lines, element highlights,
 * measurement lines, the pointer mark, and every new annotation. Picked once in
 * the options card and used by every mode. Annotations keep the colour they were
 * made in, so a page can still be marked up in several.
 *
 * Raval's own controls (toolbar, cards, toasts) stay in the brand colour.
 */
import { loadMarkColor as readSaved, saveMarkColor } from './storage';
import { markActive } from './frame';

/** Palette — first entry is the design-system primary / accent. */
export const MARK_COLORS = [
  { id: 'accent',  hex: '#FF4500', label: 'Accent'  },
  { id: 'pink',    hex: '#FF2D85', label: 'Pink'    },
  { id: 'blue',    hex: '#2563EB', label: 'Blue'    },
  { id: 'green',   hex: '#16A34A', label: 'Green'   },
  { id: 'purple',  hex: '#7C3AED', label: 'Purple'  },
  { id: 'amber',   hex: '#D97706', label: 'Amber'   },
  { id: 'black',   hex: '#111111', label: 'Black'   },
  { id: 'white',   hex: '#FFFFFF', label: 'White'   },
] as const;

let color: string = MARK_COLORS[0].hex;
const listeners = new Set<(hex: string) => void>();

function channels(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function getMarkColor(): string {
  return color;
}

/** The mark colour at the given opacity. */
export function markRgba(alpha: number): string {
  const [r, g, b] = channels(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** What to draw on top of the mark colour (a badge letter, a delete cross): white, or near-black on a light colour. */
export function onMarkColor(): string {
  const [r, g, b] = channels(color);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.75 ? '#111111' : '#ffffff';
}

export function setMarkColor(hex: string, save = true): void {
  if (hex.toLowerCase() === color.toLowerCase()) return;
  color = hex;
  if (save) saveMarkColor(hex);
  for (const fn of listeners) fn(hex);
  markActive();
}

/** Run `fn` whenever the mark colour changes. */
export function onMarkColorChange(fn: (hex: string) => void): void {
  listeners.add(fn);
}

/** Restore the colour picked in an earlier session. */
export async function loadMarkColor(): Promise<void> {
  const saved = await readSaved();
  if (saved && MARK_COLORS.some((c) => c.hex.toLowerCase() === saved.toLowerCase())) setMarkColor(saved, false);
}
