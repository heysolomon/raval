/**
 * In-page floating control panel + design tokens view.
 *
 * Single popup card (draggable via header grip):
 *   Header    — grip + brand + close
 *   Toolbar   — mode tools + capture actions
 *   Tray      — mode-contextual settings / annotate / guides (inside card)
 *   More menu — clear actions, tokens, shortcuts hint
 *
 * Tokens view opens as a card below the main popup.
 */
import type { ExtensionState, Mode, Message } from '@raval/shared';
import { DEFAULT_STATE } from '@raval/shared';
import { copyToClipboard } from './utils';
import { showErrorReport, showToast } from './labels';
import {
  clearGuides,
  setGuidePlacement,
  getGuidePlacement,
  setGuidesVisible,
  setGuideLabelsVisible,
  setGuideGapsVisible,
  setSnapEnabled,
  type GuidePlacement,
} from './modes/guides';
import { setShowRulers } from './renderer';
import { markActive } from './frame';
import { setInspectSpacing } from './modes/inspect';
import { MARK_COLORS, getMarkColor, setMarkColor, onMarkColorChange } from './mark-color';
import { withChromeHidden } from './capture-chrome';
import type { SettingKey } from '@raval/shared';
import {
  clearAnnotations,
  setAnnotateTool,
  getAnnotateTool,
  NOTE_SIZES,
  PEN_SIZES,
  getPenSize,
  setPenSize,
  NOTE_FONTS,
  getNoteFont,
  setNoteFont,
  type NoteFontId,
  ARROW_ENDS,
  getArrowEnd,
  setArrowEnd,
  type ArrowEnd,
  getNoteSize,
  setNoteSize,
  type AnnotateTool,
} from './modes/annotate';
import { clearMeasurements } from './modes/measure';
import { startRegionCapture, cancelRegionCapture, isRegionCaptureActive } from './region-capture';
import { loadPanelPosition, savePanelPosition, saveSetting, type PanelPosition } from './storage';
import { UI, segmentedHTML, setSegmented, swatchHTML, setSwatches } from './tokens';

const PANEL_ID = 'raval-panel';
/** Estimate used only before the toolbar has been measured; the real width follows its buttons. */
const PANEL_WIDTH = 344;
/** Sub-cards are narrower than the toolbar and hang from its right edge, under the buttons that open them. */
const TRAY_WIDTH = 228;
const TOKENS_WIDTH = 280;
const TOKENS_VIEW_HEIGHT = 374;
/** Consistent inset from every viewport edge. */
const PANEL_INSET = 16;

// ─── Theme tokens ─────────────────────────────────────────────────────────────

const T = {
  bg:            UI.bg,
  border:        UI.border,
  borderSubtle:  UI.borderSubtle,
  textPrimary:   UI.textPrimary,
  textSecondary: UI.textSecondary,
  textMuted:     UI.textMuted,
  accent:        UI.accent,
  accentTint:    UI.accentTint,
  shadow:        UI.shadow,
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const PANEL_CSS = `
  position: fixed;
  z-index: 2147483647;
  width: max-content;
  max-width: calc(100vw - ${PANEL_INSET * 2}px);
  box-sizing: border-box;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
  font-family: 'Neue Plak Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  color: ${T.textPrimary};
  pointer-events: all;
  user-select: none;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  animation: raval-panel-in 0.25s cubic-bezier(0.34, 1.2, 0.64, 1) both;
  overflow: visible;
`;

const PANEL_MARGIN = PANEL_INSET;
/** Release near a corner within this distance → soft magnetic snap. */
const CORNER_MAGNET_PX = 72;
/** Flick speed (px/ms) that forces a corner snap in the throw direction. */
const CORNER_FLICK_VX = 0.55;
/** Spring settle — snappy with a light overshoot at edges/corners. */
const SPRING_STIFFNESS = 320;
const SPRING_DAMPING = 24;
/** Rubber-band resistance when dragging past the viewport edge. */
const RUBBER_CONSTANT = 0.55;
const RUBBER_DIM = 180;

const KEYFRAMES = `
  @keyframes raval-panel-in {
    from { opacity: 0; transform: scale(0.95) translateY(-6px); }
    to   { opacity: 1; transform: scale(1)    translateY(0);    }
  }
  @keyframes raval-panel-out {
    from { opacity: 1; transform: scale(1)    translateY(0);    }
    to   { opacity: 0; transform: scale(0.95) translateY(-6px); }
  }
  @media (prefers-reduced-motion: reduce) {
    #raval-panel, #raval-panel * { animation: none !important; transition: none !important; }
  }
`;

// ─── Logo SVG (inline) ────────────────────────────────────────────────────────

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 256 256"><path d="M 256 256 L 128 256 L 0 128 L 128 128 Z M 256 128 L 128 128 L 0 0 L 128 0 Z" fill="currentColor"></path></svg>`;

// ─── Mode icons (Hugeicons stroke style) ──────────────────────────────────────

const SVG_ATTRS = `xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"`;

const MODE_ICONS: Record<string, string> = {
  browse:      `<svg ${SVG_ATTRS}><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>`,
  inspect:     `<svg ${SVG_ATTRS}><path d="M5 3l5.5 17 2.5-5.5L18.5 12 5 3z"/><path d="M13 14.5l4.5 4.5"/></svg>`,
  measure:     `<svg ${SVG_ATTRS}><rect x="2" y="8" width="20" height="8" rx="1.5"/><line x1="6" y1="8" x2="6" y2="13"/><line x1="10" y1="8" x2="10" y2="11.5"/><line x1="14" y1="8" x2="14" y2="11.5"/><line x1="18" y1="8" x2="18" y2="13"/></svg>`,
  guides:      `<svg ${SVG_ATTRS}><line x1="12" y1="3" x2="12" y2="21"/><line x1="3" y1="12" x2="21" y2="12"/><circle cx="12" cy="12" r="2.5"/></svg>`,
  annotate:    `<svg ${SVG_ATTRS}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
};

const SCREENSHOT_ICON = `<svg ${SVG_ATTRS}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
const REGION_ICON = `<svg ${SVG_ATTRS}><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/></svg>`;

const SETTINGS_ICON = `<svg ${SVG_ATTRS}><path d="M4 8h2.75M11.25 8H20M4 16h8.75M17.25 16H20"/><circle cx="9" cy="8" r="2.25"/><circle cx="15" cy="16" r="2.25"/></svg>`;
const MORE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/></svg>`;
const CLOSE_ICON = `<svg ${SVG_ATTRS}><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>`;

// ─── Progressive disclosure — mode-contextual settings ────────────────────────

interface SettingDef {
  id:    string;
  label: string;
}

const MODE_SETTINGS: Record<Mode, SettingDef[]> = {
  browse:      [{ id: 'guides',   label: 'Show guides'     }],
  inspect:     [{ id: 'spacing',  label: 'Show spacing'    }, { id: 'rulers', label: 'Rulers' }],
  measure:     [{ id: 'rulers',   label: 'Rulers'          }],
  guides:      [{ id: 'guides', label: 'Show guides' }, { id: 'guideLabels', label: 'Show positions' }, { id: 'guideGaps', label: 'Measure between guides' }, { id: 'snap', label: 'Snap to elements' }, { id: 'rulers', label: 'Rulers' }],
  annotate:    [{ id: 'rulers',   label: 'Rulers'          }],
};

const ANNOTATE_TOOLS: { id: AnnotateTool; label: string; key: string }[] = [
  { id: 'measure', label: 'Callout', key: 'M' },
  { id: 'note',    label: 'Note',  key: 'N' },
  { id: 'arrow',   label: 'Arrow', key: 'A' },
  { id: 'pen',     label: 'Pen',   key: 'P' },
];

function arrowEndRowHTML(side: 'start' | 'end', label: string): string {
  return `
    <div style="display:flex;align-items:center;gap:8px;${side === 'end' ? 'margin-top:6px;' : ''}">
      <span style="width:30px;flex-shrink:0;font-size:11px;color:${T.textSecondary};letter-spacing:-0.01em;">${label}</span>
      <div style="flex:1;">
        ${segmentedHTML(`arrow-${side}`, ARROW_ENDS.map((e) => ({ id: e.id, label: e.label, title: `${label}: ${e.label.toLowerCase()}` })), getArrowEnd(side))}
      </div>
    </div>
  `;
}

function annotateToolsHTML(active: AnnotateTool): string {
  return `
    <div style="margin-bottom:4px;">
      ${segmentedHTML('annotate-tool', ANNOTATE_TOOLS.map((t) => ({ id: t.id, label: t.label, title: `${t.label} (${t.key})` })), active)}

      <!-- Text size, shown only for the note tool -->
      <div data-note-size-row style="display:${active === 'note' ? 'block' : 'none'};margin-top:10px;">
        ${segmentedHTML('note-size', NOTE_SIZES.map((n) => ({ id: n.id, label: n.label, title: `${n.px}px` })), String(getNoteSize()))}
        <!-- Each face is named in itself, so the choice can be seen before it is made -->
        <div style="margin-top:6px;">
          ${segmentedHTML('note-font', NOTE_FONTS.map((f) => ({
            id: f.id,
            label: `<span style="font-family:${f.stack.replace(/"/g, "'")};font-size:12px;font-weight:600;">${f.label}</span>`,
            title: `${f.label} handwriting`,
          })), getNoteFont())}
        </div>
      </div>

      <!-- Stroke width, shown only for the pen tool -->
      <div data-pen-size-row style="display:${active === 'pen' ? 'block' : 'none'};margin-top:10px;">
        ${segmentedHTML('pen-size', PEN_SIZES.map((n) => ({ id: n.id, label: n.label, title: `${n.px}px` })), String(getPenSize()))}
      </div>

      <!-- What each end of the line is drawn with, shown only for the arrow tool -->
      <div data-arrow-ends-row style="display:${active === 'arrow' ? 'block' : 'none'};margin-top:10px;">
        ${arrowEndRowHTML('start', 'Start')}
        ${arrowEndRowHTML('end', 'End')}
      </div>
    </div>
  `;
}

/** Update the annotate controls in place so the tab pill slides instead of being rebuilt. */
function updateAnnotateUi(tool: AnnotateTool): void {
  if (!panelEl) return;
  setSegmented(panelEl, 'annotate-tool', tool);

  // The size row comes and goes with the note tool, the ends rows with the arrow tool;
  // keep the card inset as its height changes.
  for (const [selector, show] of [['[data-note-size-row]', tool === 'note'], ['[data-arrow-ends-row]', tool === 'arrow'], ['[data-pen-size-row]', tool === 'pen']] as const) {
    const row = panelEl.querySelector<HTMLElement>(selector);
    if (row && (row.style.display !== 'none') !== show) {
      row.style.display = show ? 'block' : 'none';
      schedulePanelReadjust();
    }
  }
}

const GUIDE_PLACEMENTS: { id: GuidePlacement; label: string; key: string }[] = [
  { id: 'both',       label: 'Both', key: 'C' },
  { id: 'horizontal', label: 'H only', key: 'H' },
  { id: 'vertical',   label: 'V only', key: 'V' },
];

function guideToolsHTML(active: GuidePlacement): string {
  return `
    <div style="margin-bottom:4px;">
      ${segmentedHTML('guide-placement', GUIDE_PLACEMENTS.map((t) => ({ id: t.id, label: t.label, title: `${t.label} (${t.key})` })), active)}
    </div>
  `;
}

function updateGuidePlacementUi(placement: GuidePlacement): void {
  if (panelEl) setSegmented(panelEl, 'guide-placement', placement);
}

// ─── Token types ──────────────────────────────────────────────────────────────

interface Token {
  name:  string;
  value: string;
  type:  'color' | 'spacing' | 'font' | 'other';
}

type TokenFilter = 'all' | Token['type'];

const TOKEN_FILTERS: TokenFilter[]             = ['all', 'color', 'spacing', 'font', 'other'];
const TOKEN_FILTER_LABELS: Record<TokenFilter, string> = {
  all: 'All', color: 'Color', spacing: 'Space', font: 'Font', other: 'Other',
};
const TOKEN_TYPE_COLORS: Record<Token['type'], string> = {
  color: '#C0392B', spacing: '#0E7490', font: '#166534', other: '#737373',
};

// ─── State ────────────────────────────────────────────────────────────────────

let panelEl: HTMLElement | null = null;
let localState: ExtensionState   = { ...DEFAULT_STATE };
let currentView: 'main' | 'tokens' = 'main';
let moreMenuOpen = false;
/** Settings card visibility. Hidden at rest; opens on demand or for modes with tools. */
let trayOpen = false;
/** The user's own choice, restored when leaving a mode that forces the card open. */
let trayPinned = false;
let allTokens: Token[]            = [];
let activeTokenFilter: TokenFilter = 'all';
let onDocPointerDown: ((e: MouseEvent) => void) | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendMsg(msg: Message): Promise<ExtensionState> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res: ExtensionState) => resolve(res));
  });
}

function getSettingValue(state: ExtensionState, id: string): boolean {
  switch (id) {
    case 'guides':      return state.showGuides;
    case 'guideLabels': return state.showGuideLabels;
    case 'guideGaps':   return state.showGuideGaps;
    case 'rulers':      return state.showRulers;
    case 'spacing':     return state.showSpacing;
    case 'snap':        return state.snapToElements;
    default:            return false;
  }
}

/** Annotate and guides have tool pickers you need in reach, so their card opens with the mode. */
function modeNeedsTools(mode: Mode): boolean {
  return mode === 'annotate' || mode === 'guides';
}

// ─── Token extraction ─────────────────────────────────────────────────────────

function classifyToken(name: string, value: string): Token['type'] {
  const n = name.toLowerCase();
  const v = value.trim();
  if (/color|colour|bg|background|fill|stroke|shadow/.test(n)) return 'color';
  if (/^#[0-9a-f]{3,8}$/i.test(v) || /^rgb|hsl/.test(v))      return 'color';
  if (/spacing|gap|margin|padding|size|width|height|radius/.test(n)) return 'spacing';
  if (/^-?[\d.]+px$/.test(v) || /^-?[\d.]+rem$/.test(v))       return 'spacing';
  if (/font|text|type|weight|line/.test(n))                      return 'font';
  return 'other';
}

function extractTokens(): Token[] {
  const tokens: Token[] = [];
  const seen = new Set<string>();
  const add = (name: string, raw: string): void => {
    const value = raw.trim();
    if (!name.startsWith('--') || !value || seen.has(name)) return;
    seen.add(name);
    tokens.push({ name, value, type: classifyToken(name, value) });
  };

  // Rules can be nested inside @media, @supports and @layer blocks.
  const walk = (rules: CSSRuleList): void => {
    for (const rule of Array.from(rules)) {
      const style = (rule as CSSStyleRule).style as CSSStyleDeclaration | undefined;
      if (style) for (const prop of Array.from(style)) add(prop, style.getPropertyValue(prop));
      const nested = (rule as CSSGroupingRule).cssRules as CSSRuleList | undefined;
      if (nested?.length) walk(nested);
    }
  };

  for (const sheet of Array.from(document.styleSheets)) {
    // Reading a stylesheet served from another origin throws. Skip it rather
    // than let one CDN stylesheet stop the whole panel from opening.
    try { walk(sheet.cssRules); } catch { /* unreadable — covered below where possible */ }
  }

  // Tokens defined in unreadable stylesheets still apply to the page, so pick
  // up whatever is set on the root and body from their computed values.
  for (const el of [document.documentElement, document.body]) {
    const map = (el as Element & { computedStyleMap?: () => Iterable<[string, Iterable<{ toString(): string }>]> })
      ?.computedStyleMap?.();
    if (!map) continue;
    for (const [name, values] of map) {
      if (name.startsWith('--')) add(name, Array.from(values).map((v) => v.toString()).join(' '));
    }
  }

  return tokens.sort((a, b) => a.name.localeCompare(b.name));
}

function exportTokensJson(): void {
  const obj: Record<string, string> = {};
  for (const t of allTokens) obj[t.name] = t.value;
  const json = JSON.stringify(obj, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `design-tokens-${Date.now()}.json`;
  a.style.display = 'none';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Exported tokens.json', { type: 'success' });
}

// ─── HTML builders ────────────────────────────────────────────────────────────

function toggleHTML(id: string, checked: boolean): string {
  const bg       = checked ? T.accent : 'rgba(0,0,0,0.12)';
  const knobLeft = checked ? '15px' : '2px';
  return `
    <button
      data-toggle="${id}"
      role="switch"
      aria-checked="${checked}"
      style="
        position:relative;width:30px;height:17px;border-radius:9px;
        border:none;cursor:pointer;background:${bg};
        outline:none;flex-shrink:0;padding:0;
        transition:background 0.2s cubic-bezier(0.22,1,0.36,1);
      "
    >
      <span style="
        position:absolute;top:2px;left:${knobLeft};
        width:13px;height:13px;border-radius:50%;
        background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.22);
        transition:left 0.18s cubic-bezier(0.4,0,0.2,1);
      "></span>
    </button>
  `;
}

function settingRowHTML(def: SettingDef, checked: boolean, isLast: boolean): string {
  const border = isLast ? 'none' : `1px solid ${T.borderSubtle}`;
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:${border};">
      <span style="font-size:12px;color:${T.textSecondary};letter-spacing:-0.01em;">${def.label}</span>
      ${toggleHTML(def.id, checked)}
    </div>
  `;
}

function toolBtnStyle(active: boolean): string {
  return `
    position:relative;display:inline-flex;align-items:center;justify-content:center;
    width:28px;height:28px;padding:0;border:none;border-radius:8px;
    background:${active ? T.accentTint : 'transparent'};
    color:${active ? T.accent : T.textSecondary};
    cursor:pointer;font-family:inherit;outline:none;flex-shrink:0;
    transition:background 0.15s ease, color 0.15s ease, transform 0.1s ease;
  `;
}

function modeBtnHTML(id: Mode, label: string, shortcut: number, active: boolean): string {
  const icon = MODE_ICONS[id] ?? label;
  return `<button data-mode="${id}" data-tip="${label}" data-tip-key="${shortcut}" aria-label="${label}" aria-pressed="${active}" style="${toolBtnStyle(active)}">${icon}</button>`;
}

function actionBtnHTML(action: string, label: string, icon: string, extraAttrs = ''): string {
  return `<button data-action="${action}" data-tip="${label}" aria-label="${label}" ${extraAttrs} style="${toolBtnStyle(false)}">${icon}</button>`;
}

function dividerHTML(): string {
  return `<div style="width:1px;height:14px;background:${T.border};margin:0 4px;flex-shrink:0;"></div>`;
}

function surfaceCSS(extra = ''): string {
  return `
    background:${T.bg};border:1px solid ${T.border};border-radius:12px;
    box-shadow:${T.shadow};${extra}
  `;
}

function trayContentHTML(state: ExtensionState): string {
  const settings = MODE_SETTINGS[state.mode] ?? [];
  const showAnnotate = state.mode === 'annotate';
  const showGuides = state.mode === 'guides';
  return `
    <!-- The colour everything on the page is drawn in, whatever the tool -->
    <div data-mark-colors style="display:flex;align-items:center;justify-content:space-between;padding:0 3px;height:26px;margin-bottom:8px;">
      ${MARK_COLORS.map((c) => swatchHTML('mark-color', c.hex, c.label, c.hex.toLowerCase() === getMarkColor().toLowerCase())).join('')}
    </div>
    <div data-annotate-tools style="display:${showAnnotate ? 'block' : 'none'};margin-bottom:${showAnnotate ? '8px' : '0'};">
      ${annotateToolsHTML(showAnnotate ? getAnnotateTool() : 'measure')}
    </div>
    <div data-guide-tools style="display:${showGuides ? 'block' : 'none'};margin-bottom:${showGuides ? '8px' : '0'};">
      ${guideToolsHTML(getGuidePlacement())}
    </div>
    <div data-settings-rows>
      ${settings.map((def, i) => settingRowHTML(def, getSettingValue(state, def.id), i === settings.length - 1)).join('')}
    </div>
  `;
}

function moreMenuHTML(): string {
  const item = `
    display:block;width:100%;text-align:left;padding:8px 12px;border:none;background:transparent;
    font-size:12px;font-weight:500;font-family:inherit;color:${T.textSecondary};
    cursor:pointer;outline:none;letter-spacing:-0.01em;
  `;
  return `
    <div data-more-menu style="
      display:none;position:absolute;top:calc(100% + 10px);right:0;z-index:2;
      min-width:180px;padding:4px 0;${surfaceCSS()}
    ">
      <button data-action="clear-guides" style="${item}">Clear guides</button>
      <button data-action="clear-measurements" style="${item}">Clear measurements</button>
      <button data-action="clear-annotations" style="${item}">Clear annotations</button>
      <div style="height:1px;background:${T.borderSubtle};margin:4px 0;"></div>
      <button data-action="tokens" style="${item}">Tokens</button>
      <div style="height:1px;background:${T.borderSubtle};margin:4px 0;"></div>
      <p style="font-size:10px;color:${T.textMuted};padding:6px 12px 8px;margin:0;letter-spacing:-0.01em;">
        <kbd style="font-size:9px;font-family:inherit;background:#f5f5f5;border:1px solid ${T.border};border-bottom-width:2px;border-radius:3px;padding:0 4px;color:${T.textSecondary};">?</kbd> for shortcuts
      </p>
    </div>
  `;
}

function buildPanelHTML(state: ExtensionState): string {
  const modes: { id: Mode; label: string; key: number }[] = [
    { id: 'browse',      label: 'Browse',   key: 0 },
    { id: 'inspect',     label: 'Inspect',  key: 1 },
    { id: 'measure',     label: 'Measure',  key: 2 },
    { id: 'guides',      label: 'Guides',   key: 3 },
    { id: 'annotate',    label: 'Annotate', key: 4 },
  ];

  return `
    <style>${KEYFRAMES}</style>
    <div data-panel-root style="display:flex;flex-direction:column;align-items:stretch;gap:8px;">

      <!-- Toolbar pill — everything at rest lives in this one row; drag from any gap -->
      <div data-main-card data-drag-handle style="
        position:relative;display:flex;align-items:center;gap:0;
        width:100%;height:40px;box-sizing:border-box;padding:0 6px;overflow:visible;
        cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none;
        ${surfaceCSS('border-radius:20px;')}
      ">
        <span aria-hidden="true" style="
          display:inline-flex;align-items:center;justify-content:center;
          width:22px;height:28px;color:${T.textPrimary};flex-shrink:0;pointer-events:none;
        ">${LOGO_SVG}</span>

        ${dividerHTML()}

        <div data-toolbar style="display:flex;align-items:center;gap:0;flex-shrink:0;">
          ${modes.map(({ id, label, key }) => modeBtnHTML(id, label, key, state.mode === id)).join('')}
        </div>

        ${dividerHTML()}

        <div style="display:flex;align-items:center;gap:0;flex-shrink:0;">
          ${actionBtnHTML('screenshot', 'Screenshot', SCREENSHOT_ICON)}
          ${actionBtnHTML('region', 'Region capture', REGION_ICON)}
        </div>

        ${dividerHTML()}

        <div style="position:relative;display:flex;align-items:center;gap:0;flex-shrink:0;">
          ${actionBtnHTML('toggle-tray', 'Options', SETTINGS_ICON, `aria-expanded="${trayOpen}"`)}
          ${actionBtnHTML('toggle-more', 'More', MORE_ICON, 'aria-expanded="false"')}
          ${actionBtnHTML('close', 'Close', CLOSE_ICON)}
          ${moreMenuHTML()}
        </div>

        <div data-tooltip role="tooltip" style="
          display:none;position:absolute;left:0;top:calc(100% + 10px);z-index:3;
          padding:4px 8px;border-radius:${UI.radiusChip}px;background:${T.bg};color:${T.textPrimary};
          border:1px solid ${T.border};box-shadow:${UI.shadowSm};
          font-size:11px;font-weight:500;letter-spacing:-0.01em;white-space:nowrap;pointer-events:none;
        "></div>
      </div>

      <!-- Options card — hidden at rest, opens on demand -->
      <div data-tray data-open="${trayOpen}" style="
        display:${trayOpen ? 'block' : 'none'};
        align-self:flex-end;width:${TRAY_WIDTH}px;max-width:100%;box-sizing:border-box;
        padding:8px 12px 10px;transform-origin:top right;
        ${surfaceCSS('border-radius:14px;')}
      ">
        ${trayContentHTML(state)}
      </div>

      <!-- Tokens card (lazy-filled) -->
      <div data-tokens-card style="
        display:none;align-self:flex-end;width:${TOKENS_WIDTH}px;max-width:100%;
        height:${TOKENS_VIEW_HEIGHT}px;box-sizing:border-box;transform-origin:top right;
        overflow:hidden;${surfaceCSS('border-radius:14px;')}
      "></div>

    </div>
  `;
}

// ─── DOM builder — tokens view (lazy) ────────────────────────────────────────

function buildTokensViewElement(): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = `width:100%;height:100%;display:flex;flex-direction:column;`;

  const btnBase = `
    background:none;border:1px solid ${T.border};border-radius:5px;
    font-size:10px;font-weight:500;font-family:inherit;letter-spacing:-0.01em;
    color:${T.textSecondary};cursor:pointer;outline:none;transition:background 0.12s;padding:4px 8px;
  `;

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px 10px;flex-shrink:0;">
      <div style="display:flex;align-items:center;gap:6px;">
        <button data-action="back-to-main" style="
          display:inline-flex;align-items:center;justify-content:center;
          width:20px;height:20px;border-radius:5px;
          background:none;border:none;cursor:pointer;
          color:${T.textMuted};font-size:13px;line-height:1;
          font-family:inherit;outline:none;
          transition:background 0.12s, color 0.12s;
        ">←</button>
        <span style="font-size:12px;font-weight:600;letter-spacing:-0.03em;color:${T.textPrimary};">Design Tokens</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span data-token-count style="font-size:10px;color:${T.textMuted};"></span>
        <button data-action="export-tokens" style="${btnBase}">Export</button>
      </div>
    </div>
    <div style="height:1px;background:${T.borderSubtle};flex-shrink:0;"></div>
    <div style="padding:8px 14px;flex-shrink:0;">
      ${segmentedHTML('token-filter', TOKEN_FILTERS.map((f) => ({ id: f, label: TOKEN_FILTER_LABELS[f] })), 'all')}
    </div>
    <div style="height:1px;background:${T.borderSubtle};flex-shrink:0;"></div>
    <div data-token-rows style="overflow-y:auto;flex:1;padding:4px 0;"></div>
  `;

  return el;
}

// ─── Partial DOM updates ──────────────────────────────────────────────────────

function setToolBtnActive(btn: HTMLElement, active: boolean): void {
  btn.style.background = active ? T.accentTint : 'transparent';
  btn.style.color = active ? T.accent : T.textSecondary;
  btn.setAttribute('aria-pressed', String(active));
}

function updateModeOnly(mode: Mode): void {
  if (!panelEl) return;


  panelEl.querySelectorAll<HTMLElement>('[data-mode]').forEach((btn) => {
    setToolBtnActive(btn, btn.dataset['mode'] === mode);
  });

  const toolsWrap = panelEl.querySelector<HTMLElement>('[data-annotate-tools]');
  if (toolsWrap) {
    const on = mode === 'annotate';
    toolsWrap.style.display = on ? 'block' : 'none';
    toolsWrap.style.marginBottom = on ? '8px' : '0';
    if (on) toolsWrap.innerHTML = annotateToolsHTML(getAnnotateTool());
  }

  const guideTools = panelEl.querySelector<HTMLElement>('[data-guide-tools]');
  if (guideTools) {
    const on = mode === 'guides';
    guideTools.style.display = on ? 'block' : 'none';
    guideTools.style.marginBottom = on ? '8px' : '0';
    if (on) guideTools.innerHTML = guideToolsHTML(getGuidePlacement());
  }

  updateSettingRows(mode);
  updateTrayVisibility(mode);
  schedulePanelReadjust();
}

/** Shared enter/exit: fade + 4px slide + slight scale and blur. Exit is quicker than enter. */
const PRESENCE_EASE = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
const PRESENCE_IN_MS = 160;
const PRESENCE_OUT_MS = 120;
const presenceTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

function setPresence(el: HTMLElement, open: boolean, onHidden?: () => void): void {
  const pending = presenceTimers.get(el);
  if (pending) clearTimeout(pending);
  const wasOpen = el.dataset['open'] === 'true' && el.style.display !== 'none';
  el.dataset['open'] = String(open);
  const hidden = 'translateY(-4px) scale(0.98)';

  if (prefersReducedMotion()) {
    el.style.transition = 'none';
    el.style.opacity = '1';
    el.style.transform = 'none';
    el.style.filter = 'none';
    el.style.display = open ? 'block' : 'none';
    if (!open) onHidden?.();
    return;
  }

  if (open) {
    el.style.display = 'block';
    if (!wasOpen) {
      el.style.transition = 'none';
      el.style.opacity = '0';
      el.style.transform = hidden;
      el.style.filter = 'blur(2px)';
      void el.offsetHeight;
    }
    el.style.transition = ['opacity', 'transform', 'filter']
      .map((p) => `${p} ${PRESENCE_IN_MS}ms ${PRESENCE_EASE}`).join(',');
    el.style.opacity = '1';
    el.style.transform = 'translateY(0) scale(1)';
    el.style.filter = 'blur(0)';
    el.style.pointerEvents = 'auto';
    return;
  }

  if (el.style.display === 'none') { onHidden?.(); return; }
  el.style.transition = ['opacity', 'transform', 'filter']
    .map((p) => `${p} ${PRESENCE_OUT_MS}ms ${PRESENCE_EASE}`).join(',');
  el.style.opacity = '0';
  el.style.transform = hidden;
  el.style.filter = 'blur(2px)';
  el.style.pointerEvents = 'none';
  presenceTimers.set(el, setTimeout(() => {
    el.style.display = 'none';
    onHidden?.();
  }, PRESENCE_OUT_MS));
}

/** Show or hide the options card to match `trayOpen`, keeping the panel inset as its height changes. */
function applyTray(): void {
  if (!panelEl) return;
  const tray = panelEl.querySelector<HTMLElement>('[data-tray]');
  const btn = panelEl.querySelector<HTMLElement>('[data-action="toggle-tray"]');
  if (btn) {
    btn.setAttribute('aria-expanded', String(trayOpen));
    setToolBtnActive(btn, trayOpen);
    btn.removeAttribute('aria-pressed');
  }
  if (!tray) return;

  const show = trayOpen && currentView === 'main';
  if (show) {
    setPresence(tray, true);
    schedulePanelReadjust();
  } else {
    setPresence(tray, false, () => schedulePanelReadjust());
  }
}

function updateTrayVisibility(mode: Mode): void {
  trayOpen = trayPinned || modeNeedsTools(mode);
  applyTray();
}

function updateToggleOnly(id: string, checked: boolean): void {
  if (!panelEl) return;
  const toggle = panelEl.querySelector<HTMLElement>(`[data-toggle="${id}"]`);
  if (!toggle) return;
  toggle.style.background = checked ? T.accent : 'rgba(0,0,0,0.12)';
  toggle.setAttribute('aria-checked', String(checked));
  const knob = toggle.querySelector<HTMLElement>('span');
  if (knob) knob.style.left = checked ? '15px' : '2px';
}

function updateSettingRows(mode: Mode): void {
  if (!panelEl) return;
  const rowsHost = panelEl.querySelector<HTMLElement>('[data-settings-rows]');
  if (!rowsHost) return;

  const settings = MODE_SETTINGS[mode];
  rowsHost.innerHTML = settings
    .map((def, i) => settingRowHTML(def, getSettingValue(localState, def.id), i === settings.length - 1))
    .join('');
}

function updateTokenFilter(filter: TokenFilter): void {
  if (panelEl) setSegmented(panelEl, 'token-filter', filter);
}

function renderTokenRows(): void {
  if (!panelEl) return;
  const rows    = panelEl.querySelector<HTMLElement>('[data-token-rows]');
  const countEl = panelEl.querySelector<HTMLElement>('[data-token-count]');
  if (!rows) return;

  const filtered = activeTokenFilter === 'all'
    ? allTokens
    : allTokens.filter((t) => t.type === activeTokenFilter);

  if (countEl) countEl.textContent = `${filtered.length}`;
  rows.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = `color:${T.textMuted};font-size:11px;text-align:center;padding:16px 0;`;
    empty.textContent = 'No tokens found';
    rows.appendChild(empty);
    return;
  }

  for (const token of filtered) {
    const row = document.createElement('div');
    row.style.cssText = `display:flex;align-items:center;gap:8px;padding:5px 14px;cursor:pointer;transition:background 0.1s;`;
    row.title = 'Click to copy value';

    const swatch = document.createElement('span');
    swatch.style.cssText = `width:12px;height:12px;border-radius:2px;flex-shrink:0;border:1px solid rgba(0,0,0,0.08);`;
    if (token.type === 'color') swatch.style.background = token.value;
    else { swatch.style.background = TOKEN_TYPE_COLORS[token.type]; swatch.style.opacity = '0.3'; }

    const info = document.createElement('span');
    info.style.cssText = 'flex:1;overflow:hidden;min-width:0;';

    const name = document.createElement('div');
    name.style.cssText = `color:${TOKEN_TYPE_COLORS[token.type]};font-family:"JetBrains Mono",monospace;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
    name.textContent = token.name;

    const value = document.createElement('div');
    value.style.cssText = `color:${T.textSecondary};font-family:"JetBrains Mono",monospace;font-size:10px;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
    value.textContent = token.value;

    info.appendChild(name); info.appendChild(value);
    row.appendChild(swatch); row.appendChild(info);

    row.addEventListener('mouseenter', () => { row.style.background = 'rgba(0,0,0,0.03)'; });
    row.addEventListener('mouseleave', () => { row.style.background = ''; });
    row.addEventListener('click', async () => {
      await copyToClipboard(token.value);
      showToast(`Copied ${token.name}`, { type: 'success' });
    });

    rows.appendChild(row);
  }
}

/** What each settings toggle controls. */
const TOGGLES: Record<string, {
  key: SettingKey;
  message: 'TOGGLE_GUIDES' | 'TOGGLE_GUIDE_LABELS' | 'TOGGLE_GUIDE_GAPS' | 'TOGGLE_RULERS' | 'TOGGLE_SPACING' | 'TOGGLE_SNAP';
  apply: (enabled: boolean) => void;
}> = {
  guides:      { key: 'showGuides',      message: 'TOGGLE_GUIDES',       apply: setGuidesVisible },
  guideLabels: { key: 'showGuideLabels', message: 'TOGGLE_GUIDE_LABELS', apply: setGuideLabelsVisible },
  guideGaps:   { key: 'showGuideGaps',   message: 'TOGGLE_GUIDE_GAPS',   apply: setGuideGapsVisible },
  rulers:      { key: 'showRulers',      message: 'TOGGLE_RULERS',       apply: setShowRulers },
  spacing:     { key: 'showSpacing',     message: 'TOGGLE_SPACING',      apply: setInspectSpacing },
  snap:        { key: 'snapToElements',  message: 'TOGGLE_SNAP',         apply: setSnapEnabled },
};

// Wherever the colour is changed from (a swatch, a shortcut, a saved choice), the swatches follow.
onMarkColorChange((hex) => {
  if (panelEl) setSwatches(panelEl, 'mark-color', hex);
});

/** Switches the mode inside this page. Provided by the content script entry point. */
let switchModeLocally: ((mode: Mode) => void) | null = null;

export function registerModeSwitcher(fn: (mode: Mode) => void): void {
  switchModeLocally = fn;
}

// ─── More menu ────────────────────────────────────────────────────────────────

const MORE_MENU_GAP = 10;

function positionMoreMenu(menu: HTMLElement, btn: HTMLElement): void {
  // Reset so we measure the natural size, then pick a side that fits.
  menu.style.top = '';
  menu.style.bottom = '';
  menu.style.left = '';
  menu.style.right = '0';
  menu.style.display = 'block';

  const btnRect = btn.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 8;

  const spaceBelow = vh - btnRect.bottom - margin;
  const spaceAbove = btnRect.top - margin;
  const openUp =
    spaceBelow < menuRect.height + MORE_MENU_GAP &&
    spaceAbove > spaceBelow;

  if (openUp) {
    menu.style.top = 'auto';
    menu.style.bottom = `calc(100% + ${MORE_MENU_GAP}px)`;
  } else {
    menu.style.bottom = 'auto';
    menu.style.top = `calc(100% + ${MORE_MENU_GAP}px)`;
  }

  // Prefer right-aligned to the button; flip if it would overflow the left edge.
  const rightAlignedLeft = btnRect.right - menuRect.width;
  const leftAlignedLeft = btnRect.left;
  const openLeft =
    rightAlignedLeft < margin &&
    leftAlignedLeft + menuRect.width <= vw - margin;

  if (openLeft) {
    menu.style.right = 'auto';
    menu.style.left = '0';
  } else {
    menu.style.left = 'auto';
    menu.style.right = '0';
  }
}

function setMoreMenuOpen(open: boolean): void {
  if (!panelEl) return;
  moreMenuOpen = open;
  const menu = panelEl.querySelector<HTMLElement>('[data-more-menu]');
  const btn  = panelEl.querySelector<HTMLElement>('[data-action="toggle-more"]');
  if (menu) {
    if (open && btn) {
      positionMoreMenu(menu, btn);
      menu.dataset['open'] = 'false';
      menu.style.transformOrigin = menu.style.top === 'auto' ? 'bottom right' : 'top right';
    }
    setPresence(menu, open);
  }
  if (btn) {
    btn.setAttribute('aria-expanded', String(open));
    setToolBtnActive(btn, open);
    btn.removeAttribute('aria-pressed');
  }
  if (open) hideTooltip();
}

// ─── View switching (tokens card below toolbar) ───────────────────────────────

function switchView(view: 'main' | 'tokens'): void {
  if (!panelEl || currentView === view) return;

  const tray = panelEl.querySelector<HTMLElement>('[data-tray]');
  const card = panelEl.querySelector<HTMLElement>('[data-tokens-card]');
  if (!card) return;

  setMoreMenuOpen(false);

  if (view === 'tokens') {
    currentView = 'tokens';

    if (!card.firstElementChild) {
      const tokensEl = buildTokensViewElement();
      wireHover(
        tokensEl.querySelector<HTMLElement>('[data-action="back-to-main"]')!,
        { background: 'rgba(0,0,0,0.07)', color: T.textSecondary },
        { background: 'transparent',       color: T.textMuted      },
      );
      wireHover(
        tokensEl.querySelector<HTMLElement>('[data-action="export-tokens"]')!,
        { background: 'rgba(0,0,0,0.04)' }, { background: 'none' },
      );
      card.appendChild(tokensEl);
    }

    allTokens = extractTokens();
    activeTokenFilter = 'all';
    renderTokenRows();
    updateTokenFilter('all');

    if (tray) { tray.style.display = 'none'; tray.dataset['open'] = 'false'; }
    setPresence(card, true);
  } else {
    currentView = 'main';
    card.style.display = 'none';
    card.dataset['open'] = 'false';
    applyTray();
  }

  schedulePanelReadjust();
}

// ─── Event wiring ─────────────────────────────────────────────────────────────

function wireHover(
  el: HTMLElement,
  enter: Partial<CSSStyleDeclaration>,
  leave: Partial<CSSStyleDeclaration>,
): void {
  if (!el) return;
  el.addEventListener('mouseenter', () => Object.assign(el.style, enter));
  el.addEventListener('mouseleave', () => Object.assign(el.style, leave));
}

function isBtnOn(btn: HTMLElement): boolean {
  return btn.getAttribute('aria-pressed') === 'true' || btn.getAttribute('aria-expanded') === 'true';
}

function wireIconHover(btn: HTMLElement): void {
  btn.addEventListener('mouseenter', () => {
    showTooltipFor(btn);
    if (isBtnOn(btn)) return;
    btn.style.background = 'rgba(0,0,0,0.05)';
    btn.style.color = T.textPrimary;
  });
  btn.addEventListener('mouseleave', () => {
    hideTooltip(true);
    btn.style.transform = '';
    if (isBtnOn(btn)) {
      btn.style.background = T.accentTint;
      btn.style.color = T.accent;
      return;
    }
    btn.style.background = 'transparent';
    btn.style.color = T.textSecondary;
  });
  // Press feedback
  btn.addEventListener('mousedown', () => { btn.style.transform = 'scale(0.92)'; hideTooltip(); });
  btn.addEventListener('mouseup', () => { btn.style.transform = ''; });
}

// ─── Tooltips ─────────────────────────────────────────────────────────────────
// The first one waits so it never gets in the way; while you keep moving along
// the toolbar the next ones appear immediately.

const TOOLTIP_DELAY_MS = 850;
const TOOLTIP_WARM_MS = 400;
let tooltipTimer: ReturnType<typeof setTimeout> | null = null;
let tooltipWarmUntil = 0;

function showTooltipFor(btn: HTMLElement): void {
  const label = btn.dataset['tip'];
  if (!panelEl || !label || moreMenuOpen) return;
  const tip = panelEl.querySelector<HTMLElement>('[data-tooltip]');
  const card = panelEl.querySelector<HTMLElement>('[data-main-card]');
  if (!tip || !card) return;

  if (tooltipTimer) clearTimeout(tooltipTimer);
  const warm = performance.now() < tooltipWarmUntil || tip.style.display === 'block';

  const reveal = (): void => {
    const key = btn.dataset['tipKey'];
    tip.textContent = label;
    if (key) {
      const kbd = document.createElement('span');
      kbd.textContent = key;
      kbd.style.cssText = `margin-left:8px;color:${T.textMuted};font-variant-numeric:tabular-nums;`;
      tip.appendChild(kbd);
    }

    tip.style.display = 'block';
    const cardRect = card.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const above = window.innerHeight - cardRect.bottom < tip.offsetHeight + 18;
    tip.style.top = above ? 'auto' : 'calc(100% + 10px)';
    tip.style.bottom = above ? 'calc(100% + 10px)' : 'auto';
    const centre = btnRect.left + btnRect.width / 2 - cardRect.left;
    const half = tip.offsetWidth / 2;
    const left = Math.min(Math.max(centre - half, 0), cardRect.width - tip.offsetWidth);
    tip.style.left = `${left}px`;
    tip.style.transformOrigin = `${centre - left}px ${above ? '100%' : '0'}`;

    if (warm || prefersReducedMotion()) {
      tip.style.transition = 'none';
    } else {
      tip.style.transition = 'none';
      tip.style.opacity = '0';
      tip.style.transform = 'scale(0.95)';
      void tip.offsetHeight;
      tip.style.transition = 'opacity 135ms ease, transform 135ms ease';
    }
    tip.style.opacity = '1';
    tip.style.transform = 'scale(1)';
  };

  if (warm) reveal();
  else tooltipTimer = setTimeout(reveal, TOOLTIP_DELAY_MS);
}

function hideTooltip(keepWarm = false): void {
  if (tooltipTimer) { clearTimeout(tooltipTimer); tooltipTimer = null; }
  const tip = panelEl?.querySelector<HTMLElement>('[data-tooltip]');
  if (!tip) return;
  if (keepWarm && tip.style.display === 'block') tooltipWarmUntil = performance.now() + TOOLTIP_WARM_MS;
  tip.style.display = 'none';
}

function wireEvents(panel: HTMLElement): void {
  panel.querySelectorAll<HTMLElement>('[data-mode], [data-main-card] [data-tip]').forEach(wireIconHover);

  panel.querySelectorAll<HTMLElement>('[data-action="clear-guides"],[data-action="clear-measurements"],[data-action="clear-annotations"],[data-action="tokens"]').forEach((btn) => {
    wireHover(btn, { background: 'rgba(0,0,0,0.04)', color: T.textPrimary }, { background: 'transparent', color: T.textSecondary });
  });

  // Close more menu on outside click
  onDocPointerDown = (e: MouseEvent): void => {
    if (!moreMenuOpen || !panelEl) return;
    const el = e.target as HTMLElement;
    if (el.closest('[data-action="toggle-more"]') || el.closest('[data-more-menu]')) return;
    setMoreMenuOpen(false);
  };
  document.addEventListener('mousedown', onDocPointerDown);

  // A button pressed with the mouse should not hold on to keyboard focus: the next shortcut key
  // would light its focus ring up, on a control the pointer has long since left. Buttons worked
  // from the keyboard (detail 0) keep focus as usual.
  panel.addEventListener('click', (e) => {
    const focused = document.activeElement;
    if (e.detail > 0 && focused instanceof HTMLButtonElement && panel.contains(focused)) focused.blur();
  });

  panel.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;

    if (target.closest('[data-action="close"]'))        { hidePanel(); return; }
    if (target.closest('[data-action="back-to-main"]')) { switchView('main'); return; }

    if (target.closest('[data-action="toggle-more"]')) {
      setMoreMenuOpen(!moreMenuOpen);
      return;
    }

    if (target.closest('[data-action="toggle-tray"]')) {
      trayOpen = !trayOpen;
      // In a tool mode the card opens by itself, so closing it there is a
      // one-off — only remember the choice made in ordinary modes.
      if (!modeNeedsTools(localState.mode)) trayPinned = trayOpen;
      if (currentView === 'tokens') switchView('main');
      applyTray();
      return;
    }

    if (target.closest('[data-action="screenshot"]')) {
      const btn = panel.querySelector<HTMLElement>('[data-action="screenshot"]');
      if (btn) {
        btn.style.opacity = '0.5';
        btn.style.cursor = 'default';
        btn.setAttribute('aria-busy', 'true');
      }
      const res = await withChromeHidden(() => new Promise<{ ok?: boolean; error?: string }>((resolve) => {
        chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT' }, (r) => {
          const err = chrome.runtime.lastError?.message;
          if (err) resolve({ error: err });
          else resolve((r as { ok?: boolean; error?: string }) ?? { ok: true });
        });
      }));
      if (btn) {
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        btn.removeAttribute('aria-busy');
      }
      if (res.error) {
        showErrorReport('Screenshot', res.error);
      } else {
        showToast('Screenshot saved', { type: 'success' });
      }
      return;
    }

    if (target.closest('[data-action="tokens"]')) {
      setMoreMenuOpen(false);
      switchView('tokens');
      return;
    }
    if (target.closest('[data-action="export-tokens"]')) { exportTokensJson(); return; }

    // Region capture is a toggle: click again to back out of selection mode.
    const regionBtn = target.closest('[data-action="region"]') as HTMLElement | null;
    if (regionBtn) {
      if (isRegionCaptureActive()) {
        cancelRegionCapture();
        showToast('Region capture cancelled');
      } else {
        setToolBtnActive(regionBtn, true);
        startRegionCapture(() => setToolBtnActive(regionBtn, false));
      }
      return;
    }

    if (target.closest('[data-action="clear-guides"]')) {
      setMoreMenuOpen(false);
      clearGuides();
      showToast('Guides cleared');
      return;
    }

    if (target.closest('[data-action="clear-measurements"]')) {
      setMoreMenuOpen(false);
      clearMeasurements();
      return;
    }

    if (target.closest('[data-action="clear-annotations"]')) {
      setMoreMenuOpen(false);
      clearAnnotations();
      return;
    }

    const annToolBtn = target.closest('[data-annotate-tool]') as HTMLElement | null;
    if (annToolBtn) {
      const tool = annToolBtn.dataset['annotateTool'] as AnnotateTool;
      setAnnotateTool(tool);
      const wrap = panel.querySelector<HTMLElement>('[data-annotate-tools]');
      if (wrap) updateAnnotateUi(tool);
      return;
    }

    const noteSizeBtn = target.closest('[data-note-size]') as HTMLElement | null;
    if (noteSizeBtn) {
      const id = noteSizeBtn.dataset['noteSize'] ?? '';
      setNoteSize(Number(id));
      setSegmented(panel, 'note-size', id);
      return;
    }

    const penSizeBtn = target.closest('[data-pen-size]') as HTMLElement | null;
    if (penSizeBtn) {
      const id = penSizeBtn.dataset['penSize'] ?? '';
      setPenSize(Number(id));
      setSegmented(panel, 'pen-size', id);
      return;
    }

    const noteFontBtn = target.closest('[data-note-font]') as HTMLElement | null;
    if (noteFontBtn) {
      const id = (noteFontBtn.dataset['noteFont'] ?? 'hand') as NoteFontId;
      setNoteFont(id);
      setSegmented(panel, 'note-font', id);
      return;
    }

    for (const side of ['start', 'end'] as const) {
      const endBtn = target.closest<HTMLElement>(`[data-arrow-${side}]`);
      if (!endBtn) continue;
      const kind = endBtn.getAttribute(`data-arrow-${side}`) as ArrowEnd;
      setArrowEnd(side, kind);
      setSegmented(panel, `arrow-${side}`, kind);
      return;
    }

    const markColorBtn = target.closest('[data-mark-color]') as HTMLElement | null;
    if (markColorBtn) {
      const hex = markColorBtn.dataset['markColor'];
      // The swatches follow through the change listener below.
      if (hex) setMarkColor(hex);
      return;
    }

    const placeBtn = target.closest('[data-guide-placement]') as HTMLElement | null;
    if (placeBtn) {
      const placement = placeBtn.dataset['guidePlacement'] as GuidePlacement;
      if (placement) {
        setGuidePlacement(placement);
        updateGuidePlacementUi(placement);
      }
      return;
    }

    // Mode tabs
    const modeBtn = target.closest('[data-mode]') as HTMLElement | null;
    if (modeBtn) {
      const picked = modeBtn.dataset['mode'] as Mode;
      // Pressing the tool that is already on puts it down.
      const mode: Mode = localState.active && picked === localState.mode ? 'browse' : picked;
      if (!localState.active) {
        localState = await sendMsg({ type: 'ACTIVATE', mode });
        localState.active = true;
      } else {
        // Switch immediately; the background is told afterwards and its echo is a no-op.
        switchModeLocally?.(mode);
        void sendMsg({ type: 'SWITCH_MODE', mode });
      }
      localState.mode = mode;
      updateModeOnly(mode);
      return;
    }

    // Token filter tabs
    const filterBtn = target.closest('[data-token-filter]') as HTMLElement | null;
    if (filterBtn) {
      const filter = filterBtn.dataset['tokenFilter'] as TokenFilter;
      activeTokenFilter = filter;
      updateTokenFilter(filter);
      renderTokenRows();
      return;
    }

    // Toggle switches — applied here and now. Waiting for the background's reply
    // made them lag whenever its worker had gone to sleep.
    const toggleBtn = target.closest('[data-toggle]') as HTMLElement | null;
    const setting = toggleBtn ? TOGGLES[toggleBtn.dataset['toggle'] ?? ''] : undefined;
    if (toggleBtn && setting) {
      const next = !localState[setting.key];
      localState[setting.key] = next;
      updateToggleOnly(toggleBtn.dataset['toggle']!, next);
      setting.apply(next);
      saveSetting(setting.key, next);
      markActive();
      void sendMsg({ type: setting.message, enabled: next });
    }
  });
}

// ─── Drag / position ──────────────────────────────────────────────────────────

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function defaultPanelPosition(panelW: number, _panelH: number): PanelPosition {
  return {
    left: Math.max(PANEL_INSET, Math.round((window.innerWidth - panelW) / 2)),
    top:  PANEL_INSET,
  };
}

function clampPanelPosition(left: number, top: number, w: number, h: number): PanelPosition {
  const maxL = Math.max(PANEL_MARGIN, window.innerWidth - w - PANEL_MARGIN);
  const maxT = Math.max(PANEL_MARGIN, window.innerHeight - h - PANEL_MARGIN);
  return {
    left: Math.min(Math.max(PANEL_MARGIN, left), maxL),
    top:  Math.min(Math.max(PANEL_MARGIN, top),  maxT),
  };
}

/**
 * Where the user left the toolbar, as the spot its pill rests at. The options
 * card and the tokens view make the panel taller, which can push the pill away
 * from that spot; when they close it goes back. An edge it was docked to stays
 * docked whatever the panel's size.
 */
interface PanelHome { left: number; top: number; dockRight: boolean; dockBottom: boolean }

let panelHome: PanelHome | null = null;
const DOCK_SLOP = 2;
/** Height of the toolbar pill on its own, with no card open under it. */
const PILL_HEIGHT = 40;

/** Record a resting spot the user chose, for a panel that is `w` × `h` at that moment. */
function setPanelHome(pos: PanelPosition, w: number, h: number): void {
  panelHome = {
    left: pos.left,
    top: pos.top,
    dockRight: pos.left >= window.innerWidth - w - PANEL_INSET - DOCK_SLOP,
    dockBottom: pos.top >= window.innerHeight - h - PANEL_INSET - DOCK_SLOP,
  };
}

/** Saved as the pill's own resting spot, so it means the same whatever was open when it was dropped. */
function savePanelHome(): void {
  if (!panelHome) return;
  savePanelPosition({
    left: panelHome.left,
    top: panelHome.dockBottom ? window.innerHeight - PILL_HEIGHT - PANEL_INSET : panelHome.top,
  });
}

/** Where a panel of this size belongs, given where the user left it. */
function panelRestPosition(w: number, h: number): PanelPosition | null {
  if (!panelHome) return null;
  return clampPanelPosition(
    panelHome.dockRight ? window.innerWidth - w - PANEL_INSET : panelHome.left,
    panelHome.dockBottom ? window.innerHeight - h - PANEL_INSET : panelHome.top,
    w,
    h,
  );
}

/** The panel's height once things settle: a card that is fading out no longer counts. */
function settledPanelHeight(panel: HTMLElement): number {
  const tray = panel.querySelector<HTMLElement>('[data-tray]');
  const closing = tray !== null && tray.dataset['open'] === 'false' && tray.style.display !== 'none';
  const pill = panel.querySelector<HTMLElement>('[data-main-card]');
  return closing && pill ? pill.offsetHeight : panel.offsetHeight;
}

/**
 * After the panel grows or shrinks (mode switch, options card, tokens view) or
 * the window is resized, glide to where a panel of the new size belongs.
 */
function readjustPanelForSizeChange(): void {
  if (!panelEl) return;
  const h = settledPanelHeight(panelEl);
  const target = panelRestPosition(panelEl.offsetWidth, h);
  if (!target) return;

  // Already on its way there: restarting the spring would only stall it.
  const heading = panelSpringTarget;
  if (heading && Math.abs(heading.left - target.left) <= 1 && Math.abs(heading.top - target.top) <= 1) return;

  const curL = parseFloat(panelEl.style.left);
  const curT = parseFloat(panelEl.style.top);
  if (!Number.isFinite(curL) || !Number.isFinite(curT)) {
    applyPanelPosition(panelEl, target);
    return;
  }
  if (heading || Math.abs(target.left - curL) > 1 || Math.abs(target.top - curT) > 1) {
    springPanelTo(panelEl, target, undefined, h);
  }
}

/** Wait for layout after DOM/size changes, then readjust. */
function schedulePanelReadjust(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => readjustPanelForSizeChange());
  });
}

function cornerPositions(w: number, h: number): PanelPosition[] {
  const maxL = Math.max(PANEL_MARGIN, window.innerWidth - w - PANEL_MARGIN);
  const maxT = Math.max(PANEL_MARGIN, window.innerHeight - h - PANEL_MARGIN);
  return [
    { left: PANEL_MARGIN, top: PANEL_MARGIN }, // top-left
    { left: maxL,         top: PANEL_MARGIN }, // top-right
    { left: PANEL_MARGIN, top: maxT },         // bottom-left
    { left: maxL,         top: maxT },         // bottom-right
  ];
}

function nearestCorner(left: number, top: number, w: number, h: number): { corner: PanelPosition; dist: number } {
  let best = cornerPositions(w, h)[0]!;
  let bestDist = Infinity;
  for (const c of cornerPositions(w, h)) {
    const d = Math.hypot(c.left - left, c.top - top);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return { corner: best, dist: bestDist };
}

function applyPanelPosition(panel: HTMLElement, pos: PanelPosition): void {
  const clamped = clampPanelPosition(pos.left, pos.top, panel.offsetWidth || PANEL_WIDTH, panel.offsetHeight || 48);
  panel.style.left = `${clamped.left}px`;
  panel.style.top  = `${clamped.top}px`;
  panel.style.right = 'auto';
}

/** iOS-style rubber-band: overflow past an edge resists more the further you go. */
function rubberbandOverflow(overflow: number, dimension = RUBBER_DIM, constant = RUBBER_CONSTANT): number {
  if (overflow <= 0) return 0;
  return (overflow * dimension * constant) / (dimension + constant * overflow);
}

/** Map a raw (unclamped) position into viewport with springy edge resistance. */
function rubberbandAxis(raw: number, min: number, max: number): number {
  if (raw < min) return min - rubberbandOverflow(min - raw);
  if (raw > max) return max + rubberbandOverflow(raw - max);
  return raw;
}

function rubberbandPanelPosition(left: number, top: number, w: number, h: number): PanelPosition {
  const maxL = Math.max(PANEL_MARGIN, window.innerWidth - w - PANEL_MARGIN);
  const maxT = Math.max(PANEL_MARGIN, window.innerHeight - h - PANEL_MARGIN);
  return {
    left: rubberbandAxis(left, PANEL_MARGIN, maxL),
    top:  rubberbandAxis(top, PANEL_MARGIN, maxT),
  };
}

let activePanelSpring: { cancel: () => void } | null = null;
/** Where the running spring is taking the panel. */
let panelSpringTarget: PanelPosition | null = null;

function cancelPanelSpring(): void {
  activePanelSpring?.cancel();
  activePanelSpring = null;
  panelSpringTarget = null;
}

/**
 * Physics spring to a target. Pass release velocity (px/ms) so flicks feel continuous.
 * Light underdamping = subtle springiness at edges/corners.
 */
function springPanelTo(
  panel: HTMLElement,
  target: PanelPosition,
  velocity: { vx: number; vy: number } = { vx: 0, vy: 0 },
  /** Height to keep on screen, when it is not the panel's height right now (a card is closing). */
  height = panel.offsetHeight || 48,
): void {
  cancelPanelSpring();
  clearSnapTransition(panel);

  const clamped = clampPanelPosition(target.left, target.top, panel.offsetWidth || PANEL_WIDTH, height);
  const land = (): void => {
    panel.style.left = `${clamped.left}px`;
    panel.style.top = `${clamped.top}px`;
    panel.style.right = 'auto';
  };

  if (prefersReducedMotion()) {
    land();
    return;
  }
  panelSpringTarget = clamped;

  let x = parseFloat(panel.style.left) || 0;
  let y = parseFloat(panel.style.top) || 0;
  // px/ms → px/s for integration in seconds
  let vx = velocity.vx * 1000;
  let vy = velocity.vy * 1000;
  let last = performance.now();
  let raf = 0;
  let cancelled = false;

  const tick = (now: number): void => {
    if (cancelled) return;
    const dt = Math.min(0.032, (now - last) / 1000);
    last = now;

    const ax = SPRING_STIFFNESS * (clamped.left - x) - SPRING_DAMPING * vx;
    const ay = SPRING_STIFFNESS * (clamped.top - y) - SPRING_DAMPING * vy;
    vx += ax * dt;
    vy += ay * dt;
    x += vx * dt;
    y += vy * dt;

    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
    panel.style.right = 'auto';

    const settled =
      Math.hypot(clamped.left - x, clamped.top - y) < 0.6 &&
      Math.hypot(vx, vy) < 12;

    if (settled) {
      land();
      activePanelSpring = null;
      panelSpringTarget = null;
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  activePanelSpring = {
    cancel: () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    },
  };
  raf = requestAnimationFrame(tick);
}

function clearSnapTransition(panel: HTMLElement): void {
  panel.style.transition = '';
}

/**
 * Decide free-drop vs corner snap from release position + flick velocity.
 * Soft magnet near corners; a strong flick commits to the corner in that direction.
 */
function resolveDropPosition(
  left: number,
  top: number,
  w: number,
  h: number,
  vx: number,
  vy: number,
): PanelPosition {
  const clamped = clampPanelPosition(left, top, w, h);
  const speed = Math.hypot(vx, vy);
  const { corner: nearest, dist } = nearestCorner(clamped.left, clamped.top, w, h);

  // Gentle release near a corner → magnet
  if (dist <= CORNER_MAGNET_PX) return nearest;

  // Strong flick → project ahead and snap to the corner that throw aims at
  if (speed >= CORNER_FLICK_VX) {
    const projected = clampPanelPosition(
      clamped.left + vx * 180,
      clamped.top  + vy * 180,
      w,
      h,
    );
    return nearestCorner(projected.left, projected.top, w, h).corner;
  }

  return clamped;
}

function onPanelViewportResize(): void {
  if (!panelEl) return;
  // A docked panel stays docked; a free one stays put unless the window no longer has room for it.
  readjustPanelForSizeChange();
}

function midTouch(touches: TouchList): { x: number; y: number } {
  const a = touches[0]!;
  const b = touches[1]!;
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
}

function wireDrag(panel: HTMLElement): void {
  const handle = panel.querySelector<HTMLElement>('[data-drag-handle]');
  if (!handle) return;

  type Sample = { x: number; y: number; t: number };
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;
  let samples: Sample[] = [];

  const velocity = (): { vx: number; vy: number } => {
    if (samples.length < 2) return { vx: 0, vy: 0 };
    const latest = samples[samples.length - 1]!;
    // Look back ~80ms for a stable flick reading
    let earlier = samples[0]!;
    for (let i = samples.length - 2; i >= 0; i--) {
      const s = samples[i]!;
      if (latest.t - s.t >= 80) { earlier = s; break; }
      earlier = s;
    }
    const dt = Math.max(1, latest.t - earlier.t);
    return {
      vx: (latest.x - earlier.x) / dt,
      vy: (latest.y - earlier.y) / dt,
    };
  };

  const beginDrag = (x: number, y: number): void => {
    dragging = true;
    cancelPanelSpring();
    clearSnapTransition(panel);
    const rect = panel.getBoundingClientRect();
    startX = x;
    startY = y;
    originLeft = rect.left;
    originTop  = rect.top;
    samples = [{ x, y, t: performance.now() }];
    panel.style.left = `${originLeft}px`;
    panel.style.top = `${originTop}px`;
    panel.style.right = 'auto';
    handle.style.cursor = 'grabbing';
  };

  const moveDrag = (x: number, y: number): void => {
    if (!dragging) return;
    const rawLeft = originLeft + (x - startX);
    const rawTop = originTop + (y - startY);
    const next = rubberbandPanelPosition(
      rawLeft,
      rawTop,
      panel.offsetWidth,
      panel.offsetHeight,
    );
    panel.style.left = `${next.left}px`;
    panel.style.top = `${next.top}px`;
    samples.push({ x, y, t: performance.now() });
    if (samples.length > 8) samples.shift();
  };

  const endDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    handle.style.cursor = 'grab';

    const left = parseFloat(panel.style.left);
    const top  = parseFloat(panel.style.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return;

    const { vx, vy } = velocity();
    const target = resolveDropPosition(
      left, top, panel.offsetWidth, panel.offsetHeight, vx, vy,
    );

    const needsSpring =
      Math.abs(target.left - left) > 0.5 ||
      Math.abs(target.top - top) > 0.5 ||
      Math.hypot(vx, vy) >= 0.08;

    // Wherever it is let go is where it lives from now on.
    setPanelHome(target, panel.offsetWidth, panel.offsetHeight);
    savePanelHome();
    if (needsSpring) springPanelTo(panel, target, { vx, vy });
  };

  // ── Mouse / trackpad: drag by header grip / brand ─────────────────────────
  handle.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0) return;
    // Don't start a drag from interactive controls in the header
    if ((e.target as HTMLElement).closest('button, a, input, [data-action]')) return;
    e.preventDefault();
    beginDrag(e.clientX, e.clientY);

    const onMove = (ev: MouseEvent): void => moveDrag(ev.clientX, ev.clientY);
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      endDrag();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // ── Touch: one-finger on handle, or two-finger anywhere on the panel ──────
  handle.addEventListener('touchstart', (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    if ((e.target as HTMLElement).closest('button, a, input, [data-action]')) return;
    const t = e.touches[0]!;
    beginDrag(t.clientX, t.clientY);
  }, { passive: true });

  panel.addEventListener('touchstart', (e: TouchEvent) => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const mid = midTouch(e.touches);
    beginDrag(mid.x, mid.y);
  }, { passive: false });

  panel.addEventListener('touchmove', (e: TouchEvent) => {
    if (!dragging) return;
    if (e.touches.length >= 2) {
      e.preventDefault();
      const mid = midTouch(e.touches);
      moveDrag(mid.x, mid.y);
    } else if (e.touches.length === 1) {
      const t = e.touches[0]!;
      moveDrag(t.clientX, t.clientY);
    }
  }, { passive: false });

  panel.addEventListener('touchend', (e: TouchEvent) => {
    if (!dragging) return;
    // End when fewer than the gesture requires remain
    if (e.touches.length === 0) endDrag();
  });

  panel.addEventListener('touchcancel', () => {
    if (dragging) endDrag();
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function showPanel(): Promise<void> {
  if (panelEl) return;

  localState = await sendMsg({ type: 'GET_STATE' } as Message);
  if (!localState || typeof localState !== 'object' || !('mode' in localState)) {
    localState = { ...DEFAULT_STATE };
  }
  if (!localState.active) {
    localState = await sendMsg({ type: 'ACTIVATE', mode: localState.mode });
    localState.active = true;
  }

  trayOpen = trayPinned || modeNeedsTools(localState.mode);

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.setAttribute('style', PANEL_CSS);
  panel.innerHTML = buildPanelHTML(localState);
  const trayBtn = panel.querySelector<HTMLElement>('[data-action="toggle-tray"]');
  if (trayBtn && trayOpen) { trayBtn.style.background = T.accentTint; trayBtn.style.color = T.accent; }

  // Position before paint: saved spot, or default top-center
  const saved = await loadPanelPosition();
  const initial = saved ?? defaultPanelPosition(PANEL_WIDTH, 48);
  panel.style.left = `${initial.left}px`;
  panel.style.top  = `${initial.top}px`;

  document.documentElement.appendChild(panel);
  panelEl = panel;

  // Now that the real size is known: the saved spot is the pill's, so read it as a pill-sized
  // panel, then place the panel (which may open with a card under it) where that puts it.
  const placeAtHome = (): void => {
    setPanelHome(saved ?? defaultPanelPosition(panel.offsetWidth, PILL_HEIGHT), panel.offsetWidth, PILL_HEIGHT);
    const rest = panelRestPosition(panel.offsetWidth, panel.offsetHeight);
    if (rest) applyPanelPosition(panel, rest);
  };
  placeAtHome();

  wireEvents(panel);
  wireDrag(panel);
  window.addEventListener('resize', onPanelViewportResize);

  requestAnimationFrame(() => {
    if (panelEl === panel) placeAtHome();
  });
}

export function hidePanel(): void {
  if (!panelEl) return;

  cancelPanelSpring();
  hideTooltip();
  void sendMsg({ type: 'DEACTIVATE' });

  currentView       = 'main';
  moreMenuOpen      = false;
  activeTokenFilter = 'all';

  if (onDocPointerDown) {
    document.removeEventListener('mousedown', onDocPointerDown);
    onDocPointerDown = null;
  }
  window.removeEventListener('resize', onPanelViewportResize);

  panelEl.style.animation = 'raval-panel-out 0.15s cubic-bezier(0.22, 1, 0.36, 1) forwards';
  const el = panelEl;
  panelEl = null;
  setTimeout(() => el.remove(), 160);
}

export function togglePanel(): void {
  if (panelEl) hidePanel();
  else void showPanel();
}

export function isPanelOpen(): boolean {
  return panelEl !== null;
}

export function isPanelElement(el: Element | null): boolean {
  if (!el) return false;
  return el.id === PANEL_ID || el.closest(`#${PANEL_ID}`) !== null;
}

/** Show a mode change that happened outside the toolbar (keyboard shortcut). */
export function reflectMode(mode: Mode): void {
  if (!panelEl) return;
  localState.mode = mode;
  if (currentView === 'tokens') switchView('main');
  updateModeOnly(mode);
  // A toolbar button clicked earlier still has focus, and a key press makes its focus ring
  // show: it would sit on the old tool while the highlight moves to the new one.
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && panelEl.contains(focused)) focused.blur();
}

/** Show a setting change that happened outside the toolbar (keyboard shortcut). */
export function reflectSetting(key: 'showRulers' | 'showSpacing', value: boolean): void {
  localState[key] = value;
  updateToggleOnly(key === 'showRulers' ? 'rulers' : 'spacing', value);
}

/** Close whatever is temporarily open on the toolbar. Returns false when there was nothing to close. */
export function closeTransientPanelUi(): boolean {
  if (!panelEl) return false;
  if (moreMenuOpen) { setMoreMenuOpen(false); return true; }
  if (currentView === 'tokens') { switchView('main'); return true; }
  return false;
}

// ─── Token panel compatibility API ───────────────────────────────────────────

export function showTokensView(): void {
  if (panelEl) switchView('tokens');
  else void showPanel().then(() => requestAnimationFrame(() => switchView('tokens')));
}

export function hideTokensView(): void {
  if (currentView === 'tokens') switchView('main');
}

export function toggleTokensView(): void {
  if (!panelEl) void showPanel().then(() => requestAnimationFrame(() => switchView('tokens')));
  else if (currentView === 'tokens') switchView('main');
  else switchView('tokens');
}
