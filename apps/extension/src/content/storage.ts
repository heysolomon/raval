/**
 * Chrome storage helpers — persist guides, panel position, and settings across sessions.
 */
import type { Guide, Settings, SettingKey } from '@raval/shared';
import { SETTING_STORAGE_KEYS, settingsFromStorage } from '@raval/shared';
import { pageId } from './page-scope';

const KEY_GUIDES_PAGE = 'raval_guides:';
/** Pre-per-page lists shared by every site. */
const KEYS_GUIDES_GLOBAL = ['raval_guides_doc', 'raval_guides'];
const KEY_PANEL_POS  = 'raval_panel_pos';

export interface PanelPosition {
  left: number;
  top: number;
}

// ─── Guides ───────────────────────────────────────────────────────────────────
// Guides belong to the page they were drawn on. Each page gets its own storage
// entry, so nothing drawn on one site or route shows up on another.

export function guidePageKey(): string {
  return `${KEY_GUIDES_PAGE}${pageId()}`;
}

export function loadGuides(pageKey: string): Promise<Guide[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get([pageKey, ...KEYS_GUIDES_GLOBAL], (result) => {
      // Older versions kept one list for every site. It cannot be attributed
      // to a page, so it is dropped rather than shown everywhere.
      if (KEYS_GUIDES_GLOBAL.some((k) => result[k] != null)) {
        void chrome.storage.local.remove(KEYS_GUIDES_GLOBAL);
      }
      const guides = result[pageKey] as Guide[] | undefined;
      resolve(Array.isArray(guides) ? guides : []);
    });
  });
}

export function saveGuides(pageKey: string, guides: Guide[]): Promise<void> {
  // No guides, no entry — pages you only visited leave nothing behind.
  if (guides.length === 0) return chrome.storage.local.remove(pageKey);
  return chrome.storage.local.set({ [pageKey]: guides });
}

// ─── Panel position ───────────────────────────────────────────────────────────

export function loadPanelPosition(): Promise<PanelPosition | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(KEY_PANEL_POS, (result) => {
      const pos = result[KEY_PANEL_POS] as PanelPosition | undefined;
      if (
        pos &&
        typeof pos.left === 'number' &&
        typeof pos.top === 'number' &&
        Number.isFinite(pos.left) &&
        Number.isFinite(pos.top)
      ) {
        resolve(pos);
      } else {
        resolve(null);
      }
    });
  });
}

export function savePanelPosition(pos: PanelPosition): void {
  void chrome.storage.local.set({ [KEY_PANEL_POS]: pos });
}

// ─── Mark colour ──────────────────────────────────────────────────────────────

const KEY_MARK_COLOR = 'raval_mark_color';

export function loadMarkColor(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(KEY_MARK_COLOR, (result) => {
      const hex = result[KEY_MARK_COLOR] as unknown;
      resolve(typeof hex === 'string' ? hex : null);
    });
  });
}

export function saveMarkColor(hex: string): void {
  void chrome.storage.local.set({ [KEY_MARK_COLOR]: hex });
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export function loadSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(Object.values(SETTING_STORAGE_KEYS), (result) => {
      resolve(settingsFromStorage(result));
    });
  });
}

export function saveSetting(key: SettingKey, value: boolean): void {
  void chrome.storage.local.set({ [SETTING_STORAGE_KEYS[key]]: value });
}
