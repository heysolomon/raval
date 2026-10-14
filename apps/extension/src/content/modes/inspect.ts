/**
 * Inspect mode — hover to outline what is under the pointer and see its size;
 * click text or an element to open its typography, colours and box values.
 */
import type { Rect, CornerRadii } from '@raval/shared';
import type { OverlayElements } from '../overlay';
import { clearCanvas, drawRulers, drawColorPickHighlight } from '../renderer';
import { getElementAtPoint, getElementRect, getBoxModel, getCornerRadii } from '../detector';
import { isRavalElement, copyToClipboard, domRectToRect, formatDimensions, formatRadii } from '../utils';
import { showToast, setLabel, hideLabel } from '../labels';
import { setCursorResolver } from '../cursor';
import { BoxSpring, boxToRect } from '../motion';
import { addRenderer, markActive } from '../frame';
import { UI, segmentedHTML, setSegmented } from '../tokens';
import { onPageChange } from '../page-scope';
import { hoverSuppressed } from '../pointer';
import { getMarkColor, onMarkColor, onMarkColorChange } from '../mark-color';
import { readSpacing, drawSpacing, type Spacing } from '../spacing';

interface ColorEntry {
  label: string;
  raw:   string;     // raw computed value
  hex:   string;
  rgb:   string;
  hsl:   string;
  alpha: number;
}

interface TypeEntry {
  label: string;
  /** Shown in the panel and copied when the row is clicked. */
  value: string;
  /** Full declaration for "Copy CSS". */
  css:   string;
}

interface Selection {
  el:    Element;
  /** Present when a word of text was clicked rather than a whole element. */
  range: Range | null;
}

interface TextTarget {
  range: Range;
  el:    Element;
  rect:  Rect;
}

interface InspectState {
  mouseX:  number;
  mouseY:  number;
  colors:  ColorEntry[];
  format:  'hex' | 'rgb' | 'hsl';
  panelEl: HTMLDivElement | null;
  /** True while the pointer is over the colour panel — freezes follow + resampling. */
  pinned:  boolean;
  /** Set when the pointer is over a word of rendered text; null when over an element. */
  textTarget: TextTarget | null;
  /** Typography of the selected text — empty when an element (not text) is selected. */
  type: TypeEntry[];
  /** Margin, border, padding and radius of the selected element. */
  box: TypeEntry[];
  /** Element under the pointer when it is not text — gets the size label. */
  hoverEl: Element | null;
  /** Last sampled target, kept so the highlight stays put while the panel is in use. */
  lastRect: Rect | null;
  /** Clicked target whose details the panel shows. Nothing is shown until something is clicked. */
  selected: Selection | null;
}

const state: InspectState = {
  mouseX:  0,
  mouseY:  0,
  colors:  [],
  format:  'hex',
  panelEl: null,
  pinned:  false,
  textTarget: null,
  type: [],
  box: [],
  hoverEl: null,
  lastRect: null,
  selected: null,
};

const hoverBox = new BoxSpring();
const selectBox = new BoxSpring();
const panelSpring = new BoxSpring();

let overlay: OverlayElements | null = null;
let stopLoop: (() => void) | null = null;

// ─── Native text highlight (CSS Custom Highlight API) ─────────────────────────
// Recolours the live glyphs white against the accent fill — exactly how a real
// text selection paints — so the underlying text never needs to be duplicated
// or covered by the canvas. Falls back to no recolour on browsers without it.

const HIGHLIGHT_NAME = 'raval-inspect-text';
const supportsHighlightApi = typeof CSS !== 'undefined' && 'highlights' in CSS;
let highlightStyleEl: HTMLStyleElement | null = null;
let appliedRanges: Range[] = [];

function highlightRule(): string {
  return `::highlight(${HIGHLIGHT_NAME}) { background-color: ${getMarkColor()}; color: ${onMarkColor()}; }`;
}

onMarkColorChange(() => {
  if (highlightStyleEl) highlightStyleEl.textContent = highlightRule();
});

function ensureHighlightStyle(): void {
  if (highlightStyleEl) return;
  const style = document.createElement('style');
  style.id = 'raval-inspect-highlight-style';
  style.textContent = highlightRule();
  document.documentElement.appendChild(style);
  highlightStyleEl = style;
}

function sameRange(a: Range | null | undefined, b: Range): boolean {
  if (!a) return false;
  return a.startContainer === b.startContainer && a.startOffset === b.startOffset
    && a.endContainer === b.endContainer && a.endOffset === b.endOffset;
}

/** Highlight the hovered word and the clicked word together; pass none to clear. */
function applyTextHighlight(ranges: Range[]): void {
  if (!supportsHighlightApi) return;
  const unchanged = ranges.length === appliedRanges.length
    && ranges.every((r, i) => sameRange(appliedRanges[i], r));
  if (unchanged) return;

  if (ranges.length === 0) {
    CSS.highlights.delete(HIGHLIGHT_NAME);
  } else {
    ensureHighlightStyle();
    CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
  }
  appliedRanges = ranges;
}

function syncTextHighlight(): void {
  const ranges: Range[] = [];
  if (state.selected?.range) ranges.push(state.selected.range);
  const hover = state.textTarget?.range;
  if (hover && !sameRange(state.selected?.range, hover)) ranges.push(hover);
  applyTextHighlight(ranges);
}

// ─── Word-under-point detection ────────────────────────────────────────────────

const WORD_CHAR = /\S/;

type CaretPositionDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
};

/** Find the word of rendered text under the given viewport point, if any. */
function getTextRangeAtPoint(x: number, y: number): TextTarget | null {
  let node: Node | null = null;
  let offset = 0;

  if (typeof document.caretRangeFromPoint === 'function') {
    const r = document.caretRangeFromPoint(x, y);
    if (!r) return null;
    node = r.startContainer;
    offset = r.startOffset;
  } else {
    // Firefox before it adopted caretRangeFromPoint exposes the standard equivalent.
    const pos = (document as CaretPositionDocument).caretPositionFromPoint?.(x, y);
    if (!pos) return null;
    node = pos.offsetNode;
    offset = pos.offset;
  }

  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent ?? '';
  const parent = (node.parentElement) as Element | null;
  if (!parent || !text.trim() || isRavalElement(parent)) return null;

  let start = offset;
  let end = offset;
  while (start > 0 && WORD_CHAR.test(text[start - 1] ?? '')) start--;
  while (end < text.length && WORD_CHAR.test(text[end] ?? '')) end++;

  if (start === end) {
    // Landed on whitespace between words — nudge to the nearest preceding word.
    while (start > 0 && !WORD_CHAR.test(text[start - 1] ?? '')) start--;
    while (start > 0 && WORD_CHAR.test(text[start - 1] ?? '')) start--;
    end = start;
    while (end < text.length && WORD_CHAR.test(text[end] ?? '')) end++;
  }
  if (start === end) return null;

  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);

  const domRect = range.getBoundingClientRect();
  if (domRect.width === 0 || domRect.height === 0) return null;

  // Guard against sparse hit-testing handing back a caret far from the glyphs
  // (e.g. empty space at the end of a line).
  const pad = 3;
  if (x < domRect.left - pad || x > domRect.right + pad || y < domRect.top - pad || y > domRect.bottom + pad) {
    return null;
  }

  return { range, el: parent, rect: domRectToRect(domRect) };
}

// ─── Colour math ──────────────────────────────────────────────────────────────

function parseRgb(css: string): [number, number, number, number] | null {
  const m =
    css.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,/\s]+([\d.]+))?\s*\)/) ??
    css.match(/rgba?\(\s*(\d+)%[,\s]+(\d+)%[,\s]+(\d+)%(?:[,/\s]+([\d.]+))?\s*\)/);
  if (!m) return null;
  const r = Number(m[1]); const g = Number(m[2]); const b = Number(m[3]);
  const a = m[4] !== undefined ? Number(m[4]) : 1;
  return [r, g, b, a > 1 ? a / 100 : a];
}

function rgbToHex(r: number, g: number, b: number, a: number): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  const base = `#${h(r)}${h(g)}${h(b)}`;
  return a < 1 ? `${base}${h(Math.round(a * 255))}` : base;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255; const gn = g / 255; const bn = b / 255;
  const max = Math.max(rn, gn, bn); const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function cssColorToEntry(label: string, css: string): ColorEntry | null {
  if (!css || css === 'transparent' || css === 'rgba(0, 0, 0, 0)') return null;
  const parsed = parseRgb(css);
  if (!parsed) return null;
  const [r, g, b, a] = parsed;
  const [h, s, l] = rgbToHsl(r, g, b);
  return {
    label,
    raw:  css,
    hex:  rgbToHex(r, g, b, a),
    rgb:  a < 1 ? `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})` : `rgb(${r}, ${g}, ${b})`,
    hsl:  a < 1 ? `hsla(${h}, ${s}%, ${l}%, ${a.toFixed(2)})` : `hsl(${h}, ${s}%, ${l}%)`,
    alpha: a,
  };
}

// ─── Details panel ────────────────────────────────────────────────────────────
// Opens on click. Each group of properties is a collapsible section so the
// panel stays short: one section is open by default and the rest are a tap away.

const T = UI;
const FORMATS = ['hex', 'rgb', 'hsl'] as const;
const PANEL_WIDTH = 248;

const SECTION_KEYS = ['type', 'colors', 'box'] as const;
type SectionKey = typeof SECTION_KEYS[number];
/** Re-applies each rendered section's open/closed state; rebuilt with the panel. */
let sectionAppliers: (() => void)[] = [];

/** Sections opened or closed by hand. Anything not listed falls back to the default for the target. */
const sectionChoice: Partial<Record<SectionKey, boolean>> = {};

function isSectionOpen(key: SectionKey): boolean {
  const chosen = sectionChoice[key];
  if (chosen !== undefined) return chosen;
  // By default one section is open: typography for text, colours for everything else.
  if (key === 'type') return true;
  if (key === 'colors') return state.type.length === 0;
  return false;
}

const PANEL_STYLE = `
  position: fixed;
  left: 0;
  top: 0;
  width: ${PANEL_WIDTH}px;
  box-sizing: border-box;
  will-change: transform;
  opacity: 0;
  transition: opacity 0.15s ease-out;
  z-index: 2147483647;
  pointer-events: none;
  user-select: none;
  font-family: ${T.font};
  font-size: 12px;
  color: ${T.textPrimary};
  background: ${T.bg};
  border: 1px solid ${T.border};
  border-radius: ${T.radiusCard}px;
  box-shadow: ${T.shadow};
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
`;

const CHEVRON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`;

function colorValue(c: ColorEntry): string {
  return state.format === 'rgb' ? c.rgb : state.format === 'hsl' ? c.hsl : c.hex;
}

function wireRowHover(row: HTMLElement): void {
  row.addEventListener('mouseenter', () => { row.style.background = T.hover; });
  // Reset to transparent explicitly: clearing the inline value would hand a <button> back its grey browser default.
  row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
}

async function copy(value: string): Promise<void> {
  await copyToClipboard(value);
  showToast(`Copied ${value}`, { type: 'success' });
}

/** One "label … value" line; click copies the value. */
function propRow(label: string, value: string): HTMLDivElement {
  const row = document.createElement('div');
  row.title = 'Click to copy';
  row.style.cssText = `
    display:flex;align-items:baseline;justify-content:space-between;gap:12px;
    padding:5px 6px;margin:0 -6px;border-radius:6px;cursor:pointer;
    transition:background 0.1s ease;
  `;

  const l = document.createElement('span');
  l.style.cssText = `color:${T.textSecondary};font-size:11px;letter-spacing:-0.01em;flex-shrink:0;`;
  l.textContent = label;

  const v = document.createElement('span');
  v.style.cssText = `
    color:${T.textPrimary};font-family:${T.mono};font-size:11px;letter-spacing:-0.01em;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;text-align:right;
  `;
  v.textContent = value;

  row.append(l, v);
  wireRowHover(row);
  row.addEventListener('click', (e) => { e.stopPropagation(); void copy(value); });
  return row;
}

/** Collapsible section. The body animates open with a grid row, so no heights are measured. */
function sectionEl(key: SectionKey, title: string, summary: HTMLElement | null, body: HTMLElement): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = `border-top:1px solid ${T.borderSubtle};`;

  const head = document.createElement('button');
  head.type = 'button';
  head.style.cssText = `
    display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;
    padding:9px 12px;margin:0;border:none;background:transparent;cursor:pointer;outline:none;
    font-family:inherit;font-size:11px;font-weight:500;letter-spacing:-0.01em;color:${T.textPrimary};
    text-align:left;transition:background 0.1s ease;
  `;
  wireRowHover(head);

  const label = document.createElement('span');
  label.style.cssText = 'flex:1;';
  label.textContent = title;

  const chevron = document.createElement('span');
  chevron.style.cssText = `
    display:inline-flex;color:${T.textMuted};
    transition:transform 0.2s ${T.easeMove};
  `;
  chevron.innerHTML = CHEVRON;

  if (summary) summary.style.transition = 'opacity 0.15s ease';
  head.append(label, ...(summary ? [summary] : []), chevron);

  const region = document.createElement('div');
  region.style.cssText = `display:grid;transition:grid-template-rows 0.2s ${T.easeOut};`;
  const clip = document.createElement('div');
  clip.style.cssText = 'overflow:hidden;min-height:0;';
  body.style.padding = '0 12px 10px';
  clip.appendChild(body);
  region.appendChild(clip);

  const apply = (): void => {
    const open = isSectionOpen(key);
    head.setAttribute('aria-expanded', String(open));
    region.style.gridTemplateRows = open ? '1fr' : '0fr';
    chevron.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
    // The collapsed header previews what is inside; once open it would only repeat it.
    if (summary) summary.style.opacity = open ? '0' : '1';
  };
  apply();
  sectionAppliers.push(apply);

  head.addEventListener('click', (e) => {
    e.stopPropagation();
    // Accordion: opening one section closes the others, so the panel never grows long.
    const opening = !isSectionOpen(key);
    for (const k of SECTION_KEYS) sectionChoice[k] = opening && k === key;
    for (const fn of sectionAppliers) fn();
    markActive(400);
  });

  wrap.append(head, region);
  return wrap;
}

function renderColorRows(container: HTMLElement): void {
  container.innerHTML = '';
  if (state.colors.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = `color:${T.textMuted};font-size:11px;padding:6px 0;`;
    empty.textContent = 'No colours on this element';
    container.appendChild(empty);
    return;
  }

  for (const c of state.colors) {
    const row = document.createElement('div');
    row.title = 'Click to copy';
    row.style.cssText = `
      display:flex;align-items:center;gap:8px;padding:5px 6px;margin:0 -6px;
      border-radius:6px;cursor:pointer;transition:background 0.1s ease;
    `;

    const swatch = document.createElement('span');
    swatch.style.cssText = `
      width:14px;height:14px;border-radius:4px;flex-shrink:0;
      background:${c.raw};border:1px solid ${T.border};
    `;

    const label = document.createElement('span');
    label.style.cssText = `color:${T.textSecondary};font-size:11px;letter-spacing:-0.01em;flex:1;`;
    label.textContent = c.label;

    const value = document.createElement('span');
    value.style.cssText = `
      color:${T.textPrimary};font-family:${T.mono};font-size:11px;letter-spacing:-0.01em;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;
    `;
    value.textContent = colorValue(c);

    row.append(swatch, label, value);
    wireRowHover(row);
    row.addEventListener('click', (e) => { e.stopPropagation(); void copy(colorValue(c)); });
    container.appendChild(row);
  }
}

function buildPanel(): HTMLDivElement {
  const panel = document.createElement('div');
  panel.id = 'raval-inspect-panel';
  panel.setAttribute('style', PANEL_STYLE);

  panel.addEventListener('click', (e) => {
    const fmtBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-fmt]');
    if (!fmtBtn) return;
    e.stopPropagation();
    setFormat(fmtBtn.dataset['fmt'] as typeof FORMATS[number]);
  });
  return panel;
}

function setFormat(format: typeof FORMATS[number]): void {
  state.format = format;
  if (!state.panelEl) return;
  setSegmented(state.panelEl, 'fmt', format);
  const rows = state.panelEl.querySelector<HTMLElement>('[data-color-rows]');
  if (rows) renderColorRows(rows);
}

/** Rebuild the panel for the current selection. */
function refreshPanel(): void {
  const panel = state.panelEl;
  const sel = state.selected;
  if (!panel || !sel) return;
  panel.innerHTML = '';
  sectionAppliers = [];

  // Header: what was clicked and how big it is
  const rect = getElementRect(sel.el);
  const size = formatDimensions(rect.width, rect.height);
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 12px;';

  const tag = document.createElement('span');
  tag.style.cssText = `font-family:${T.mono};font-size:11px;color:${T.textSecondary};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
  tag.textContent = `<${sel.el.tagName.toLowerCase()}>`;

  const dims = document.createElement('span');
  dims.title = 'Click to copy';
  dims.style.cssText = `font-family:${T.mono};font-size:11px;color:${T.textPrimary};cursor:pointer;flex-shrink:0;`;
  dims.textContent = size;
  dims.addEventListener('click', (e) => { e.stopPropagation(); void copy(size); });

  header.append(tag, dims);
  panel.appendChild(header);

  if (state.type.length > 0) {
    const body = document.createElement('div');
    for (const t of state.type) body.appendChild(propRow(t.label, t.value));

    const copyAll = document.createElement('button');
    copyAll.type = 'button';
    copyAll.textContent = 'Copy CSS';
    copyAll.style.cssText = `
      width:100%;height:24px;margin:6px 0 0;padding:0;border:none;border-radius:6px;
      background:${T.track};color:${T.textSecondary};cursor:pointer;outline:none;
      font-family:inherit;font-size:10px;font-weight:500;letter-spacing:-0.01em;
      transition:transform 0.1s ease, color 0.15s ease;
    `;
    copyAll.addEventListener('mouseenter', () => { copyAll.style.color = T.textPrimary; });
    copyAll.addEventListener('mouseleave', () => { copyAll.style.color = T.textSecondary; copyAll.style.transform = ''; });
    copyAll.addEventListener('mousedown', () => { copyAll.style.transform = 'scale(0.98)'; });
    copyAll.addEventListener('mouseup', () => { copyAll.style.transform = ''; });
    copyAll.addEventListener('click', async (e) => {
      e.stopPropagation();
      const textColor = state.colors.find((c) => c.label === 'Color');
      const lines = state.type.map((t) => t.css);
      if (textColor) lines.push(`color: ${textColor.hex};`);
      await copyToClipboard(lines.join('\n'));
      showToast('Copied typography CSS', { type: 'success' });
    });
    body.appendChild(copyAll);

    const font = document.createElement('span');
    font.style.cssText = `color:${T.textMuted};font-size:11px;font-weight:400;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
    font.textContent = state.type[0]?.value ?? '';
    panel.appendChild(sectionEl('type', 'Typography', font, body));
  }

  {
    const body = document.createElement('div');
    const fmt = document.createElement('div');
    fmt.style.cssText = 'margin-bottom:6px;';
    fmt.innerHTML = segmentedHTML('fmt', FORMATS.map((f) => ({ id: f, label: f.toUpperCase() })), state.format);
    const rows = document.createElement('div');
    rows.dataset['colorRows'] = '';
    renderColorRows(rows);
    if (state.colors.length > 0) body.appendChild(fmt);
    body.appendChild(rows);

    // Preview the palette as dots while the section is closed
    const dots = document.createElement('span');
    dots.style.cssText = 'display:inline-flex;gap:3px;';
    for (const c of state.colors.slice(0, 4)) {
      const dot = document.createElement('span');
      dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${c.raw};border:1px solid ${T.border};`;
      dots.appendChild(dot);
    }
    panel.appendChild(sectionEl('colors', 'Colours', dots, body));
  }

  if (state.box.length > 0) {
    const body = document.createElement('div');
    for (const b of state.box) body.appendChild(propRow(b.label, b.value));
    panel.appendChild(sectionEl('box', 'Box', null, body));
  }
}

let panelPos = { x: NaN, y: NaN };
const PANEL_GAP = 10;
const VIEWPORT_PAD = 8;

function setPanelVisible(visible: boolean): void {
  if (!state.panelEl) return;
  state.panelEl.style.opacity = visible ? '1' : '0';
  state.panelEl.style.pointerEvents = visible ? 'all' : 'none';
}

/** Anchor the panel under the selected target (above when there is no room), inside the viewport. */
function positionPanel(target: Rect): void {
  if (!state.panelEl) return;
  const panelW = state.panelEl.offsetWidth  || PANEL_WIDTH;
  const panelH = state.panelEl.offsetHeight || 160;
  const vw = window.innerWidth; const vh = window.innerHeight;

  const maxX = vw - panelW - VIEWPORT_PAD;
  const maxY = vh - panelH - VIEWPORT_PAD;
  const clampX = (v: number): number => Math.round(Math.max(VIEWPORT_PAD, Math.min(maxX, v)));
  const clampY = (v: number): number => Math.round(Math.max(VIEWPORT_PAD, Math.min(maxY, v)));

  // Below, else above, else beside — never on top of the thing being inspected.
  let x: number;
  let y: number;
  if (target.bottom + PANEL_GAP <= maxY) {
    x = clampX(target.left); y = Math.round(target.bottom + PANEL_GAP);
  } else if (target.top - PANEL_GAP - panelH >= VIEWPORT_PAD) {
    x = clampX(target.left); y = Math.round(target.top - PANEL_GAP - panelH);
  } else if (target.right + PANEL_GAP <= maxX) {
    x = Math.round(target.right + PANEL_GAP); y = clampY(target.top);
  } else {
    x = clampX(target.left - PANEL_GAP - panelW); y = clampY(target.top);
  }

  // Glide to the new spot with the same spring as the hover highlight, so
  // picking another element moves the panel there instead of jumping.
  const at = panelSpring.step({ x, y, width: 0, height: 0, left: x, top: y, right: x, bottom: y });
  if (at && (at.x !== panelPos.x || at.y !== panelPos.y)) {
    state.panelEl.style.transform = `translate3d(${at.x}px, ${at.y}px, 0)`;
    panelPos = { x: at.x, y: at.y };
  }
}

function selectionRect(sel: Selection): Rect {
  return sel.range ? domRectToRect(sel.range.getBoundingClientRect()) : getElementRect(sel.el);
}

/** What the panel keeps clear of: the selection, or its whole margin box while the spacing bands are drawn. */
function panelAnchor(sel: Selection): Rect {
  return showSpacing ? spacingOf(sel.el).margin : selectionRect(sel);
}

function select(sel: Selection): void {
  const wasOpen = state.selected !== null;
  state.selected = sel;
  state.colors = extractColors(sel.el, !!sel.range);
  state.type = sel.range ? extractTypography(sel.el) : [];
  state.box = extractBox(sel.el);
  refreshPanel();
  // A panel that is opening appears in place; only one that is already open glides.
  if (!wasOpen) panelSpring.reset();
  positionPanel(panelAnchor(sel));
  setPanelVisible(true);
  syncTextHighlight();
}

function deselect(): void {
  if (!state.selected) return;
  state.selected = null;
  selectBox.reset();
  setPanelVisible(false);
  syncTextHighlight();
}

// ─── Colour extraction ────────────────────────────────────────────────────────

function extractColors(el: Element, prioritizeTextColor = false): ColorEntry[] {
  const css = window.getComputedStyle(el);
  const background: [string, string] = ['Background', css.backgroundColor];
  const color:      [string, string] = ['Color',      css.color];
  const candidates: [string, string][] = [
    ...(prioritizeTextColor ? [color, background] : [background, color]),
    ['Border',     css.borderTopColor],
    ['Outline',    css.outlineColor],
    // Every element computes a default black `fill`; it only means something on SVG.
    ...(el instanceof SVGElement
      ? [['Fill', css.getPropertyValue('fill')], ['Stroke', css.getPropertyValue('stroke')]] as [string, string][]
      : []),
  ];

  const result: ColorEntry[] = [];
  const seen = new Set<string>();

  for (const [label, raw] of candidates) {
    if (!raw) continue;
    const entry = cssColorToEntry(label, raw);
    if (entry && !seen.has(entry.hex)) {
      seen.add(entry.hex);
      result.push(entry);
    }
  }
  return result;
}

// ─── Typography extraction ────────────────────────────────────────────────────

const WEIGHT_NAMES: Record<string, string> = {
  '100': 'Thin', '200': 'Extra Light', '300': 'Light', '400': 'Regular', '500': 'Medium',
  '600': 'Semibold', '700': 'Bold', '800': 'Extra Bold', '900': 'Black',
};

/** Trim float noise: 1.5000001 → "1.5" */
function num(n: number, digits = 3): string {
  return String(Number(n.toFixed(digits)));
}

function extractTypography(el: Element): TypeEntry[] {
  const css = window.getComputedStyle(el);
  const size = parseFloat(css.fontSize) || 0;
  const entries: TypeEntry[] = [];

  const stack = css.fontFamily;
  const primary = (stack.split(',')[0] ?? stack).trim().replace(/^["']|["']$/g, '');
  entries.push({ label: 'Font', value: primary, css: `font-family: ${stack};` });

  entries.push({ label: 'Size', value: `${num(size)}px`, css: `font-size: ${num(size)}px;` });

  const weightName = WEIGHT_NAMES[css.fontWeight];
  entries.push({
    label: 'Weight',
    value: weightName ? `${css.fontWeight} ${weightName}` : css.fontWeight,
    css: `font-weight: ${css.fontWeight};`,
  });

  const lh = parseFloat(css.lineHeight);
  if (Number.isNaN(lh) || !size) {
    entries.push({ label: 'Line height', value: css.lineHeight, css: `line-height: ${css.lineHeight};` });
  } else {
    entries.push({
      label: 'Line height',
      value: `${num(lh)}px / ${num(lh / size)}`,
      css: `line-height: ${num(lh / size)};`,
    });
  }

  const ls = parseFloat(css.letterSpacing);
  if (Number.isNaN(ls) || ls === 0 || !size) {
    entries.push({ label: 'Letter spacing', value: '0', css: 'letter-spacing: 0;' });
  } else {
    entries.push({
      label: 'Letter spacing',
      value: `${num(ls)}px / ${num(ls / size)}em`,
      css: `letter-spacing: ${num(ls / size)}em;`,
    });
  }

  const ws = parseFloat(css.wordSpacing);
  if (!Number.isNaN(ws) && ws !== 0) {
    entries.push({ label: 'Word spacing', value: `${num(ws)}px`, css: `word-spacing: ${num(ws)}px;` });
  }
  if (css.fontStyle !== 'normal') {
    entries.push({ label: 'Style', value: css.fontStyle, css: `font-style: ${css.fontStyle};` });
  }
  if (css.textTransform !== 'none') {
    entries.push({ label: 'Transform', value: css.textTransform, css: `text-transform: ${css.textTransform};` });
  }
  if (css.textDecorationLine && css.textDecorationLine !== 'none') {
    entries.push({
      label: 'Decoration',
      value: css.textDecorationLine,
      css: `text-decoration: ${css.textDecorationLine};`,
    });
  }

  return entries;
}

// The open details belong to the page they were opened on.
onPageChange(() => deselect());

// ─── Box extraction ───────────────────────────────────────────────────────────

/** Collapse four sides to the shortest CSS shorthand: "16px", "8px 16px", … */
function shorthand(top: number, right: number, bottom: number, left: number): string {
  const px = (n: number): string => (n === 0 ? '0' : `${num(n, 2)}px`);
  if (top === right && right === bottom && bottom === left) return px(top);
  if (top === bottom && right === left) return `${px(top)} ${px(right)}`;
  if (right === left) return `${px(top)} ${px(right)} ${px(bottom)}`;
  return `${px(top)} ${px(right)} ${px(bottom)} ${px(left)}`;
}

function extractBox(el: Element): TypeEntry[] {
  const { margin, border, padding } = getBoxModel(el);
  const entries: TypeEntry[] = [];
  for (const [label, prop, v] of [
    ['Margin', 'margin', margin], ['Border', 'border-width', border], ['Padding', 'padding', padding],
  ] as const) {
    const value = shorthand(v.top, v.right, v.bottom, v.left);
    entries.push({ label, value, css: `${prop}: ${value};` });
  }
  const radius = window.getComputedStyle(el).borderRadius;
  if (radius && radius !== '0px') entries.push({ label: 'Radius', value: radius, css: `border-radius: ${radius};` });
  return entries;
}

// ─── Corner radius ────────────────────────────────────────────────────────────

const RADII_MEMO_MS = 120;
let radiiMemo = new WeakMap<Element, { t: number; radii: CornerRadii | null }>();

/** Rendered corner radii of an element. Read every frame, so the style lookup is reused briefly. */
function radiiOf(el: Element): CornerRadii | null {
  const now = performance.now();
  const hit = radiiMemo.get(el);
  if (hit && now - hit.t < RADII_MEMO_MS) return hit.radii;
  const radii = getCornerRadii(el);
  radiiMemo.set(el, { t: now, radii });
  return radii;
}

// ─── Spacing ──────────────────────────────────────────────────────────────────

let showSpacing = false;
let spacingMemo: { el: Element; t: number; sx: number; sy: number; spacing: Spacing } | null = null;

/** Show the clicked element's padding, margin and child gaps (the "Show spacing" setting). */
export function setInspectSpacing(visible: boolean): void {
  showSpacing = visible;
  markActive();
}

/** Read every frame while something is selected; the style and child lookups are reused until something moves. */
function spacingOf(el: Element): Spacing {
  const now = performance.now();
  const m = spacingMemo;
  if (m && m.el === el && m.sx === window.scrollX && m.sy === window.scrollY && now - m.t < RADII_MEMO_MS) return m.spacing;
  const spacing = readSpacing(el);
  spacingMemo = { el, t: now, sx: window.scrollX, sy: window.scrollY, spacing };
  return spacing;
}

// ─── Event handlers ───────────────────────────────────────────────────────────

function onMouseMove(e: MouseEvent): void {
  // Over the panel (or any Raval UI) keep the last sample so nothing shifts underneath a click.
  if (isRavalElement(e.target as Element)) {
    state.pinned = true;
    return;
  }

  state.pinned = false;
  state.mouseX = e.clientX;
  state.mouseY = e.clientY;
}

/** Click a word or element to open its details; click it again, or empty space, to close. */
function onClick(e: MouseEvent): void {
  if (e.button !== 0 || isRavalElement(e.target as Element)) return;

  const text = getTextRangeAtPoint(e.clientX, e.clientY);
  const el = text ? text.el : getElementAtPoint(e.clientX, e.clientY);
  if (!el) { deselect(); return; }

  const range = text ? text.range : null;
  const cur = state.selected;
  const same = cur !== null && cur.el === el
    && (range && cur.range ? sameRange(cur.range, range) : range === cur.range);
  if (same) { deselect(); return; }

  select({ el, range });
}

function scheduleFrame(): void {
  if (!overlay) return;
  stopLoop?.();
  stopLoop = addRenderer(render);
}

const SAMPLE_MEMO_MS = 120;
let lastSample = { x: NaN, y: NaN, sx: NaN, sy: NaN, t: 0 };

/**
 * Hit-testing, caret lookup and computed-style reads are the expensive part of
 * this mode. Redo them only when the pointer or scroll moved, or after a short
 * interval so page-driven changes still show up.
 */
function sampleIsStale(): boolean {
  const now = performance.now();
  const s = lastSample;
  if (
    s.x === state.mouseX && s.y === state.mouseY &&
    s.sx === window.scrollX && s.sy === window.scrollY &&
    now - s.t < SAMPLE_MEMO_MS
  ) {
    return false;
  }
  lastSample = { x: state.mouseX, y: state.mouseY, sx: window.scrollX, sy: window.scrollY, t: now };
  return true;
}

function render(): void {
  if (!overlay) return;
  const { ctx } = overlay;
  clearCanvas(ctx);

  // On the controls, or mid-screenshot: no hover state at all. The selection stays.
  if (hoverSuppressed()) {
    if (state.lastRect || state.textTarget || state.hoverEl) {
      state.textTarget = null;
      state.hoverEl = null;
      state.lastRect = null;
      lastSample = { x: NaN, y: NaN, sx: NaN, sy: NaN, t: 0 };
      syncTextHighlight();
    }
  } else if (!state.pinned && sampleIsStale()) {
    // Hover only finds and outlines the target — details are read on click.
    const text = getTextRangeAtPoint(state.mouseX, state.mouseY);
    const el = text ? text.el : getElementAtPoint(state.mouseX, state.mouseY);
    state.textTarget = text;
    state.hoverEl = text ? null : el;
    state.lastRect = text ? text.rect : el ? getElementRect(el) : null;
    syncTextHighlight();
  }

  const sel = state.selected;
  if (sel && !sel.el.isConnected) {
    deselect();
  } else if (sel) {
    const rect = selectionRect(sel);
    positionPanel(panelAnchor(sel));
    const locked = selectBox.step(rect);
    if (locked) {
      // Spacing belongs to what was clicked. For a clicked word that is the element holding it,
      // the same one the panel's Box section describes.
      if (showSpacing) drawSpacing(ctx, spacingOf(sel.el), locked.opacity);
      // With the bands on, the selection is an outline only, so its tint does not muddy their colours.
      drawColorPickHighlight(ctx, locked, !!sel.range, true, !supportsHighlightApi, sel.range ? null : radiiOf(sel.el), showSpacing);
    }
  }

  // While pinned, keep drawing the last target so the highlight doesn't blink out.
  const box = hoverBox.step(state.lastRect);
  const hoverEl = state.hoverEl?.isConnected ? state.hoverEl : null;
  const hoverRadii = hoverEl ? radiiOf(hoverEl) : null;
  if (box) drawColorPickHighlight(ctx, box, !!state.textTarget, false, !supportsHighlightApi, hoverRadii);

  // Elements (not words) also get their size, and their corner radius when they have one.
  if (box && hoverEl) {
    const real = getElementRect(hoverEl);
    const r = boxToRect(box);
    const labelY = r.top > 28 ? r.top - 30 : r.bottom + 8;
    const dims = formatDimensions(real.width, real.height);
    const text = hoverRadii ? `${dims} · ${formatRadii(hoverRadii)}` : dims;
    setLabel(overlay.labelContainer, 'dimension', text, r.left, labelY, text);
  } else {
    hideLabel('dimension');
  }

  drawRulers(ctx, state.mouseX, state.mouseY);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Cycle HEX → RGB → HSL (wired to the `F` key from the content script). */
export function cycleColorFormat(): void {
  const idx = FORMATS.indexOf(state.format);
  setFormat(FORMATS[(idx + 1) % FORMATS.length] ?? 'hex');
}

/** Close the open details panel. Returns false when nothing was open. */
export function closeInspectDetails(): boolean {
  if (!state.selected) return false;
  deselect();
  return true;
}

export function initInspectMode(o: OverlayElements): void {
  overlay = o;
  state.hoverEl = null;
  state.pinned = false;
  state.textTarget = null;
  state.selected = null;
  hoverBox.reset();
  selectBox.reset();
  panelPos = { x: NaN, y: NaN };
  lastSample = { x: NaN, y: NaN, sx: NaN, sy: NaN, t: 0 };
  radiiMemo = new WeakMap();
  spacingMemo = null;

  const panel = buildPanel();
  document.documentElement.appendChild(panel);
  state.panelEl = panel;

  document.addEventListener('mousemove', onMouseMove, { passive: true });
  document.addEventListener('click', onClick, true);
  setCursorResolver(() => (state.textTarget ? 'text' : 'crosshair'));
  scheduleFrame();
}

export function destroyInspectMode(): void {
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('click', onClick, true);
  stopLoop?.();
  stopLoop = null;

  setCursorResolver(null);
  state.selected = null;
  selectBox.reset();
  applyTextHighlight([]);
  highlightStyleEl?.remove();
  highlightStyleEl = null;

  state.panelEl?.remove();
  state.panelEl = null;
  state.colors  = [];
  state.type    = [];
  state.box     = [];
  state.hoverEl = null;
  hideLabel('dimension');
  state.lastRect = null;
  state.pinned  = false;
  state.textTarget = null;
  hoverBox.reset();

  overlay = null;
}
