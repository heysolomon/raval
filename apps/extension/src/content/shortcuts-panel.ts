/**
 * Keyboard shortcuts reference panel — a centred glassmorphic overlay
 * toggled with the `?` key while Raval is active.
 */

import { UI } from './tokens';

const PANEL_ID = 'raval-shortcuts-panel';

// ─── Styles ───────────────────────────────────────────────────────────────────

const BACKDROP_CSS = `
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  background: rgba(0, 0, 0, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
`;

const PANEL_CSS = `
  background: ${UI.bg};
  border: 1px solid ${UI.border};
  border-radius: 14px;
  padding: 20px 22px 18px;
  box-shadow: ${UI.shadow};
  font-family: ${UI.font};
  color: ${UI.textPrimary};
  width: 380px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  box-sizing: border-box;
  pointer-events: all;
  user-select: none;
  animation: raval-shortcuts-in 0.16s ${UI.easeOut} both;
`;

const KEYFRAME_CSS = `
  @keyframes raval-shortcuts-in {
    from { opacity: 0; transform: scale(0.98) translateY(4px); }
    to   { opacity: 1; transform: scale(1)    translateY(0);   }
  }
`;

// ─── HTML builder ─────────────────────────────────────────────────────────────

function kbd(keys: string[]): string {
  return keys
    .map(
      (k) => `<span style="
        display:inline-flex;align-items:center;justify-content:center;
        background:#fafafa;border:1px solid ${UI.border};
        border-bottom-width:2px;border-radius:5px;
        padding:0 6px;min-width:22px;height:22px;box-sizing:border-box;
        font-size:11px;font-weight:500;letter-spacing:0.01em;
        color:${UI.textSecondary};font-family:inherit;line-height:1;
        white-space:nowrap;
      ">${k}</span>`,
    )
    .join(`<span style="color:${UI.textMuted};font-size:10px;margin:0 3px;">+</span>`);
}

function row(keys: string[], label: string): string {
  return `
    <div style="
      display:flex;align-items:center;justify-content:space-between;
      padding:5px 0;border-bottom:1px solid ${UI.borderSubtle};
    ">
      <span style="font-size:12px;color:${UI.textSecondary};letter-spacing:-0.01em;">${label}</span>
      <div style="display:flex;align-items:center;gap:3px;">${kbd(keys)}</div>
    </div>
  `;
}

function section(title: string, rows: string): string {
  return `
    <div style="margin-top:14px;">
      <div style="
        font-size:9px;font-weight:600;letter-spacing:0.1em;
        color:${UI.textMuted};text-transform:uppercase;
        margin-bottom:4px;
      ">${title}</div>
      ${rows}
    </div>
  `;
}

function buildHTML(): string {
  return `
    <style>${KEYFRAME_CSS}</style>

    <div style="
      display:flex;align-items:center;justify-content:space-between;
      margin-bottom:4px;
    ">
      <span style="
        font-size:11px;font-weight:600;letter-spacing:0.08em;
        color:${UI.textSecondary};text-transform:uppercase;
      ">Keyboard Shortcuts</span>
      <span style="
        font-size:10px;color:${UI.textMuted};
        border:1px solid ${UI.border};border-radius:4px;
        padding:2px 6px;letter-spacing:0.04em;
      ">Press ? to close</span>
    </div>

    ${section('Modes', `
      ${row(['⇧', '1–8'], 'Pick the colour guides, highlights and annotations are drawn in')}
      ${row(['0'], 'Browse — no tool; use the page, your marks stay')}
      ${row(['1'], 'Inspect — size, type and colours')}
      ${row(['2'], 'Measure — click two elements to compare')}
      ${row(['3'], 'Guides — crosshair + pin guide lines')}
      ${row(['4'], 'Annotate — critique UI like a notebook')}
    `)}

    ${section('Inspect Mode', `
      ${row(['Click'], 'Open details for text or an element')}
      ${row(['F'], 'Cycle colour format')}
      ${row(['B'], 'Show padding, margin and gaps of what you click')}
    `)}

    ${section('Guides Mode', `
      ${row(['C'], 'Place both H + V (cross)')}
      ${row(['H'], 'Place horizontal only')}
      ${row(['V'], 'Place vertical only')}
      ${row(['Click'], 'Pin guide(s) at cursor')}
      ${row(['Click a guide'], 'Delete it')}
      ${row(['Drag a guide'], 'Move it')}
      ${row(['⌘ / Ctrl', 'Z'], 'Undo the last guide change')}
      ${row(['Del'], 'Delete hovered guide, or clear all')}
    `)}

    ${section('Annotate', `
      ${row(['M'], 'Callout tool — click an element to mark its width and height')}
      ${row(['N'], 'Note tool — click to write')}
      ${row(['A'], 'Arrow tool — drag to draw')}
      ${row(['P'], 'Pen tool — freehand; Shift rules a straight line')}
      ${row(['Drag an arrow'], 'Ends re-aim, middle bends, body moves')}
      ${row(['⇧'], 'Hold while drawing an arrow to lock the angle')}
      ${row(['Drag a note'], 'Move it; its corner button deletes it')}
      ${row(['Drag a note\'s handle'], 'Rotate it; Shift locks to 15° steps')}
      ${row(['Enter'], 'Save the note you are writing')}
      ${row(['Esc'], 'Cancel the note you are writing')}
      ${row(['Right-click'], 'Remove one annotation')}
      ${row(['Del'], 'Clear all annotations')}
      ${row(['S'], 'Export annotated view as PNG')}
    `)}

    ${section('Canvas layers', `
      ${row(['—'], 'Guides & measurements persist across modes until cleared')}
    `)}

    ${section('General', `
      ${row(['S'], 'Capture full screenshot')}
      ${row(['?'], 'Show / hide shortcuts')}
      ${row(['Esc'], 'Close Raval')}
    `)}
  `;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function showShortcutsPanel(): void {
  if (document.getElementById(PANEL_ID)) return;

  const backdrop = document.createElement('div');
  backdrop.id = PANEL_ID;
  backdrop.setAttribute('style', BACKDROP_CSS);

  const panel = document.createElement('div');
  panel.setAttribute('style', PANEL_CSS);
  panel.innerHTML = buildHTML();

  backdrop.appendChild(panel);
  document.documentElement.appendChild(backdrop);

  // Click on backdrop (outside panel) to dismiss
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) hideShortcutsPanel();
  });
}

export function hideShortcutsPanel(): void {
  document.getElementById(PANEL_ID)?.remove();
}

export function toggleShortcutsPanel(): void {
  if (document.getElementById(PANEL_ID)) {
    hideShortcutsPanel();
  } else {
    showShortcutsPanel();
  }
}

export function isShortcutsPanelOpen(): boolean {
  return document.getElementById(PANEL_ID) !== null;
}
