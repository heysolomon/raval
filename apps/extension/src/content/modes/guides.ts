/**
 * Guides mode — place H / V / both alignment guides.
 * Placed guides live on the persist layer and survive mode switches until cleared.
 */
import type { Guide } from '@raval/shared';
import { PASS_THROUGH_CLASS, type OverlayElements } from '../overlay';
import { clearCanvas, drawGuide, drawGuideGap, drawRulers, RULER_SIZE } from '../renderer';
import { setLabel, hideLabel, removeLabel, showToast } from '../labels';
import { formatDistance, uid, isRavalElement, toPageX, toPageY, toViewX, toViewY } from '../utils';
import { loadGuides, saveGuides, guidePageKey } from '../storage';
import { addRenderer, markActive } from '../frame';
import { SnapEase } from '../motion';
import { setCursorResolver, refreshCursor } from '../cursor';
import { setSegmented } from '../tokens';
import { onPageChange } from '../page-scope';
import { getPinnedRects } from './measure';
import { getAnnotationSnapRects } from './annotate';
import { hoverSuppressed } from '../pointer';

export type GuidePlacement = 'both' | 'horizontal' | 'vertical';

interface GuidesState {
  guides: Guide[];
  draggingId: string | null;
  hoveredId: string | null;
  mouseX: number;
  mouseY: number;
  snapEnabled: boolean;
  snapTarget: number | null;
  placement: GuidePlacement;
  interactive: boolean;
  visible: boolean;
  showLabels: boolean;
  showGaps: boolean;
}

const state: GuidesState = {
  guides: [],
  draggingId: null,
  hoveredId: null,
  mouseX: 0,
  mouseY: 0,
  snapEnabled: true,
  snapTarget: null,
  placement: 'both',
  interactive: false,
  visible: true,
  showLabels: false,
  showGaps: true,
};

const HANDLE_HIT = 16;
const SNAP_THRESHOLD = 8;

let overlay: OverlayElements | null = null;
let stopLoop: (() => void) | null = null;
let sessionId = 0;
let knownLabelIds = new Set<string>();

/** Pointer travel before a press on a guide counts as a drag (move) rather than a click (delete). */
const DRAG_THRESHOLD = 4;
let press: { id: string; x: number; y: number; from: number; moved: boolean } | null = null;
/** The click that follows a press on a guide must not also place a new guide. */
let swallowClick = false;
/** Guides placed by the click that is still under the pointer. */
const unarmed = new Set<string>();

// ─── Undo ─────────────────────────────────────────────────────────────────────
// Every change to the guides can be reversed, so trying things is never destructive.

type UndoAction =
  | { kind: 'add'; ids: string[] }
  | { kind: 'delete'; guides: Guide[] }
  | { kind: 'move'; id: string; from: number };

const UNDO_LIMIT = 50;
const undoStack: UndoAction[] = [];

function pushUndo(action: UndoAction): void {
  undoStack.push(action);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

/** Reverse the most recent guide change. Returns false when there is nothing to undo. */
export function undoGuideChange(): boolean {
  const action = undoStack.pop();
  if (!action) return false;
  applyUndo(action);
  return true;
}

function applyUndo(action: UndoAction): void {
  if (action.kind === 'add') {
    const ids = new Set(action.ids);
    const kept = state.guides.filter((g) => !ids.has(g.id));
    state.guides.splice(0, state.guides.length, ...kept);
    removeGuideLabels(action.ids);
    showToast('Guide removed');
  } else if (action.kind === 'delete') {
    state.guides.push(...action.guides);
    showToast(action.guides.length > 1 ? `Restored ${action.guides.length} guides` : 'Guide restored');
  } else {
    const guide = state.guides.find((g) => g.id === action.id);
    if (guide) guide.position = action.from;
    showToast('Guide moved back');
  }

  state.hoveredId = findGuideAtPoint(state.mouseX, state.mouseY)?.id ?? null;
  void persist();
  refreshCursor();
  markActive();
}

/** Deleted guides fade out instead of vanishing. */
const FADE_MS = 160;
const fading: { guide: Guide; t0: number }[] = [];

export function setSnapEnabled(enabled: boolean): void {
  state.snapEnabled = enabled;
}

export function setGuidesVisible(visible: boolean): void {
  state.visible = visible;
}

export function isGuidesVisible(): boolean {
  return state.visible;
}

export function setGuideLabelsVisible(visible: boolean): void {
  state.showLabels = visible;
}

export function isGuideLabelsVisible(): boolean {
  return state.showLabels;
}

export function setGuideGapsVisible(visible: boolean): void {
  state.showGaps = visible;
  markActive();
}

export function setGuidePlacement(placement: GuidePlacement): void {
  state.placement = placement;
}

export function getGuidePlacement(): GuidePlacement {
  return state.placement;
}

/** The page whose guides are currently in memory. */
let loadedPage: string | null = null;

function persist(): Promise<void> {
  return saveGuides(loadedPage ?? guidePageKey(), state.guides);
}

/** Load this page's saved guides into memory so the persist layer can paint them in any mode. */
export async function hydrateGuides(): Promise<void> {
  const page = guidePageKey();
  loadedPage = page;
  const saved = await loadGuides(page);
  // The page may have changed again while storage was being read.
  if (loadedPage !== page) return;
  state.guides.splice(0, state.guides.length, ...saved);
  markActive();
}

// Single-page apps change route without reloading: swap to the new page's
// guides instead of carrying the old ones over.
onPageChange(() => {
  if (loadedPage === null) return;
  state.guides.splice(0, state.guides.length);
  state.hoveredId = null;
  state.draggingId = null;
  press = null;
  undoStack.length = 0;
  fading.length = 0;
  void hydrateGuides();
});

export async function initGuidesMode(o: OverlayElements, snapEnabled = true): Promise<void> {
  const sid = ++sessionId;
  overlay = o;
  state.snapEnabled = snapEnabled;
  state.draggingId = null;
  state.hoveredId = null;
  state.snapTarget = null;
  state.interactive = true;

  setCursorResolver(() => {
    const dragged = state.draggingId ? state.guides.find((g) => g.id === state.draggingId) : undefined;
    if (dragged && press?.moved) return dragged.axis === 'horizontal' ? 'move-y' : 'move-x';
    return state.hoveredId || state.draggingId ? 'delete' : 'crosshair';
  });
  document.documentElement.classList.add(PASS_THROUGH_CLASS);
  document.addEventListener('click', onClick, true);
  document.addEventListener('mousemove', onMouseMove, { passive: true });
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('contextmenu', onContextMenu, true);
  document.addEventListener('keydown', onKeyDown, true);

  await hydrateGuides();
  if (sid !== sessionId) return;

  scheduleFrame();
}

/** Detach interaction only — placed guides stay on the persist layer. */
export function destroyGuidesMode(): void {
  sessionId++;
  state.interactive = false;
  setCursorResolver(null);
  press = null;
  swallowClick = false;
  unarmed.clear();
  document.documentElement.classList.remove(PASS_THROUGH_CLASS);
  edgeCache = null;
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mousedown', onMouseDown, true);
  document.removeEventListener('mouseup', onMouseUp);
  document.removeEventListener('contextmenu', onContextMenu, true);
  document.removeEventListener('keydown', onKeyDown, true);
  stopLoop?.();
  stopLoop = null;
  state.draggingId = null;
  state.hoveredId = null;
  state.snapTarget = null;
  overlay = null;
}

export function getGuides(): Guide[] {
  return state.guides;
}

export function setGuides(guides: Guide[]): void {
  state.guides.splice(0, state.guides.length, ...guides);
}

function removeGuideLabels(ids: string[]): void {
  for (const id of ids) {
    removeLabel(`persist-guide-${id}`);
    removeLabel(`guide-pos-${id}`);
    knownLabelIds.delete(`persist-guide-${id}`);
  }
}

export function clearGuides(): void {
  if (state.guides.length > 0) pushUndo({ kind: 'delete', guides: [...state.guides] });
  const ids = state.guides.map((g) => g.id);
  state.guides.splice(0, state.guides.length);
  removeGuideLabels(ids);
  state.hoveredId = null;
  void persist();
}

function removeGuide(guide: Guide): void {
  const idx = state.guides.findIndex((g) => g.id === guide.id);
  if (idx === -1) return;
  state.guides.splice(idx, 1);
  pushUndo({ kind: 'delete', guides: [guide] });
  fading.push({ guide, t0: performance.now() });
  removeGuideLabels([guide.id]);
  if (state.hoveredId === guide.id) state.hoveredId = null;
  if (state.draggingId === guide.id) state.draggingId = null;
  void persist();
  showToast('Guide deleted');
  refreshCursor();
  markActive();
}

/** Delete the guide under the pointer, if any. */
export function deleteHoveredGuide(): boolean {
  const guide = state.guides.find((g) => g.id === state.hoveredId);
  if (!guide) return false;
  removeGuide(guide);
  return true;
}

/** Paint placed guides onto the persist canvas (called every frame while Raval is open). */
export function paintPlacedGuides(
  ctx: CanvasRenderingContext2D,
  labelContainer: HTMLElement,
): void {
  const liveIds = new Set<string>();

  for (const guide of state.guides) {
    const hovered = guide.id === state.hoveredId || guide.id === state.draggingId;
    const viewPos = guideViewPos(guide);
    // A guide being dragged eases onto and off the edges it snaps to. Its stored
    // position is already the snapped one; only what is drawn is smoothed.
    if (guide.id === state.draggingId && press?.moved) {
      const line = dragEase.step(viewPos, state.snapTarget);
      drawGuide(ctx, guide.axis, line.at, Math.max(line.glow, 0.6));
    } else {
      drawGuide(ctx, guide.axis, viewPos, hovered);
    }

    const labelName = `persist-guide-${guide.id}`;
    if (!state.showLabels) continue;

    const hp = getHandlePosition(guide);
    liveIds.add(labelName);
    knownLabelIds.add(labelName);

    const labelX = guide.axis === 'horizontal' ? hp.x + 12 : hp.x - 12;
    const labelY = guide.axis === 'horizontal' ? hp.y - 12 : hp.y + 12;
    setLabel(labelContainer, labelName, formatDistance(guide.position), labelX, labelY);
  }

  for (const name of [...knownLabelIds]) {
    if (!liveIds.has(name)) {
      removeLabel(name);
      knownLabelIds.delete(name);
    }
  }

  const now = performance.now();
  for (let i = fading.length - 1; i >= 0; i--) {
    const { guide, t0 } = fading[i]!;
    const t = (now - t0) / FADE_MS;
    if (t >= 1) { fading.splice(i, 1); continue; }
    ctx.globalAlpha = (1 - t) ** 2;
    drawGuide(ctx, guide.axis, guideViewPos(guide), true);
    ctx.globalAlpha = 1;
    markActive();
  }
}

// ─── Snap logic ───────────────────────────────────────────────────────────────
// Snapping runs on every frame the pointer moves, so it must be cheap. The edges
// of everything in the viewport are read once and kept for a moment; finding the
// nearest one is then a search in a sorted list, with a single hit-test to
// confirm the winner is really there (not clipped away or untouchable).

interface Edge { at: number; el: Element; rect: DOMRect; leading: boolean }
interface EdgeCache { t: number; sx: number; sy: number; vw: number; vh: number; h: Edge[]; v: Edge[] }

/** How long a reading of the page's edges is trusted while nothing has scrolled. */
const EDGE_CACHE_MS = 400;
/** Never re-read more often than this, even mid-scroll. */
const EDGE_REBUILD_MIN_MS = 120;
/** Click-through while placing (see PASS_THROUGH_CLASS), so they cannot be confirmed by a hit-test. */
const PASS_THROUGH = 'iframe, embed, object, :disabled';
const MAX_CONFIRMS = 4;

let edgeCache: EdgeCache | null = null;

function readEdges(): EdgeCache {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const h: Edge[] = [];
  const v: Edge[] = [];
  for (const el of document.body?.getElementsByTagName('*') ?? []) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
    if (r.width >= vw - 2 && r.height >= vh - 2) continue;
    if (isRavalElement(el)) continue;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true })) continue;
    h.push({ at: r.top, el, rect: r, leading: true }, { at: r.bottom, el, rect: r, leading: false });
    v.push({ at: r.left, el, rect: r, leading: true }, { at: r.right, el, rect: r, leading: false });
  }
  const byPosition = (a: Edge, b: Edge): number => a.at - b.at;
  h.sort(byPosition);
  v.sort(byPosition);
  return { t: performance.now(), sx: window.scrollX, sy: window.scrollY, vw, vh, h, v };
}

/** Edges of the page as it stands, or null in the brief moment after a scroll before they are re-read. */
function pageEdges(): EdgeCache | null {
  const now = performance.now();
  const c = edgeCache;
  const current = c !== null && c.sx === window.scrollX && c.sy === window.scrollY
    && c.vw === window.innerWidth && c.vh === window.innerHeight;
  if (c && current && now - c.t < EDGE_CACHE_MS) return c;
  if (c && now - c.t < EDGE_REBUILD_MIN_MS) return current ? c : null;
  edgeCache = readEdges();
  return edgeCache;
}

/** Is this edge actually on screen where the guide would meet it? One hit-test, just inside the element. */
function edgeIsThere(edge: Edge, axis: 'horizontal' | 'vertical', mouseX: number, mouseY: number): boolean {
  if (edge.el.matches(PASS_THROUGH)) return true;
  const r = edge.rect;
  const within = (v: number, lo: number, hi: number, max: number): number =>
    Math.max(0, Math.min(max - 1, Math.max(lo + 1, Math.min(hi - 1, v))));
  const inward = edge.leading ? 1 : -1;
  const hit = (along: number): boolean => {
    const x = axis === 'horizontal' ? within(along, r.left, r.right, window.innerWidth) : within(edge.at + inward, r.left, r.right, window.innerWidth);
    const y = axis === 'horizontal' ? within(edge.at + inward, r.top, r.bottom, window.innerHeight) : within(along, r.top, r.bottom, window.innerHeight);
    return document.elementsFromPoint(x, y).includes(edge.el);
  };
  // Nearest the pointer first, then the element's middle.
  return axis === 'horizontal'
    ? hit(mouseX) || hit((r.left + r.right) / 2)
    : hit(mouseY) || hit((r.top + r.bottom) / 2);
}

/** First index whose edge is at or after `position`. */
function lowerBound(edges: Edge[], position: number): number {
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (edges[mid]!.at < position) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Nearest edge to snap a guide to, within SNAP_THRESHOLD. Looks at the page's
 * elements and at what has already been marked up: pinned measurements and
 * annotations take part too, so guides line up with them.
 */
function snapPosition(
  axis: 'horizontal' | 'vertical',
  rawPosition: number,
  mouseX: number,
  mouseY: number,
): number {
  let best = rawPosition;
  let minDist = SNAP_THRESHOLD + 1;
  const consider = (edge: number): void => {
    const d = Math.abs(edge - rawPosition);
    if (d <= SNAP_THRESHOLD && d < minDist) {
      minDist = d;
      best = edge;
    }
  };

  for (const r of [...getPinnedRects(), ...getAnnotationSnapRects()]) {
    if (axis === 'horizontal') { consider(r.top); consider(r.bottom); }
    else { consider(r.left); consider(r.right); }
  }

  const cache = pageEdges();
  if (cache) {
    const edges = axis === 'horizontal' ? cache.h : cache.v;
    const near: Edge[] = [];
    for (let i = lowerBound(edges, rawPosition - SNAP_THRESHOLD); i < edges.length; i++) {
      const edge = edges[i]!;
      if (edge.at > rawPosition + SNAP_THRESHOLD) break;
      near.push(edge);
    }
    near.sort((a, b) => Math.abs(a.at - rawPosition) - Math.abs(b.at - rawPosition));
    let confirms = 0;
    for (const edge of near) {
      // Nothing further away can beat what is already chosen.
      if (Math.abs(edge.at - rawPosition) >= minDist || confirms >= MAX_CONFIRMS) break;
      confirms++;
      if (edgeIsThere(edge, axis, mouseX, mouseY)) { consider(edge.at); break; }
    }
  }

  return best;
}

/** Snap for a guide being dragged; remembers the target so it can be shown. */
function findSnapPosition(
  axis: 'horizontal' | 'vertical',
  rawPosition: number,
  mouseX: number,
  mouseY: number,
): number {
  const best = snapPosition(axis, rawPosition, mouseX, mouseY);
  state.snapTarget = best !== rawPosition ? best : null;
  return best;
}

// ─── Placement preview ────────────────────────────────────────────────────────
// Where a click would put a guide. It snaps as you move, and the click places
// the guide exactly where the preview is drawn — never somewhere else.

interface Preview { x: number; y: number; snappedX: boolean; snappedY: boolean }

let preview: Preview = { x: 0, y: 0, snappedX: false, snappedY: false };

// Snapping is eased, not jumped: one smoother per preview line, one for a guide being dragged.
const previewEaseX = new SnapEase();
const previewEaseY = new SnapEase();
const dragEase = new SnapEase();
let previewKey = '';

function updatePreview(): Preview {
  const { mouseX, mouseY } = state;
  // Snapping hit-tests along the whole line, so only redo it when something moved.
  const key = `${mouseX},${mouseY},${window.scrollX},${window.scrollY},${state.snapEnabled},${state.placement}`;
  if (key === previewKey) return preview;
  previewKey = key;

  let x = mouseX;
  let y = mouseY;
  if (state.snapEnabled) {
    if (state.placement !== 'vertical') y = snapPosition('horizontal', mouseY, mouseX, mouseY);
    if (state.placement !== 'horizontal') x = snapPosition('vertical', mouseX, mouseX, mouseY);
  }
  preview = { x, y, snappedX: x !== mouseX, snappedY: y !== mouseY };
  return preview;
}

// ─── Event handlers ───────────────────────────────────────────────────────────

/** Guide position in viewport space (for hit-testing / drawing). */
function guideViewPos(guide: Guide): number {
  return guide.axis === 'horizontal'
    ? toViewY(guide.position)
    : toViewX(guide.position);
}

/** Convert a viewport position to document space for the given axis. */
function toGuidePagePos(axis: 'horizontal' | 'vertical', viewPos: number): number {
  return axis === 'horizontal' ? toPageY(viewPos) : toPageX(viewPos);
}

function getHandlePosition(guide: Guide): { x: number; y: number } {
  const M = RULER_SIZE + 4;
  const viewPos = guideViewPos(guide);
  return guide.axis === 'horizontal'
    ? { x: M, y: viewPos }
    : { x: viewPos, y: M };
}

function findGuideAtPoint(x: number, y: number, skip?: Set<string>): Guide | null {
  for (const guide of state.guides) {
    if (skip?.has(guide.id)) continue;
    const hp = getHandlePosition(guide);
    const dist = Math.hypot(x - hp.x, y - hp.y);
    if (dist <= HANDLE_HIT) return guide;
    const viewPos = guideViewPos(guide);
    if (guide.axis === 'horizontal' && Math.abs(y - viewPos) <= 4) return guide;
    if (guide.axis === 'vertical' && Math.abs(x - viewPos) <= 4) return guide;
  }
  return null;
}

function onKeyDown(e: KeyboardEvent): void {
  if (!state.interactive) return;
  const t = e.target as HTMLElement;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;

  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const key = e.key.toLowerCase();
  if (key === 'h') {
    e.preventDefault();
    e.stopPropagation();
    setGuidePlacement('horizontal');
    syncPlacementUi();
  } else if (key === 'v') {
    e.preventDefault();
    e.stopPropagation();
    setGuidePlacement('vertical');
    syncPlacementUi();
  } else if (key === 'c') {
    e.preventDefault();
    e.stopPropagation();
    setGuidePlacement('both');
    syncPlacementUi();
  }
}

function syncPlacementUi(): void {
  setSegmented(document, 'guide-placement', state.placement);
}

function onClick(e: MouseEvent): void {
  if (swallowClick) { swallowClick = false; return; }
  if (isRavalElement(e.target as Element)) return;
  if (state.hoveredId) return;
  if (e.button !== 0) return;

  // Place the guide where the preview is showing it, snap included.
  state.mouseX = e.clientX;
  state.mouseY = e.clientY;
  const { x, y } = updatePreview();

  const added: Guide[] = [];
  if (state.placement === 'both' || state.placement === 'horizontal') {
    added.push({ id: uid(), axis: 'horizontal', position: toGuidePagePos('horizontal', y) });
  }
  if (state.placement === 'both' || state.placement === 'vertical') {
    added.push({ id: uid(), axis: 'vertical', position: toGuidePagePos('vertical', x) });
  }
  state.guides.push(...added);
  for (const g of added) unarmed.add(g.id);
  pushUndo({ kind: 'add', ids: added.map((g) => g.id) });
  void persist();
}

function onMouseMove(e: MouseEvent): void {
  state.mouseX = e.clientX;
  state.mouseY = e.clientY;

  if (state.draggingId) {
    // A press only becomes a move once the pointer has travelled; a still press is a click (delete).
    if (press && !press.moved) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD) return;
      press.moved = true;
    }
    const guide = state.guides.find((g) => g.id === state.draggingId);
    if (guide) {
      const raw = guide.axis === 'horizontal' ? e.clientY : e.clientX;
      const viewPos = state.snapEnabled
        ? findSnapPosition(guide.axis, raw, e.clientX, e.clientY)
        : raw;
      guide.position = toGuidePagePos(guide.axis, viewPos);
      state.snapTarget = state.snapEnabled ? state.snapTarget : null;
    }
  } else {
    state.snapTarget = null;
    // A guide you just placed is still under the pointer; it only becomes
    // deletable once you have moved off it and come back.
    for (const id of [...unarmed]) {
      const only = new Set(state.guides.filter((g) => g.id !== id).map((g) => g.id));
      if (!findGuideAtPoint(e.clientX, e.clientY, only)) unarmed.delete(id);
    }
    const hovered = findGuideAtPoint(e.clientX, e.clientY, unarmed);
    state.hoveredId = hovered?.id ?? null;
  }
}

function onMouseDown(e: MouseEvent): void {
  swallowClick = false;
  if (e.button !== 0) return;
  if (isRavalElement(e.target as Element)) return;
  const guide = findGuideAtPoint(e.clientX, e.clientY);
  if (guide) {
    state.draggingId = guide.id;
    press = { id: guide.id, x: e.clientX, y: e.clientY, from: guide.position, moved: false };
    e.preventDefault();
  }
}

function onMouseUp(): void {
  if (!state.draggingId) return;
  dragEase.reset();
  const guide = state.guides.find((g) => g.id === state.draggingId);
  const p = press;
  press = null;
  state.draggingId = null;
  state.snapTarget = null;
  swallowClick = true;

  if (guide && p) {
    if (!p.moved) {
      removeGuide(guide);
    } else {
      if (guide.position !== p.from) pushUndo({ kind: 'move', id: guide.id, from: p.from });
      void persist();
    }
  }

  state.hoveredId = findGuideAtPoint(state.mouseX, state.mouseY)?.id ?? null;
  refreshCursor();
}

function onContextMenu(e: MouseEvent): void {
  const guide = findGuideAtPoint(e.clientX, e.clientY);
  if (guide) {
    e.preventDefault();
    e.stopPropagation();
    removeGuide(guide);
  }
}

// ─── Distance between guides ──────────────────────────────────────────────────
// With the pointer between two parallel guides, the gap between them is
// measured along the pointer. On a guide (hovered or being moved) it is that
// guide's distance to its neighbour on each side.

/** Closest guide of an axis on each side of a page position. */
function neighbours(axis: Guide['axis'], position: number, skipId?: string): { before: Guide | null; after: Guide | null } {
  let before: Guide | null = null;
  let after: Guide | null = null;
  for (const g of state.guides) {
    if (g.axis !== axis || g.id === skipId) continue;
    if (g.position < position && (!before || g.position > before.position)) before = g;
    if (g.position > position && (!after || g.position < after.position)) after = g;
  }
  return { before, after };
}

/** One measured gap along `axis` guides, from page position `from` to `to`, drawn through the pointer. */
function drawGap(ctx: CanvasRenderingContext2D, axis: Guide['axis'], from: number, to: number, x: number, y: number): void {
  const label = formatDistance(Math.abs(to - from));
  // Horizontal guides are a vertical distance apart, and the other way round.
  if (axis === 'horizontal') drawGuideGap(ctx, x, toViewY(from), x, toViewY(to), label, y);
  else drawGuideGap(ctx, toViewX(from), y, toViewX(to), y, label);
}

function drawGuideGaps(ctx: CanvasRenderingContext2D, anchor: Guide | undefined, at: Preview | null): void {
  if (anchor) {
    const { before, after } = neighbours(anchor.axis, anchor.position, anchor.id);
    if (before) drawGap(ctx, anchor.axis, before.position, anchor.position, state.mouseX, state.mouseY);
    if (after) drawGap(ctx, anchor.axis, anchor.position, after.position, state.mouseX, state.mouseY);
    return;
  }
  if (!at) return;
  for (const axis of ['horizontal', 'vertical'] as const) {
    const pointer = toGuidePagePos(axis, axis === 'horizontal' ? at.y : at.x);
    const { before, after } = neighbours(axis, pointer);
    if (before && after) drawGap(ctx, axis, before.position, after.position, at.x, at.y);
  }
}

// ─── Interactive render (live crosshair only — placed guides are on persist) ─

function scheduleFrame(): void {
  if (!overlay || !state.interactive) return;
  stopLoop?.();
  stopLoop = addRenderer(render);
}

function render(): void {
  if (!overlay) return;
  const { ctx, labelContainer } = overlay;

  clearCanvas(ctx);

  const dragged = state.draggingId ? state.guides.find((g) => g.id === state.draggingId) : undefined;
  const moving = Boolean(dragged && press?.moved);
  const overGuide = state.hoveredId !== null || state.draggingId !== null;

  // The placement preview would suggest a click adds a guide — over an existing one it deletes instead.
  // A snapped line is drawn stronger so you can see it has caught an edge.
  // No preview, readout or hint while the pointer is on the controls or a screenshot is being taken.
  const quiet = hoverSuppressed();
  const at = overGuide || quiet ? null : updatePreview();
  if (at) {
    // Each line glides onto an edge it catches and off one it lets go of.
    if (state.placement === 'both' || state.placement === 'horizontal') {
      const line = previewEaseY.step(at.y, at.snappedY ? at.y : null);
      drawGuide(ctx, 'horizontal', line.at, line.glow);
    }
    if (state.placement === 'both' || state.placement === 'vertical') {
      const line = previewEaseX.step(at.x, at.snappedX ? at.x : null);
      drawGuide(ctx, 'vertical', line.at, line.glow);
    }
  } else {
    // Hidden: start fresh next time instead of gliding in from where it last was.
    previewEaseX.reset();
    previewEaseY.reset();
  }

  if (state.showGaps && state.visible && !quiet) {
    const anchor = dragged ?? state.guides.find((g) => g.id === state.hoveredId);
    drawGuideGaps(ctx, anchor, at);
  }

  if (overGuide && !moving && !quiet) {
    setLabel(labelContainer, 'guide-hint', 'Click to delete · Drag to move', state.mouseX + 16, state.mouseY + 18);
  } else {
    hideLabel('guide-hint');
  }

  if (quiet) {
    hideLabel('crosshair-pos');
  } else {
    setLabel(
      labelContainer,
      'crosshair-pos',
      moving && dragged
        ? formatDistance(dragged.position)
        : `${Math.round(at?.x ?? state.mouseX)}, ${Math.round(at?.y ?? state.mouseY)}`,
      state.mouseX + 10,
      state.mouseY - 22,
    );
  }

  drawRulers(ctx, state.mouseX, state.mouseY);
}
