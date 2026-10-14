/**
 * Annotate mode — notebook-style UI critique overlays.
 * Pin element measurements, write notes, draw arrows / freehand, export via screenshot.
 * Each annotation stores its own colour from a palette (design-system accent by default).
 */
import type { Rect } from '@raval/shared';
import type { OverlayElements } from '../overlay';
import { getElementAtPoint, getElementRect } from '../detector';
import { clearCanvas, drawRulers, drawElementHighlight } from '../renderer';
import { isRavalElement, uid, toPageX, toPageY, toViewX, toViewY } from '../utils';
import { showToast } from '../labels';
import { BoxSpring, boxToRect } from '../motion';
import { setSegmented } from '../tokens';
import { onPageChange, createPageShelf } from '../page-scope';
import { hoverSuppressed } from '../pointer';
import { setCursorResolver, refreshCursor } from '../cursor';
import { addRenderer, markActive } from '../frame';
import { inkPath } from '../ink';
import { getMarkColor, markRgba, onMarkColor, onMarkColorChange } from '../mark-color';

export type AnnotateTool = 'measure' | 'note' | 'arrow' | 'pen';

/** Note text sizes offered in the options card. */
export const NOTE_SIZES = [
  { id: '14', label: 'S',  px: 14 },
  { id: '18', label: 'M',  px: 18 },
  { id: '24', label: 'L',  px: 24 },
  { id: '32', label: 'XL', px: 32 },
] as const;
const DEFAULT_NOTE_SIZE = 18;
let noteSize: number = DEFAULT_NOTE_SIZE;
let noteKeysExplained = false;

/**
 * Handwriting faces offered for notes. None are shipped: each is a stack of fonts that
 * come with macOS or Windows, ending in the browser's own cursive face.
 */
export const NOTE_FONTS = [
  { id: 'hand',   label: 'Hand',   stack: `"Segoe Print", "Bradley Hand", "Comic Sans MS", "Apple Chancery", cursive` },
  { id: 'marker', label: 'Marker', stack: `"Marker Felt", "Ink Free", "Comic Sans MS", cursive` },
  { id: 'neat',   label: 'Neat',   stack: `"Noteworthy", "Chalkboard SE", "MV Boli", "Comic Sans MS", cursive` },
  { id: 'script', label: 'Script', stack: `"Snell Roundhand", "Segoe Script", "Brush Script MT", cursive` },
] as const;

export type NoteFontId = (typeof NOTE_FONTS)[number]['id'];
let noteFont: NoteFontId = 'hand';

function noteFontStack(id: string | undefined): string {
  return (NOTE_FONTS.find((f) => f.id === id) ?? NOTE_FONTS[0]).stack;
}

export function getNoteFont(): NoteFontId {
  return noteFont;
}

/** Face for new notes; a note being written right now takes it straight away. */
export function setNoteFont(id: NoteFontId): void {
  noteFont = id;
  if (state.noteDraft) {
    state.noteDraft.font = id;
    state.noteDraft.el.style.fontFamily = noteFontStack(id);
    // Let the field re-fit its height to the new face.
    state.noteDraft.el.dispatchEvent(new Event('input'));
  }
}

export function getNoteSize(): number {
  return noteSize;
}

/** Size for new notes; a note being written right now takes it straight away. */
export function setNoteSize(px: number): void {
  noteSize = px;
  if (state.noteDraft) {
    state.noteDraft.size = px;
    state.noteDraft.el.style.fontSize = `${px}px`;
    // Let the field re-fit its height to the new size.
    state.noteDraft.el.dispatchEvent(new Event('input'));
  }
}

/** Pen widths offered in the options card. */
export const PEN_SIZES = [
  { id: '3',  label: 'S',  px: 3 },
  { id: '5',  label: 'M',  px: 5 },
  { id: '8',  label: 'L',  px: 8 },
  { id: '13', label: 'XL', px: 13 },
] as const;
const DEFAULT_PEN_SIZE = 5;
let penSize: number = DEFAULT_PEN_SIZE;

export function getPenSize(): number {
  return penSize;
}

export function setPenSize(px: number): void {
  penSize = px;
}

/** What an arrow's line ends in. */
export type ArrowEnd = 'none' | 'arrow' | 'bar' | 'dot';

export const ARROW_ENDS: { id: ArrowEnd; label: string }[] = [
  { id: 'none',  label: 'None'  },
  { id: 'arrow', label: 'Arrow' },
  { id: 'bar',   label: 'Bar'   },
  { id: 'dot',   label: 'Dot'   },
];

/** Ends given to new arrows. A plain line is `none` at both. */
const arrowEnds: { start: ArrowEnd; end: ArrowEnd } = { start: 'none', end: 'arrow' };

export function getArrowEnd(side: 'start' | 'end'): ArrowEnd {
  return arrowEnds[side];
}

export function setArrowEnd(side: 'start' | 'end', kind: ArrowEnd): void {
  arrowEnds[side] = kind;
}

interface MeasureAnn {
  id: string;
  kind: 'measure';
  el: Element;
  color: string;
}

/** Note / arrow / stroke store document (page) coordinates so they scroll with content. */
interface NoteAnn {
  id: string;
  kind: 'note';
  x: number;
  y: number;
  text: string;
  color: string;
  /** Font size in px. Older notes without one use the default. */
  size?: number;
  /** Which of NOTE_FONTS it is written in. Older notes without one use the first. */
  font?: string;
  /** Rotation in degrees about the top-left corner. Notes that were never rotated keep the default tilt. */
  angle?: number;
}

interface ArrowAnn {
  id: string;
  kind: 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** A point the arrow curves through. Absent or null for a straight arrow. */
  bend?: { x: number; y: number } | null;
  color: string;
  /** What each end is drawn with. Older arrows have neither: no start, an arrowhead at the end. */
  start?: ArrowEnd;
  end?: ArrowEnd;
}

interface StrokeAnn {
  id: string;
  kind: 'stroke';
  points: { x: number; y: number }[];
  color: string;
  /** Nominal width in px. */
  size?: number;
}

type Annotation = MeasureAnn | NoteAnn | ArrowAnn | StrokeAnn;

interface AnnotateState {
  tool: AnnotateTool;
  items: Annotation[];
  hoveredRect: Rect | null;
  mouseX: number;
  mouseY: number;
  drawing: boolean;
  interactive: boolean;
  /** Drafts use viewport coords while drawing. */
  draftArrow: { x1: number; y1: number; x2: number; y2: number } | null;
  draftStroke: { x: number; y: number }[];
  /** Draft note stores document coords. */
  noteDraft: { x: number; y: number; el: HTMLTextAreaElement; color: string; size: number; font: NoteFontId } | null;
}

/** Size callouts are always lettered in the first face. */
const NOTE_FONT: string = NOTE_FONTS[0].stack;
/** Shared by a saved note and the one being typed, so saving does not shift or restyle the text. */
const NOTE_MAX_WIDTH = 240;
const NOTE_TEXT_SHADOW = '0 1px 0 rgba(255,255,255,0.85)';
const DEFAULT_NOTE_ANGLE = -1.5;
const NOTE_TILT = `rotate(${DEFAULT_NOTE_ANGLE}deg)`;

const state: AnnotateState = {
  tool: 'measure',
  items: [],
  hoveredRect: null,
  mouseX: 0,
  mouseY: 0,
  drawing: false,
  interactive: false,
  draftArrow: null,
  draftStroke: [],
  noteDraft: null,
};

let overlay: OverlayElements | null = null;
let stopLoop: (() => void) | null = null;
const hoverBox = new BoxSpring();
let noteLayer: HTMLDivElement | null = null;

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h;
  const n = parseInt(full.slice(0, 6), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function setAnnotateTool(tool: AnnotateTool): void {
  commitNoteDraft();
  state.tool = tool;
  state.drawing = false;
  state.draftArrow = null;
  state.draftStroke = [];
  activeArrowId = null;
  arrowDrag = null;
  resetNoteInteraction();
  refreshCursor();
}

export function getAnnotateTool(): AnnotateTool {
  return state.tool;
}

// A note being written takes a newly picked colour straight away.
onMarkColorChange((hex) => {
  if (!state.noteDraft) return;
  state.noteDraft.color = hex;
  state.noteDraft.el.style.color = hex;
  state.noteDraft.el.style.caretColor = hex;
});

export function clearAnnotations(): void {
  commitNoteDraft(true);
  if (state.items.length > 0) remember();
  state.items = [];
  if (noteLayer) noteLayer.innerHTML = '';
  showToast('Annotations cleared');
}

/** Size boxes and arrow ends in viewport space, for guides to snap to. */
export function getAnnotationSnapRects(): Rect[] {
  const point = (px: number, py: number): Rect => {
    const x = toViewX(px);
    const y = toViewY(py);
    return { x, y, width: 0, height: 0, left: x, right: x, top: y, bottom: y };
  };
  const rects: Rect[] = [];
  for (const item of state.items) {
    if (item.kind === 'measure' && item.el.isConnected) rects.push(getElementRect(item.el));
    else if (item.kind === 'arrow') rects.push(point(item.x1, item.y1), point(item.x2, item.y2));
  }
  return rects;
}

export function hasAnnotations(): boolean {
  return state.items.length > 0 || state.noteDraft !== null;
}

function ensureNoteLayer(root: HTMLElement): HTMLDivElement {
  if (noteLayer?.isConnected) return noteLayer;
  noteLayer = document.createElement('div');
  noteLayer.id = 'raval-annotate-notes';
  Object.assign(noteLayer.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '2',
  });
  root.appendChild(noteLayer);
  rebuildNoteDom();
  return noteLayer;
}

export function initAnnotateMode(o: OverlayElements): void {
  overlay = o;
  state.tool = 'measure';
  state.drawing = false;
  state.interactive = true;
  state.draftArrow = null;
  state.draftStroke = [];
  state.hoveredRect = null;

  ensureNoteLayer(o.root);

  document.addEventListener('click', onClick, true);
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('mousemove', onMouseMove, { passive: false });
  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('contextmenu', onContextMenu, true);
  // A note gets the text I-beam, the pen a pencil; an arrow you can grab gets a handle; otherwise the crosshair.
  setCursorResolver(() => {
    if (state.tool === 'note') {
      if (overNoteDelete) return 'delete';
      if (noteDrag || noteRotate || activeNoteId) return 'grab';
      return 'ibeam';
    }
    if (state.tool === 'pen') return 'pen';
    if (state.tool === 'arrow' && (arrowDrag || activeArrowId)) return 'grab';
    return 'crosshair';
  });
  scheduleFrame();
}

/** Detach interaction only — annotations stay on the persist layer. */
export function destroyAnnotateMode(): void {
  commitNoteDraft(true);
  state.interactive = false;
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('mousedown', onMouseDown, true);
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp, true);
  document.removeEventListener('keydown', onKeyDown, true);
  document.removeEventListener('contextmenu', onContextMenu, true);
  setCursorResolver(null);
  resetNoteInteraction();
  activeArrowId = null;
  arrowDrag = null;
  stopLoop?.();
  stopLoop = null;
  overlay = null;
  state.hoveredRect = null;
  state.drawing = false;
  state.draftArrow = null;
  state.draftStroke = [];
}

// ─── Arrows ───────────────────────────────────────────────────────────────────
// Arrows stay editable after they are drawn, the way they are in Excalidraw:
// drag either end to re-aim, drag the middle to bend, drag the body to move.
// Hold Shift while drawing or re-aiming to lock to 15° steps.

interface Pt { x: number; y: number }
type ArrowPart = 'start' | 'end' | 'bend' | 'body';

const HANDLE_RADIUS = 4.5;
const HANDLE_HIT = 9;
/** A bend this close to the straight line snaps back to straight. */
const STRAIGHTEN_WITHIN = 6;
const ANGLE_STEP = Math.PI / 12;

/** Arrow under the pointer while the arrow tool is active. */
let activeArrowId: string | null = null;
let arrowDrag: { id: string; part: ArrowPart; lastX: number; lastY: number; moved: boolean } | null = null;

const chordMid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Control point of the quadratic curve that passes through `bend` at its midpoint. */
function controlPoint(a: Pt, b: Pt, bend: Pt | null): Pt {
  const m = chordMid(a, b);
  return bend ? { x: 2 * bend.x - m.x, y: 2 * bend.y - m.y } : m;
}

function curvePoint(a: Pt, c: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

/** An arrow's points in viewport space. */
function arrowView(item: ArrowAnn): { a: Pt; b: Pt; bend: Pt | null } {
  return {
    a: { x: toViewX(item.x1), y: toViewY(item.y1) },
    b: { x: toViewX(item.x2), y: toViewY(item.y2) },
    bend: item.bend ? { x: toViewX(item.bend.x), y: toViewY(item.bend.y) } : null,
  };
}

function distToArrow(p: Pt, a: Pt, b: Pt, bend: Pt | null): number {
  if (!bend) return distToSegment(p.x, p.y, a.x, a.y, b.x, b.y);
  const c = controlPoint(a, b, bend);
  let best = Infinity;
  let prev = a;
  for (let i = 1; i <= 20; i++) {
    const next = curvePoint(a, c, b, i / 20);
    best = Math.min(best, distToSegment(p.x, p.y, prev.x, prev.y, next.x, next.y));
    prev = next;
  }
  return best;
}

/** Which part of an arrow a viewport point is on, if any. Handles win over the body. */
function arrowPartAt(item: ArrowAnn, x: number, y: number): ArrowPart | null {
  const { a, b, bend } = arrowView(item);
  const near = (p: Pt): boolean => Math.hypot(p.x - x, p.y - y) <= HANDLE_HIT;
  if (near(b)) return 'end';
  if (near(a)) return 'start';
  if (near(bend ?? chordMid(a, b))) return 'bend';
  return distToArrow({ x, y }, a, b, bend) <= HIT_SLOP ? 'body' : null;
}

function arrowAt(x: number, y: number): { item: ArrowAnn; part: ArrowPart } | null {
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i]!;
    if (item.kind !== 'arrow') continue;
    const part = arrowPartAt(item, x, y);
    if (part) return { item, part };
  }
  return null;
}

/** Keep the distance, round the direction to the nearest 15°. */
function lockAngle(from: Pt, to: Pt): Pt {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / ANGLE_STEP) * ANGLE_STEP;
  return { x: from.x + Math.cos(angle) * len, y: from.y + Math.sin(angle) * len };
}

function dragArrow(e: MouseEvent): void {
  const drag = arrowDrag;
  const item = drag && state.items.find((i): i is ArrowAnn => i.kind === 'arrow' && i.id === drag.id);
  if (!drag || !item) return;

  const dx = e.clientX - drag.lastX;
  const dy = e.clientY - drag.lastY;
  if (dx === 0 && dy === 0) return;
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;
  drag.moved = true;

  const { a, b } = arrowView(item);
  let p: Pt = { x: e.clientX, y: e.clientY };

  if (drag.part === 'body') {
    item.x1 += dx; item.y1 += dy; item.x2 += dx; item.y2 += dy;
    if (item.bend) item.bend = { x: item.bend.x + dx, y: item.bend.y + dy };
  } else if (drag.part === 'bend') {
    const m = chordMid(a, b);
    item.bend = Math.hypot(p.x - m.x, p.y - m.y) <= STRAIGHTEN_WITHIN ? null : { x: toPageX(p.x), y: toPageY(p.y) };
  } else if (drag.part === 'start') {
    if (e.shiftKey && !item.bend) p = lockAngle(b, p);
    item.x1 = toPageX(p.x); item.y1 = toPageY(p.y);
  } else {
    if (e.shiftKey && !item.bend) p = lockAngle(a, p);
    item.x2 = toPageX(p.x); item.y2 = toPageY(p.y);
  }
}

function drawArrowHandles(ctx: CanvasRenderingContext2D, item: ArrowAnn): void {
  const { a, b, bend } = arrowView(item);
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = item.color;
  const dot = (p: Pt, r: number, fill: string): void => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
  };
  dot(a, HANDLE_RADIUS, '#fff');
  dot(b, HANDLE_RADIUS, '#fff');
  // The middle handle is filled once the arrow is bent, hollow-looking while it is still straight.
  dot(bend ?? chordMid(a, b), HANDLE_RADIUS - 1, bend ? item.color : '#fff');
  ctx.restore();
}

// ─── Notes ────────────────────────────────────────────────────────────────────
// With the note tool, a note you point at can be dragged to move it, shows a
// small delete button on its corner, and a handle above it that rotates it.
// Hold Shift while rotating to lock to 15° steps.

let activeNoteId: string | null = null;
let overNoteDelete = false;
let overNoteRotate = false;
let noteDrag: { id: string; lastX: number; lastY: number; moved: boolean } | null = null;
/** Centre is in page space; `from` is the pointer's direction from it when the drag began. */
let noteRotate: { id: string; cx: number; cy: number; from: number; startAngle: number; moved: boolean } | null = null;
/** The click that ends a drag or a delete must not also start a new note. */
let swallowNoteClick = false;

const NOTE_DELETE_R = 8;
const NOTE_PAD = 4;
const NOTE_ROTATE_R = 5;
/** How far above the note's top edge the rotate handle sits. */
const NOTE_ROTATE_OFFSET = 14;
const NOTE_ANGLE_STEP = 15;

/** A note's box before rotation (viewport space) and the angle it is turned by about its top-left corner. */
interface NoteBox { x: number; y: number; w: number; h: number; angle: number }

const noteAngle = (note: NoteAnn): number => note.angle ?? DEFAULT_NOTE_ANGLE;

function noteEl(id: string): HTMLElement | null {
  return noteLayer?.querySelector<HTMLElement>(`[data-ann-id="${id}"]`) ?? null;
}

function findNote(id: string | null | undefined): NoteAnn | null {
  if (!id) return null;
  return state.items.find((i): i is NoteAnn => i.kind === 'note' && i.id === id) ?? null;
}

function noteBox(note: NoteAnn): NoteBox | null {
  const el = noteEl(note.id);
  if (!el) return null;
  return {
    x: toViewX(note.x), y: toViewY(note.y),
    w: el.offsetWidth, h: el.offsetHeight,
    angle: (noteAngle(note) * Math.PI) / 180,
  };
}

/** A viewport point in the note's own unrotated space, origin at its top-left corner. */
function toNoteSpace(b: NoteBox, x: number, y: number): Pt {
  const dx = x - b.x; const dy = y - b.y;
  const cos = Math.cos(b.angle); const sin = Math.sin(b.angle);
  return { x: dx * cos + dy * sin, y: dy * cos - dx * sin };
}

function fromNoteSpace(b: NoteBox, x: number, y: number): Pt {
  const cos = Math.cos(b.angle); const sin = Math.sin(b.angle);
  return { x: b.x + x * cos - y * sin, y: b.y + x * sin + y * cos };
}

function inNoteBox(b: NoteBox, x: number, y: number, slop: number): boolean {
  const p = toNoteSpace(b, x, y);
  return p.x >= -slop && p.x <= b.w + slop && p.y >= -slop && p.y <= b.h + slop;
}

/** Centre of the delete button for a note's box: just outside its top-right corner. */
function noteDeleteCentre(b: NoteBox): Pt {
  const c = fromNoteSpace(b, b.w + 6, -2);
  // Kept on screen when the note runs up to the edge of the window.
  return {
    x: Math.min(c.x, window.innerWidth - NOTE_DELETE_R - 2),
    y: Math.max(c.y, NOTE_DELETE_R + 2),
  };
}

/** Centre of the rotate handle: above the middle of the note's top edge. */
function noteRotateCentre(b: NoteBox): Pt {
  return fromNoteSpace(b, b.w / 2, -NOTE_ROTATE_OFFSET);
}

function noteAt(x: number, y: number): NoteAnn | null {
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i]!;
    if (item.kind !== 'note') continue;
    const b = noteBox(item);
    if (b && inNoteBox(b, x, y, NOTE_PAD)) return item;
  }
  return null;
}

/** Track which note the pointer is on, and whether it is on that note's delete button or rotate handle. */
function updateNoteHover(x: number, y: number, onUi: boolean): void {
  let id: string | null = null;
  let onDelete = false;
  let onRotate = false;
  if (!onUi) {
    // Both controls sit outside the note's box, so check them first to keep the note active.
    const current = findNote(activeNoteId);
    const b = current ? noteBox(current) : null;
    if (b) {
      const d = noteDeleteCentre(b);
      onDelete = Math.hypot(x - d.x, y - d.y) <= NOTE_DELETE_R + 3;
      const r = noteRotateCentre(b);
      // Reaches down to the outline, so the note stays active on the way to the handle.
      onRotate = !onDelete && Math.hypot(x - r.x, y - r.y) <= NOTE_ROTATE_OFFSET - NOTE_PAD + 1;
    }
    id = onDelete || onRotate ? activeNoteId : noteAt(x, y)?.id ?? null;
  }
  if (id !== activeNoteId || onDelete !== overNoteDelete || onRotate !== overNoteRotate) {
    activeNoteId = id;
    overNoteDelete = onDelete;
    overNoteRotate = onRotate;
    refreshCursor();
  }
}

/** Turn the note about its centre to follow the pointer. */
function rotateNote(e: MouseEvent): void {
  const rot = noteRotate;
  const note = findNote(rot?.id);
  const el = note && noteEl(note.id);
  if (!rot || !note || !el) return;

  const pointer = Math.atan2(e.clientY - toViewY(rot.cy), e.clientX - toViewX(rot.cx));
  let deg = rot.startAngle + ((pointer - rot.from) * 180) / Math.PI;
  if (e.shiftKey) deg = Math.round(deg / NOTE_ANGLE_STEP) * NOTE_ANGLE_STEP;
  deg = ((((deg + 180) % 360) + 360) % 360) - 180;
  deg = Math.round(deg * 10) / 10;
  if (deg === noteAngle(note)) return;

  // The element turns about its top-left corner, so move that corner to keep the centre where it was.
  const rad = (deg * Math.PI) / 180;
  const hw = el.offsetWidth / 2; const hh = el.offsetHeight / 2;
  note.angle = deg;
  note.x = rot.cx - (hw * Math.cos(rad) - hh * Math.sin(rad));
  note.y = rot.cy - (hw * Math.sin(rad) + hh * Math.cos(rad));
  el.style.left = `${toViewX(note.x)}px`;
  el.style.top = `${toViewY(note.y)}px`;
  el.style.transform = `rotate(${deg}deg)`;
  rot.moved = true;
}

function drawNoteControls(ctx: CanvasRenderingContext2D, note: NoteAnn): void {
  const b = noteBox(note);
  if (!b) return;
  ctx.save();
  ctx.strokeStyle = markRgba(0.6);
  ctx.lineWidth = 1;

  // Outline the note you would move, turned the way the note is
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.angle);
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.roundRect(-NOTE_PAD, -NOTE_PAD, b.w + NOTE_PAD * 2, b.h + NOTE_PAD * 2, 4);
  ctx.stroke();
  ctx.setLineDash([]);

  // Rotate handle, joined to the outline by a short stem
  ctx.beginPath();
  ctx.moveTo(b.w / 2, -NOTE_PAD);
  ctx.lineTo(b.w / 2, -NOTE_ROTATE_OFFSET + NOTE_ROTATE_R);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(b.w / 2, -NOTE_ROTATE_OFFSET, NOTE_ROTATE_R, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = getMarkColor();
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // Delete button
  const c = noteDeleteCentre(b);
  ctx.beginPath();
  ctx.arc(c.x, c.y, NOTE_DELETE_R, 0, Math.PI * 2);
  ctx.fillStyle = getMarkColor();
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.strokeStyle = onMarkColor();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(c.x - 2.75, c.y - 2.75); ctx.lineTo(c.x + 2.75, c.y + 2.75);
  ctx.moveTo(c.x + 2.75, c.y - 2.75); ctx.lineTo(c.x - 2.75, c.y + 2.75);
  ctx.stroke();
  ctx.restore();
}

function resetNoteInteraction(): void {
  activeNoteId = null;
  overNoteDelete = false;
  overNoteRotate = false;
  noteDrag = null;
  noteRotate = null;
  swallowNoteClick = false;
}

// ─── Undo and single delete ───────────────────────────────────────────────────

const HISTORY_LIMIT = 50;
const history: Annotation[][] = [];

/** Snapshot the annotations before changing them. Copied, because moving or rotating edits one in place. */
function remember(): void {
  history.push(state.items.map((i) => ({ ...i })));
  if (history.length > HISTORY_LIMIT) history.shift();
}

/** Step back one change. Returns false when there is nothing to undo. */
export function undoAnnotation(): boolean {
  const previous = history.pop();
  if (!previous) return false;
  state.items = previous.filter((i) => i.kind !== 'measure' || i.el.isConnected);
  rebuildNoteDom();
  markActive();
  return true;
}

const HIT_SLOP = 8;

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Topmost annotation under a viewport point, if any. */
function annotationAt(x: number, y: number): Annotation | null {
  const px = toPageX(x);
  const py = toPageY(y);
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i]!;
    if (item.kind === 'arrow') {
      if (arrowPartAt(item, x, y)) return item;
    } else if (item.kind === 'stroke') {
      const dot = item.points[0];
      if (item.points.length === 1 && dot && Math.hypot(px - dot.x, py - dot.y) <= HIT_SLOP) return item;
      for (let j = 1; j < item.points.length; j++) {
        const a = item.points[j - 1]!;
        const b = item.points[j]!;
        if (distToSegment(px, py, a.x, a.y, b.x, b.y) <= HIT_SLOP) return item;
      }
    } else if (item.kind === 'note') {
      const b = noteBox(item);
      if (b && inNoteBox(b, x, y, 0)) return item;
    } else {
      const r = getElementRect(item.el);
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return item;
    }
  }
  return null;
}

/** Right-click removes the one annotation under the pointer. */
function onContextMenu(e: MouseEvent): void {
  if (isRavalElement(e.target as Element)) return;
  const item = annotationAt(e.clientX, e.clientY);
  if (!item) return;
  e.preventDefault();
  e.stopPropagation();
  remember();
  state.items = state.items.filter((i) => i !== item);
  rebuildNoteDom();
  markActive();
}

// ─── Page scope ───────────────────────────────────────────────────────────────
// Annotations stay with the page they were made on, and come back if you
// return to it during the same visit.

const annotationShelf = createPageShelf<Annotation>();
onPageChange((from, to) => {
  commitNoteDraft(true);
  history.length = 0;
  const leaving = state.items;
  state.items = annotationShelf
    .swap(from, to, leaving)
    .filter((i) => i.kind !== 'measure' || i.el.isConnected);
  state.draftArrow = null;
  state.draftStroke = [];
  state.drawing = false;
  rebuildNoteDom();
});

// ─── Note DOM ─────────────────────────────────────────────────────────────────

function rebuildNoteDom(): void {
  if (!noteLayer) return;
  noteLayer.innerHTML = '';
  for (const item of state.items) {
    if (item.kind !== 'note') continue;
    noteLayer.appendChild(createNoteEl(item));
  }
}

function createNoteEl(note: NoteAnn): HTMLDivElement {
  const el = document.createElement('div');
  el.dataset['annId'] = note.id;
  el.textContent = note.text;
  Object.assign(el.style, {
    position: 'absolute',
    left: `${toViewX(note.x)}px`,
    top: `${toViewY(note.y)}px`,
    color: note.color,
    fontFamily: noteFontStack(note.font),
    fontSize: `${note.size ?? DEFAULT_NOTE_SIZE}px`,
    fontWeight: '600',
    lineHeight: '1.25',
    maxWidth: `${NOTE_MAX_WIDTH}px`,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    pointerEvents: 'none',
    textShadow: NOTE_TEXT_SHADOW,
    transform: `rotate(${noteAngle(note)}deg)`,
    transformOrigin: '0 0',
  });
  return el;
}

function syncNotePositions(): void {
  if (!noteLayer) return;
  for (const item of state.items) {
    if (item.kind !== 'note') continue;
    const el = noteLayer.querySelector<HTMLElement>(`[data-ann-id="${item.id}"]`);
    if (!el) continue;
    el.style.left = `${toViewX(item.x)}px`;
    el.style.top = `${toViewY(item.y)}px`;
  }
  if (state.noteDraft) {
    state.noteDraft.el.style.left = `${toViewX(state.noteDraft.x)}px`;
    state.noteDraft.el.style.top = `${toViewY(state.noteDraft.y)}px`;
  }
}

function commitNoteDraft(discardEmpty = false): void {
  const draft = state.noteDraft;
  if (!draft) return;
  const text = draft.el.value.trim();
  const color = draft.color;
  const { x, y, size, font } = draft;
  draft.el.remove();
  state.noteDraft = null;
  if (!text) {
    if (!discardEmpty) return;
    return;
  }
  remember();
  state.items.push({ id: uid(), kind: 'note', x, y, text, color, size, font });
  rebuildNoteDom();
}

function startNoteAt(clientX: number, clientY: number): void {
  commitNoteDraft();
  if (!noteLayer) return;

  const x = toPageX(clientX);
  const y = toPageY(clientY);
  const color = getMarkColor();
  const ta = document.createElement('textarea');
  ta.placeholder = 'Write a note…';
  ta.rows = 1;
  ta.spellcheck = false;
  // No box: the note is written straight onto the page and looks, while it is
  // being typed, exactly as it will once saved.
  Object.assign(ta.style, {
    position: 'absolute',
    left: `${clientX}px`,
    top: `${clientY}px`,
    width: `${NOTE_MAX_WIDTH}px`,
    margin: '0',
    padding: '0',
    resize: 'none',
    overflow: 'hidden',
    color,
    caretColor: color,
    fontFamily: noteFontStack(noteFont),
    fontSize: `${noteSize}px`,
    fontWeight: '600',
    lineHeight: '1.25',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    background: 'transparent',
    border: 'none',
    borderRadius: '0',
    outline: 'none',
    boxShadow: 'none',
    textShadow: NOTE_TEXT_SHADOW,
    transform: NOTE_TILT,
    transformOrigin: '0 0',
    pointerEvents: 'all',
    zIndex: '5',
  });
  // Grows with the text instead of scrolling inside a fixed box.
  const fit = (): void => {
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  };
  ta.addEventListener('input', fit);
  noteLayer.style.pointerEvents = 'none';
  noteLayer.appendChild(ta);
  state.noteDraft = { x, y, el: ta, color, size: noteSize, font: noteFont };
  // Said once: how to finish or abandon a note from the keyboard.
  if (!noteKeysExplained) {
    noteKeysExplained = true;
    showToast('Enter to save · Esc to cancel', 3500);
  }
  ta.style.pointerEvents = 'all';
  requestAnimationFrame(() => { fit(); ta.focus(); });

  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitNoteDraft();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      ta.value = '';
      commitNoteDraft(true);
    }
  });
  ta.addEventListener('mousedown', (e) => e.stopPropagation());
  ta.addEventListener('click', (e) => e.stopPropagation());
}

// ─── Events ───────────────────────────────────────────────────────────────────

function onKeyDown(e: KeyboardEvent): void {
  if (state.noteDraft) return;
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

  if (e.shiftKey) return;

  switch (e.key.toLowerCase()) {
    case 'm': setAnnotateTool('measure'); syncToolUi(); break;
    case 'n': setAnnotateTool('note'); syncToolUi(); break;
    case 'a': setAnnotateTool('arrow'); syncToolUi(); break;
    case 'p': setAnnotateTool('pen'); syncToolUi(); break;
  }
}

function syncToolUi(): void {
  setSegmented(document, 'annotate-tool', state.tool);
  const sizeRow = document.querySelector<HTMLElement>('[data-note-size-row]');
  if (sizeRow) sizeRow.style.display = state.tool === 'note' ? 'block' : 'none';
  const endsRow = document.querySelector<HTMLElement>('[data-arrow-ends-row]');
  if (endsRow) endsRow.style.display = state.tool === 'arrow' ? 'block' : 'none';
  const penRow = document.querySelector<HTMLElement>('[data-pen-size-row]');
  if (penRow) penRow.style.display = state.tool === 'pen' ? 'block' : 'none';
}

function onClick(e: MouseEvent): void {
  if (isRavalElement(e.target as Element)) return;
  if (state.tool === 'arrow' || state.tool === 'pen') return;
  if (e.button !== 0) return;

  if (state.tool === 'note') {
    e.preventDefault();
    e.stopPropagation();
    // The end of a move or delete, or a click on an existing note, is not a request for a new one.
    if (swallowNoteClick) { swallowNoteClick = false; return; }
    if (noteAt(e.clientX, e.clientY)) return;
    startNoteAt(e.clientX, e.clientY - 8);
    return;
  }

  if (state.tool === 'measure') {
    e.preventDefault();
    e.stopPropagation();
    const el = getElementAtPoint(e.clientX, e.clientY);
    if (!el) return;
    const existing = state.items.findIndex(
      (i) => i.kind === 'measure' && i.el === el,
    );
    if (existing >= 0) {
      remember();
      state.items.splice(existing, 1);
      return;
    }
    remember();
    state.items.push({ id: uid(), kind: 'measure', el, color: getMarkColor() });
  }
}

function onMouseDown(e: MouseEvent): void {
  swallowNoteClick = false;
  if (isRavalElement(e.target as Element)) return;
  if (e.button !== 0) return;

  if (state.tool === 'note' && activeNoteId && !state.noteDraft) {
    e.preventDefault();
    swallowNoteClick = true;
    remember();
    if (overNoteDelete) {
      state.items = state.items.filter((i) => i.id !== activeNoteId);
      rebuildNoteDom();
      activeNoteId = null;
      overNoteDelete = false;
      refreshCursor();
      markActive();
    } else if (overNoteRotate) {
      const note = findNote(activeNoteId);
      const b = note ? noteBox(note) : null;
      if (note && b) {
        const c = fromNoteSpace(b, b.w / 2, b.h / 2);
        noteRotate = {
          id: note.id, cx: toPageX(c.x), cy: toPageY(c.y),
          from: Math.atan2(e.clientY - c.y, e.clientX - c.x), startAngle: noteAngle(note), moved: false,
        };
      }
    } else {
      noteDrag = { id: activeNoteId, lastX: e.clientX, lastY: e.clientY, moved: false };
    }
    return;
  }

  if (state.tool === 'arrow') {
    e.preventDefault();
    // On an existing arrow: grab it. Anywhere else: start a new one.
    const hit = arrowAt(e.clientX, e.clientY);
    if (hit) {
      remember();
      arrowDrag = { id: hit.item.id, part: hit.part, lastX: e.clientX, lastY: e.clientY, moved: false };
      activeArrowId = hit.item.id;
      return;
    }
    state.drawing = true;
    state.draftArrow = { x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY };
  } else if (state.tool === 'pen') {
    e.preventDefault();
    state.drawing = true;
    state.draftStroke = [{ x: e.clientX, y: e.clientY }];
  }
}

function onMouseMove(e: MouseEvent): void {
  state.mouseX = e.clientX;
  state.mouseY = e.clientY;

  if (arrowDrag) {
    dragArrow(e);
    return;
  }
  if (noteRotate) {
    rotateNote(e);
    return;
  }
  if (noteDrag) {
    const drag = noteDrag;
    const note = findNote(drag.id);
    if (note && (e.clientX !== drag.lastX || e.clientY !== drag.lastY)) {
      note.x += e.clientX - drag.lastX;
      note.y += e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      drag.moved = true;
    }
    return;
  }
  if (state.tool === 'note' && !state.noteDraft) {
    updateNoteHover(e.clientX, e.clientY, isRavalElement(e.target as Element));
  }
  if (state.drawing && state.tool === 'arrow' && state.draftArrow) {
    const from = { x: state.draftArrow.x1, y: state.draftArrow.y1 };
    const to = e.shiftKey ? lockAngle(from, { x: e.clientX, y: e.clientY }) : { x: e.clientX, y: e.clientY };
    state.draftArrow.x2 = to.x;
    state.draftArrow.y2 = to.y;
    return;
  }
  if (state.tool === 'arrow') {
    const over = isRavalElement(e.target as Element) ? null : arrowAt(e.clientX, e.clientY);
    const id = over?.item.id ?? null;
    if (id !== activeArrowId) {
      activeArrowId = id;
      refreshCursor();
    }
  }
  if (state.drawing && state.tool === 'pen') {
    const p = { x: e.clientX, y: e.clientY };
    // Shift rules a straight line from where the stroke began.
    if (e.shiftKey && state.draftStroke.length > 0) state.draftStroke = [state.draftStroke[0]!, p];
    else state.draftStroke.push(p);
    return;
  }

  if (state.tool === 'measure' && !isRavalElement(e.target as Element)) {
    const el = getElementAtPoint(e.clientX, e.clientY);
    state.hoveredRect = el ? getElementRect(el) : null;
  } else {
    state.hoveredRect = null;
  }
}

function onMouseUp(e: MouseEvent): void {
  if (arrowDrag) {
    // A press that never moved changed nothing, so it should not cost an undo step.
    if (!arrowDrag.moved) history.pop();
    arrowDrag = null;
    return;
  }
  if (noteDrag) {
    if (!noteDrag.moved) history.pop();
    noteDrag = null;
    return;
  }
  if (noteRotate) {
    if (!noteRotate.moved) history.pop();
    noteRotate = null;
    return;
  }
  if (!state.drawing) return;
  state.drawing = false;

  if (state.tool === 'arrow' && state.draftArrow) {
    const { x1, y1, x2, y2 } = state.draftArrow;
    if (Math.hypot(x2 - x1, y2 - y1) > 8) {
      remember();
      state.items.push({
        id: uid(),
        kind: 'arrow',
        x1: toPageX(x1),
        y1: toPageY(y1),
        x2: toPageX(x2),
        y2: toPageY(y2),
        color: getMarkColor(),
        start: arrowEnds.start,
        end: arrowEnds.end,
      });
    }
    state.draftArrow = null;
  }

  // A press that never moved leaves a dot.
  if (state.tool === 'pen' && state.draftStroke.length > 0) {
    remember();
    state.items.push({
      id: uid(),
      kind: 'stroke',
      points: state.draftStroke.map((p) => ({ x: toPageX(p.x), y: toPageY(p.y) })),
      color: getMarkColor(),
      size: penSize,
    });
    state.draftStroke = [];
  } else {
    state.draftStroke = [];
  }

  void e;
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

function scheduleFrame(): void {
  if (!overlay || !state.interactive) return;
  stopLoop?.();
  stopLoop = addRenderer(renderInteractive);
}

/** Ephemeral hover + drafts while annotate mode is active. */
function renderInteractive(): void {
  if (!overlay) return;
  const { ctx } = overlay;
  clearCanvas(ctx);

  const hover = hoverBox.step(state.tool === 'measure' && !hoverSuppressed() ? state.hoveredRect : null);
  if (hover) drawMeasure(ctx, boxToRect(hover), getMarkColor(), true, hover.opacity);
  if (state.draftArrow) {
    drawArrow(
      ctx,
      { x: state.draftArrow.x1, y: state.draftArrow.y1 },
      { x: state.draftArrow.x2, y: state.draftArrow.y2 },
      null,
      getMarkColor(),
      arrowEnds.start,
      arrowEnds.end,
    );
  }
  // Outline, rotate handle and delete button for the note you are on, dragging or turning
  const shownNote = findNote(noteDrag?.id ?? noteRotate?.id ?? activeNoteId);
  if (state.tool === 'note' && shownNote && !hoverSuppressed()) drawNoteControls(ctx, shownNote);

  // Handles for the arrow you are on or dragging
  const shownId = arrowDrag?.id ?? activeArrowId;
  if (state.tool === 'arrow' && shownId && !hoverSuppressed()) {
    const shown = state.items.find((i): i is ArrowAnn => i.kind === 'arrow' && i.id === shownId);
    if (shown) drawArrowHandles(ctx, shown);
  }
  if (state.draftStroke.length > 0) drawDraftStroke(ctx);

  drawRulers(ctx, state.mouseX, state.mouseY);
}

/** Paint committed annotations onto the persist canvas (follows scroll). */
export function paintAnnotations(
  ctx: CanvasRenderingContext2D,
  root: HTMLElement,
): void {
  // Drop measure marks whose elements left the DOM
  state.items = state.items.filter((i) => i.kind !== 'measure' || i.el.isConnected);

  ensureNoteLayer(root);
  syncNotePositions();

  for (const item of state.items) {
    if (item.kind === 'measure') {
      drawMeasure(ctx, getElementRect(item.el), item.color, false);
    } else if (item.kind === 'arrow') {
      const { a, b, bend } = arrowView(item);
      drawArrow(ctx, a, b, bend, item.color, item.start, item.end);
    } else if (item.kind === 'stroke') {
      drawStroke(ctx, item);
    }
  }
}

function drawMeasure(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  color: string,
  preview: boolean,
  opacity = 1,
): void {
  // Same hover → selected treatment as the other modes, in the annotation colour.
  drawElementHighlight(ctx, rect, !preview, opacity, color);

  ctx.save();
  ctx.globalAlpha = opacity;

  const hx = rect.right + 14;
  drawDimLine(ctx, hx, rect.top, hx, rect.bottom, String(Math.round(rect.height)), 'v', color);

  if (rect.width >= 24) {
    const wy = rect.bottom + 14;
    drawDimLine(ctx, rect.left, wy, rect.right, wy, String(Math.round(rect.width)), 'h', color);
  }

  ctx.restore();
}

function drawDimLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  label: string,
  axis: 'h' | 'v',
  color: string,
): void {
  ctx.save();
  ctx.strokeStyle = hexToRgba(color, 0.95);
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  const cap = 6;
  ctx.beginPath();
  if (axis === 'v') {
    ctx.moveTo(x1 - cap, y1); ctx.lineTo(x1 + cap, y1);
    ctx.moveTo(x2 - cap, y2); ctx.lineTo(x2 + cap, y2);
  } else {
    ctx.moveTo(x1, y1 - cap); ctx.lineTo(x1, y1 + cap);
    ctx.moveTo(x2, y2 - cap); ctx.lineTo(x2, y2 + cap);
  }
  ctx.stroke();

  ctx.font = `600 17px ${NOTE_FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  if (axis === 'v') {
    ctx.save();
    ctx.translate(x1 + 12, (y1 + y2) / 2);
    ctx.rotate(-0.08);
    ctx.fillText(label, 0, 0);
    ctx.restore();
  } else {
    ctx.save();
    ctx.translate((x1 + x2) / 2, y1 + 12);
    ctx.rotate(-0.04);
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  a: Pt,
  b: Pt,
  bend: Pt | null,
  color: string,
  start: ArrowEnd = 'none',
  end: ArrowEnd = 'arrow',
): void {
  ctx.save();
  const stroke = hexToRgba(color, 0.95);
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Straight unless it has been bent; a bent arrow curves through its bend point.
  const c = controlPoint(a, b, bend);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  if (bend) ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
  else ctx.lineTo(b.x, b.y);
  ctx.stroke();

  // Each end follows the direction the line arrives from.
  drawArrowEnd(ctx, end, b, bend ? c : a);
  drawArrowEnd(ctx, start, a, bend ? c : b);
  ctx.restore();
}

/** One end of an arrow at `tip`, facing away from `from`. Uses the stroke and fill already set. */
function drawArrowEnd(ctx: CanvasRenderingContext2D, kind: ArrowEnd, tip: Pt, from: Pt): void {
  if (kind === 'none') return;
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  ctx.beginPath();
  if (kind === 'arrow') {
    const head = 10;
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - head * Math.cos(angle - 0.4), tip.y - head * Math.sin(angle - 0.4));
    ctx.lineTo(tip.x - head * Math.cos(angle + 0.4), tip.y - head * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'bar') {
    // A short line across the end, like the cap of a dimension line.
    const half = 6;
    const nx = -Math.sin(angle); const ny = Math.cos(angle);
    ctx.moveTo(tip.x - nx * half, tip.y - ny * half);
    ctx.lineTo(tip.x + nx * half, tip.y + ny * half);
    ctx.stroke();
  } else {
    ctx.arc(tip.x, tip.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Outlines of finished strokes, in page space. A stroke never changes once drawn, so each is built once. */
const strokePaths = new WeakMap<StrokeAnn, Path2D>();

function drawStroke(ctx: CanvasRenderingContext2D, item: StrokeAnn): void {
  let path = strokePaths.get(item);
  if (!path) {
    path = inkPath(item.points, item.size ?? DEFAULT_PEN_SIZE);
    strokePaths.set(item, path);
  }
  ctx.save();
  // Page space to viewport: only scrolling moves a stroke, so its outline is reused as is.
  ctx.translate(toViewX(0), toViewY(0));
  ctx.fillStyle = item.color;
  ctx.fill(path);
  ctx.restore();
}

/** The stroke still under the pen, in viewport space. */
function drawDraftStroke(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.fillStyle = getMarkColor();
  ctx.fill(inkPath(state.draftStroke, penSize, false));
  ctx.restore();
}
