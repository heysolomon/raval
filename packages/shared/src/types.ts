/**
 * Core types shared between the Chrome extension and companion website.
 */

/** Active tool. `browse` is no tool at all: the page works as usual while guides, pins and annotations stay on it. */
export type Mode = 'browse' | 'inspect' | 'measure' | 'guides' | 'annotate';

/** Extension activation state */
export interface ExtensionState {
  active: boolean;
  mode: Mode;
  showGuides: boolean;
  showGuideLabels: boolean;
  /** Show the distance between the guides either side of the pointer */
  showGuideGaps: boolean;
  showRulers: boolean;
  /** Inspect: tint the clicked element's padding, margin and the gaps between its children */
  showSpacing: boolean;
  snapToElements: boolean;
}

/** Bounding rectangle (mirrors DOMRect but serialisable) */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Box model spacing values */
export interface BoxModelValues {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Full box model data for a measured element */
export interface BoxModel {
  content: Rect;
  padding: BoxModelValues;
  border: BoxModelValues;
  margin: BoxModelValues;
}

/** One corner's radius: horizontal and vertical, in px */
export interface CornerRadius {
  x: number;
  y: number;
}

/** Rendered corner radii of an element, after the browser's own clamping */
export interface CornerRadii {
  topLeft: CornerRadius;
  topRight: CornerRadius;
  bottomRight: CornerRadius;
  bottomLeft: CornerRadius;
}

/** A single measurement result */
export interface MeasurementData {
  /** Width × height of the primary element */
  dimensions?: { width: number; height: number };
  /** Distance between two elements (px) */
  distance?: number;
  /** Direction of the distance measurement */
  distanceDirection?: 'horizontal' | 'vertical';
  /** Box model of the inspected element */
  boxModel?: BoxModel;
  /** Bounds of element A (measure mode) */
  elementA?: Rect;
  /** Bounds of element B (measure mode) */
  elementB?: Rect;
}

/** A draggable guide line */
export interface Guide {
  id: string;
  axis: 'horizontal' | 'vertical';
  /** Document-space position: px from page top (horizontal) or page left (vertical) */
  position: number;
}

/** Keyboard shortcut descriptor */
export interface KeyboardShortcut {
  key: string;
  modifiers?: ('ctrl' | 'shift' | 'alt' | 'meta')[];
  description: string;
  action: string;
}

export const DEFAULT_STATE: ExtensionState = {
  active: false,
  mode: 'inspect',
  showGuides: true,
  showGuideLabels: false,
  showGuideGaps: true,
  showRulers: false,
  showSpacing: false,
  snapToElements: true,
};

/** Settings remembered across sessions, and the storage key each one lives under. */
export const SETTING_STORAGE_KEYS = {
  snapToElements:  'raval_snap_to_elements',
  showRulers:      'raval_show_rulers',
  showSpacing:     'raval_show_spacing',
  showGuides:      'raval_show_guides',
  showGuideLabels: 'raval_show_guide_labels',
  showGuideGaps:   'raval_show_guide_gaps',
} as const;

export type SettingKey = keyof typeof SETTING_STORAGE_KEYS;
export type Settings = Pick<ExtensionState, SettingKey>;

/** Read saved settings out of a storage result, falling back to the defaults. */
export function settingsFromStorage(result: Record<string, unknown>): Settings {
  const out = {} as Settings;
  for (const key of Object.keys(SETTING_STORAGE_KEYS) as SettingKey[]) {
    const stored = result[SETTING_STORAGE_KEYS[key]];
    out[key] = typeof stored === 'boolean' ? stored : DEFAULT_STATE[key];
  }
  return out;
}

export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  { key: '0', description: 'Browse the page (no tool)',    action: 'SWITCH_MODE_BROWSE' },
  { key: '1', description: 'Switch to Inspect mode',       action: 'SWITCH_MODE_INSPECT' },
  { key: '2', description: 'Switch to Measure mode',       action: 'SWITCH_MODE_MEASURE' },
  { key: '3', description: 'Switch to Guides mode',        action: 'SWITCH_MODE_GUIDES' },
  { key: '4', description: 'Switch to Annotate mode',      action: 'SWITCH_MODE_ANNOTATE' },
  { key: 'd', description: 'Open design token panel',      action: 'TOGGLE_TOKEN_PANEL' },
  { key: 'c', description: 'Copy current measurement',     action: 'COPY_MEASUREMENT' },
  { key: 's', description: 'Take screenshot',              action: 'CAPTURE_SCREENSHOT' },
  { key: '?', description: 'Show all shortcuts',           action: 'TOGGLE_SHORTCUTS_PANEL' },
  { key: 'Escape', description: 'Deactivate / cancel',     action: 'DEACTIVATE' },
];
