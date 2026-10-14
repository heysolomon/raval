/**
 * Content script entry point.
 * Manages the extension lifecycle on the page: overlay creation/teardown,
 * mode switching, message handling, keyboard shortcuts.
 *
 * Persistent layers (guides, measurements, annotations) stay visible across
 * mode switches until the user explicitly clears them.
 */
import type { Message, Mode, ExtensionState } from '@raval/shared';
import { DEFAULT_STATE } from '@raval/shared';
import {
  createOverlay, removeOverlay, getOverlay,
  resizeCanvas, disablePointerEvents, HIDE_CURSOR_CLASS, PASS_THROUGH_CLASS,
} from './overlay';
import { clearCanvas, setShowRulers } from './renderer';
import { clearLabels } from './labels';

import {
  initInspectMode, destroyInspectMode, cycleColorFormat, closeInspectDetails, setInspectSpacing,
} from './modes/inspect';
import { initMeasureMode, destroyMeasureMode, undoMeasurement } from './modes/measure';
import {
  initGuidesMode, destroyGuidesMode,
  clearGuides, deleteHoveredGuide, undoGuideChange, setSnapEnabled, setGuidesVisible, setGuideLabelsVisible, setGuideGapsVisible,
  hydrateGuides,
} from './modes/guides';
import { initAnnotateMode, destroyAnnotateMode, clearAnnotations, undoAnnotation } from './modes/annotate';
import {
  createPersistLayer, startPersistLayer, stopPersistLayer,
  destroyPersistLayer, resizePersistLayer,
} from './persist-layer';
import { cancelRegionCapture, isRegionCaptureActive } from './region-capture';
import { toggleShortcutsPanel, hideShortcutsPanel, isShortcutsPanelOpen } from './shortcuts-panel';
import { toggleTokenPanel, hideTokenPanel } from './token-panel';
import {
  togglePanel, hidePanel, reflectMode, reflectSetting, closeTransientPanelUi, registerModeSwitcher,
} from './panel';
import { markActive } from './frame';
import { withChromeHidden } from './capture-chrome';
import { loadSettings, saveSetting } from './storage';
import { initCursor, destroyCursor, setCursorResolver, refreshCursor } from './cursor';
import { isRavalElement } from './utils';
import { MARK_COLORS, loadMarkColor, setMarkColor } from './mark-color';
import { showErrorReport, showToast } from './labels';

/**
 * The motion tuning panel (DialKit) is a tool for whoever is working on Raval, never for
 * users. It needs two things: a development build AND an explicit `pnpm dev:dials`. A plain
 * `pnpm dev` build does not show it, so a development build that gets loaded or uploaded by
 * mistake still has no panel. Production builds drop the code entirely.
 */
const DEV_DIALS = import.meta.env.MODE === 'development' && import.meta.env.VITE_DIALS === '1';

// ─── Local state ──────────────────────────────────────────────────────────────

let state: ExtensionState = { ...DEFAULT_STATE };
let activeMode: Mode | null = null;

// ─── Global click interceptor ────────────────────────────────────────────────

function onGlobalInterceptClick(e: MouseEvent): void {
  if (retireIfOrphaned()) return;
  if (isRavalElement(e.target as Element)) return;
  if (isRegionCaptureActive()) return;
  // Browsing: the page gets its clicks.
  if (activeMode === 'browse') return;
  e.preventDefault();
  e.stopPropagation();
}

/**
 * A press on the page with a tool in hand belongs to the tool. Left to the page it would move
 * keyboard focus into whatever was under it (a text field, an editor, an embedded frame), and
 * from then on Raval's single-key shortcuts would be typed into that instead of switching tools.
 * It would also start a text selection or an image drag under the tool.
 */
function onGlobalInterceptMouseDown(e: MouseEvent): void {
  if (!contextAlive()) return;
  if (isRavalElement(e.target as Element)) return;
  if (isRegionCaptureActive() || activeMode === 'browse') return;
  e.preventDefault();
  releasePageFocus();
}

/** Take keyboard focus back from a field or frame on the page, so shortcut keys reach Raval. */
function releasePageFocus(): void {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || focused === document.body || isRavalElement(focused)) return;
  const typing = focused.isContentEditable || /^(INPUT|TEXTAREA|SELECT|IFRAME|EMBED|OBJECT)$/.test(focused.tagName);
  if (typing) focused.blur();
}

// ─── Mode management ──────────────────────────────────────────────────────────

function destroyCurrentMode(): void {
  const o = getOverlay();
  if (o) {
    clearCanvas(o.ctx);
    clearLabels(o.labelContainer);
  }

  switch (activeMode) {
    case 'inspect':     destroyInspectMode();     break;
    case 'measure':     destroyMeasureMode();     break;
    case 'guides':      destroyGuidesMode();      break;
    case 'annotate':    destroyAnnotateMode();    break;
    case 'browse':      setCursorResolver(null);  break;
  }
  activeMode = null;
  disablePointerEvents();
}

function activateMode(mode: Mode): void {
  destroyCurrentMode();
  const o = getOverlay()!;
  activeMode = mode;

  switch (mode) {
    case 'inspect':     initInspectMode(o);                           break;
    case 'measure':     initMeasureMode(o);                           break;
    case 'guides':      void initGuidesMode(o, state.snapToElements); break;
    case 'annotate':    initAnnotateMode(o);                          break;
    // No tool: nothing listens to the page, and it keeps its own cursor.
    case 'browse':      setCursorResolver(() => 'native');            break;
  }
  // The pointer may not move after a key switches tool; show the new tool's cursor now.
  refreshCursor();
}

// ─── Activate / deactivate extension ─────────────────────────────────────────

async function activate(mode: Mode): Promise<void> {
  if (state.active) { switchMode(mode); return; }

  Object.assign(state, await loadSettings());
  await loadMarkColor();

  state.active = true;
  state.mode   = mode;

  const o = createOverlay();
  createPersistLayer(o.root);
  setGuidesVisible(state.showGuides);
  setGuideLabelsVisible(state.showGuideLabels);
  setGuideGapsVisible(state.showGuideGaps);
  await hydrateGuides();
  startPersistLayer();
  setShowRulers(state.showRulers);
  setInspectSpacing(state.showSpacing);
  activateMode(mode);
  initCursor();
  if (DEV_DIALS) {
    void import('./dev-dials').then((m) => m.mountDevDials());
  }
  document.addEventListener('click',   onGlobalInterceptClick, true);
  document.addEventListener('mousedown', onGlobalInterceptMouseDown, true);
  // On window, so Raval sees a key before the page's own document-level shortcuts do.
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', onResize);
}

function deactivate(): void {
  if (!state.active) return;

  hideShortcutsPanel();
  hideTokenPanel();
  cancelRegionCapture();
  destroyCurrentMode();
  stopPersistLayer();
  destroyPersistLayer();
  destroyCursor();
  if (DEV_DIALS) {
    void import('./dev-dials').then((m) => m.unmountDevDials());
  }
  removeOverlay();

  document.removeEventListener('click',   onGlobalInterceptClick, true);
  document.removeEventListener('mousedown', onGlobalInterceptMouseDown, true);
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('resize', onResize);

  state = { ...DEFAULT_STATE };
  hidePanel();
}

function switchMode(mode: Mode): void {
  if (!state.active) return;
  // Also the echo of a keyboard switch coming back from the background — nothing to redo.
  if (mode === activeMode) return;
  state.mode = mode;
  activateMode(mode);
}

// Toolbar clicks switch the mode here directly, without waiting on the background.
registerModeSwitcher((mode) => switchMode(mode));

/** Mode change that starts here (a number key) rather than from the toolbar. */
function switchModeFromKey(mode: Mode): void {
  if (!state.active || mode === activeMode) return;
  switchMode(mode);
  // The toolbar and the background's per-tab state don't know yet.
  reflectMode(mode);
  chrome.runtime.sendMessage({ type: 'SWITCH_MODE', mode } satisfies Message, () => void chrome.runtime.lastError);
}

/** `R` toggles the rulers; keep the toolbar and the saved value in step. */
function toggleRulersFromKey(): void {
  const value = !state.showRulers;
  state.showRulers = value;
  setShowRulers(value);
  saveSetting('showRulers', value);
  reflectSetting('showRulers', value);
  markActive();
  showToast(`Rulers ${value ? 'on' : 'off'}`);
}

/** `B` toggles the spacing overlay in Inspect; keep the toolbar and the saved value in step. */
function toggleSpacingFromKey(): void {
  const value = !state.showSpacing;
  state.showSpacing = value;
  setInspectSpacing(value);
  saveSetting('showSpacing', value);
  reflectSetting('showSpacing', value);
  showToast(`Spacing ${value ? 'on' : 'off'}`);
}

/** Esc closes the most recently opened thing; only when nothing is open does it close Raval. */
function dismissTopmost(): void {
  if (isShortcutsPanelOpen()) { hideShortcutsPanel(); return; }
  if (closeTransientPanelUi()) return;
  if (activeMode === 'inspect' && closeInspectDetails()) return;
  deactivate();
}

// ─── Keyboard handler ─────────────────────────────────────────────────────────

function requestScreenshot(): void {
  void withChromeHidden(
    () => new Promise<{ ok?: boolean; error?: string }>((resolve) => {
      chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT' }, (res: { ok?: boolean; error?: string } | undefined) => {
        const error = chrome.runtime.lastError?.message ?? res?.error;
        resolve(error ? { error } : { ok: true });
      });
    }),
  ).then((res) => {
    if (res.error) showErrorReport('Screenshot', res.error);
    else showToast('Screenshot saved', { type: 'success' });
  });
}

/**
 * Take a key for Raval. Many sites have their own single-key shortcuts
 * ("?" for help, digits, "s", "d"…); without this both would react.
 */
function claim(e: KeyboardEvent): void {
  e.preventDefault();
  e.stopPropagation();
}

function onKeyDown(e: KeyboardEvent): void {
  if (retireIfOrphaned()) return;
  const target = e.target as Element;
  if (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    (target as HTMLElement).isContentEditable
  ) return;

  // While browsing, the page keeps its keyboard. Only the keys that pick a tool are Raval's.
  if (activeMode === 'browse' && !/^[0-4]$/.test(e.key)) return;

  // Undo works the same in every mode that lets you place things.
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
    const undone =
      activeMode === 'guides' ? undoGuideChange() :
      activeMode === 'measure' ? undoMeasurement() :
      activeMode === 'annotate' ? undoAnnotation() : false;
    if (undone) {
      claim(e);
      if (activeMode !== 'guides') showToast('Undone');
    }
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (isRegionCaptureActive()) {
    // Region capture owns Esc; other keys ignored
    return;
  }

  // Shift+1–8 picks the colour everything is drawn in (e.code — Shift+1 is "!" on US keyboards).
  if (e.shiftKey && /^Digit[1-8]$/.test(e.code)) {
    const swatch = MARK_COLORS[Number(e.code.slice(5)) - 1];
    if (swatch) {
      claim(e);
      setMarkColor(swatch.hex);
    }
    return;
  }

  // Some keyboard layouts report Shift+/ as "/" rather than "?".
  const pressed = e.code === 'Slash' && e.shiftKey ? '?' : e.key;

  switch (pressed) {
    case '0': claim(e); switchModeFromKey('browse');   break;
    case '1': claim(e); switchModeFromKey('inspect');  break;
    case '2': claim(e); switchModeFromKey('measure');  break;
    case '3': claim(e); switchModeFromKey('guides');   break;
    case '4': claim(e); switchModeFromKey('annotate'); break;
    case 'r':
    case 'R':
      claim(e);
      toggleRulersFromKey();
      break;
    case 'd':
    case 'D':
      claim(e);
      toggleTokenPanel();
      break;
    case '?':
      claim(e);
      toggleShortcutsPanel();
      break;
    case 'Delete':
    case 'Backspace':
      if (activeMode === 'guides') {
        claim(e);
        // Over a guide, remove just that one; otherwise clear them all (both are undoable).
        if (!deleteHoveredGuide()) {
          clearGuides();
          showToast('Guides cleared');
        }
      } else if (activeMode === 'annotate') {
        claim(e);
        clearAnnotations();
      }
      break;
    case 'Escape':
      claim(e);
      dismissTopmost();
      break;
    case 's':
    case 'S':
      claim(e);
      requestScreenshot();
      break;
    case 'b':
    case 'B':
      if (activeMode === 'inspect') {
        claim(e);
        toggleSpacingFromKey();
      }
      break;
    case 'f':
    case 'F':
      if (activeMode === 'inspect') {
        claim(e);
        cycleColorFormat();
      }
      break;
  }
}

// ─── Resize handler ───────────────────────────────────────────────────────────

function onResize(): void {
  const o = getOverlay();
  if (o) resizeCanvas(o.canvas);
  resizePersistLayer();
}

// ─── Startup ──────────────────────────────────────────────────────────────────

// When the extension updates (or rebuilds in development) the previous copy of
// this script is cut off from the extension but its UI can still be in the
// page. Clear that out so a fresh start is not drawn on top of a dead one.
// The old prefix is included for a page that still holds UI from before the rename.
document.querySelectorAll('[id^="raval-"], [id^="calipers-"]').forEach((el) => el.remove());
document.documentElement.classList.remove(HIDE_CURSOR_CLASS, PASS_THROUGH_CLASS);

/** False once this copy of the script has been orphaned by an extension update. */
function contextAlive(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

/** An orphaned copy must stop intercepting the page's clicks and keys. */
function retireIfOrphaned(): boolean {
  if (contextAlive()) return false;
  try { deactivate(); } catch { /* best effort — the extension APIs are gone */ }
  document.removeEventListener('click', onGlobalInterceptClick, true);
  document.removeEventListener('mousedown', onGlobalInterceptMouseDown, true);
  window.removeEventListener('keydown', onKeyDown, true);
  return true;
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((rawMsg: unknown, _sender, sendResponse) => {
  const msg = rawMsg as Message;

  switch (msg.type) {
    case 'ACTIVATE':
      void activate(msg.mode).then(() => sendResponse({ ok: true }));
      break;
    case 'DEACTIVATE':
      deactivate();
      sendResponse({ ok: true });
      break;
    case 'SWITCH_MODE':
      switchMode(msg.mode);
      sendResponse({ ok: true });
      break;
    case 'TOGGLE_GUIDES':
      state.showGuides = msg.enabled;
      setGuidesVisible(msg.enabled);
      saveSetting('showGuides', msg.enabled);
      sendResponse({ ok: true });
      break;
    case 'TOGGLE_GUIDE_LABELS':
      state.showGuideLabels = msg.enabled;
      setGuideLabelsVisible(msg.enabled);
      saveSetting('showGuideLabels', msg.enabled);
      sendResponse({ ok: true });
      break;
    case 'TOGGLE_GUIDE_GAPS':
      state.showGuideGaps = msg.enabled;
      setGuideGapsVisible(msg.enabled);
      saveSetting('showGuideGaps', msg.enabled);
      sendResponse({ ok: true });
      break;
    case 'TOGGLE_SNAP':
      state.snapToElements = msg.enabled;
      setSnapEnabled(msg.enabled);
      saveSetting('snapToElements', msg.enabled);
      sendResponse({ ok: true });
      break;
    case 'TOGGLE_SPACING':
      state.showSpacing = msg.enabled;
      setInspectSpacing(msg.enabled);
      saveSetting('showSpacing', msg.enabled);
      sendResponse({ ok: true });
      break;
    case 'TOGGLE_RULERS':
      state.showRulers = msg.enabled;
      setShowRulers(msg.enabled);
      saveSetting('showRulers', msg.enabled);
      sendResponse({ ok: true });
      break;
    case 'TRIGGER_DOWNLOAD': {
      const a = document.createElement('a');
      a.href = msg.dataUrl;
      a.download = msg.filename;
      a.rel = 'noopener';
      (document.body ?? document.documentElement).appendChild(a);
      a.click();
      a.remove();
      sendResponse({ ok: true });
      break;
    }
    case 'SCREENSHOT_READY':
      sendResponse({ ok: true });
      break;
    case 'GET_STATE':
      sendResponse(state);
      break;
    case 'PING':
      sendResponse({ ok: true });
      break;
    case 'TOGGLE_PANEL':
      togglePanel();
      sendResponse({ ok: true });
      break;
    default:
      sendResponse({ ok: true });
  }

  return true;
});
