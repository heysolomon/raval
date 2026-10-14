/**
 * Background service worker
 * Handles: keyboard shortcuts, message routing, tab state management
 */
import type { Message, ExtensionState, Mode } from '@raval/shared';
import { DEFAULT_STATE, SETTING_STORAGE_KEYS, settingsFromStorage } from '@raval/shared';
import type { Settings, SettingKey } from '@raval/shared';
import { activeIconData, iconPath, ICON_SIZES } from './active-icon';

// Per-tab state
const tabState = new Map<number, ExtensionState>();

// Saved settings. Read once when the worker starts, then kept current through
// storage change events (the content script writes them, including on key presses).
let savedSettings: Partial<Settings> = {};

/**
 * Before the product was renamed, everything it saved was under a `calipers_`
 * prefix. Move it to `raval_` once, so an update does not lose anyone's guides
 * or settings. A key that already exists under the new name is left as it is.
 */
const LEGACY_STORAGE_PREFIX = 'calipers_';
const STORAGE_PREFIX = 'raval_';

async function migrateLegacyStorage(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const old = Object.keys(all).filter((key) => key.startsWith(LEGACY_STORAGE_PREFIX));
  if (old.length === 0) return;
  const moved: Record<string, unknown> = {};
  for (const key of old) {
    const next = STORAGE_PREFIX + key.slice(LEGACY_STORAGE_PREFIX.length);
    if (!(next in all)) moved[next] = all[key];
  }
  await chrome.storage.local.set(moved);
  await chrome.storage.local.remove(old);
}

// Nothing is activated until this settles, so the content script never reads before the move.
const settingsReady: Promise<void> = migrateLegacyStorage()
  .catch(() => { /* carry on with whatever is there */ })
  .then(() => chrome.storage.local.get(Object.values(SETTING_STORAGE_KEYS)))
  .then((result) => { savedSettings = settingsFromStorage(result); })
  .catch(() => { /* fall back to defaults */ });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const key of Object.keys(SETTING_STORAGE_KEYS) as SettingKey[]) {
    const change = changes[SETTING_STORAGE_KEYS[key]];
    if (!change || typeof change.newValue !== 'boolean') continue;
    savedSettings[key] = change.newValue;
    for (const [tabId, state] of tabState) tabState.set(tabId, { ...state, [key]: change.newValue });
  }
});

function getTabState(tabId: number): ExtensionState {
  return tabState.get(tabId) ?? { ...DEFAULT_STATE, ...savedSettings };
}

function setTabState(tabId: number, patch: Partial<ExtensionState>): ExtensionState {
  const current = getTabState(tabId);
  const next = { ...current, ...patch };
  tabState.set(tabId, next);
  return next;
}

/** Forward a message to the content script in the given tab */
async function sendToContent(tabId: number, message: Message): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // No receiver — callers that start Raval go through ensureContentScript first.
  }
}

/** How long to wait for a freshly injected script to answer. */
const READY_TIMEOUT_MS = 10_000;

async function contentScriptAlive(tabId: number): Promise<boolean> {
  try {
    const res = (await chrome.tabs.sendMessage(tabId, { type: 'PING' } satisfies Message)) as { ok?: boolean } | undefined;
    return res?.ok === true;
  } catch {
    return false;
  }
}

/**
 * Make sure the tab has a working content script before talking to it.
 *
 * The manifest only injects into pages loaded after the extension was installed
 * or last updated. Tabs that were already open — and every tab after an update
 * or a dev rebuild — have no script, or a dead one, so the first click on the
 * icon used to do nothing until the page was reloaded. Inject it on demand.
 */
async function ensureContentScript(tabId: number): Promise<boolean> {
  if (await contentScriptAlive(tabId)) return true;

  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];
  if (files.length === 0) return false;

  try {
    if (chrome.scripting?.executeScript) {
      await chrome.scripting.executeScript({ target: { tabId }, files });
    } else {
      // Manifest V2 (Firefox build)
      await new Promise<void>((resolve, reject) => {
        chrome.tabs.executeScript(tabId, { file: files[0] }, () => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve();
        });
      });
    }
  } catch (err) {
    // Browser pages (chrome://, the extension store, some PDF viewers) do not allow extensions.
    console.warn('[Raval] Could not inject into this tab:', err instanceof Error ? err.message : err);
    return false;
  }

  // The script registers its listener once the page's main thread gets to it.
  // On a heavy app that is still starting up that can take several seconds, so
  // keep checking rather than giving up after a moment.
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await contentScriptAlive(tabId)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.warn(`[Raval] Injected, but the page script did not respond within ${READY_TIMEOUT_MS / 1000}s.`);
  return false;
}

/** Brief badge so a click that cannot work is not met with silence. */
function flagUnavailable(tabId: number): void {
  chrome.action.setTitle({ tabId, title: 'Raval can’t run on this page' });
  chrome.action.setBadgeText({ tabId, text: '!' });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#888888' });
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), 2000);
}

/** Show whether Raval is active on a tab: a dot on the toolbar icon, not a badge. */
function updateBadge(tabId: number, active: boolean): void {
  chrome.action.setBadgeText({ tabId, text: '' });
  void (async () => {
    try {
      if (active) {
        await chrome.action.setIcon({ tabId, imageData: await activeIconData() });
      } else {
        await chrome.action.setIcon({
          tabId,
          path: Object.fromEntries(ICON_SIZES.map((size) => [size, iconPath(size)])),
        });
      }
    } catch {
      // The tab may have closed, or the icon could not be drawn — fall back to the plain badge.
      if (active) {
        chrome.action.setBadgeText({ tabId, text: '●' });
        chrome.action.setBadgeBackgroundColor({ tabId, color: '#FF4500' });
      }
    }
  })();
}

// ─── Keyboard command handler ─────────────────────────────────────────────────
// A page that shows a new user how to open Raval and lets them try it there.
const WELCOME_URL = 'https://raval.solomonakuson.com/welcome';

// Only on a first install: updates and browser restarts should not open a tab.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason !== 'install') return;
  chrome.tabs.create({ url: WELCOME_URL }).catch(() => { /* no window to open it in */ });
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-raval' || !tab?.id) return;

  const tabId = tab.id;
  if (!(await ensureContentScript(tabId))) { flagUnavailable(tabId); return; }
  await settingsReady;
  const state = getTabState(tabId);
  const newActive = !state.active;
  const next = setTabState(tabId, { active: newActive });

  updateBadge(tabId, newActive);

  const msg: Message = newActive
    ? { type: 'ACTIVATE', mode: next.mode }
    : { type: 'DEACTIVATE' };

  await sendToContent(tabId, msg);
});

// ─── Extension icon click handler (no popup) ─────────────────────────────────
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  if (!(await ensureContentScript(tab.id))) { flagUnavailable(tab.id); return; }
  // Saved data must be in place (see migrateLegacyStorage) before the page reads it.
  await settingsReady;
  await sendToContent(tab.id, { type: 'TOGGLE_PANEL' });
});

// ─── Message handler (popup → background → content) ──────────────────────────
chrome.runtime.onMessage.addListener((rawMsg: unknown, sender, sendResponse) => {
  const msg = rawMsg as Message;
  const tabId = sender.tab?.id;

  // Handle messages from popup (no sender.tab)
  if (!tabId) {
    handlePopupMessage(msg, sendResponse);
    return true; // keep channel open for async response
  }

  // Messages from content scripts
  handleContentMessage(msg, tabId, sendResponse);
  return true;
});

async function handlePopupMessage(
  msg: Message,
  sendResponse: (r: unknown) => void,
): Promise<void> {
  await settingsReady;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    sendResponse({ error: 'No active tab' });
    return;
  }
  const tabId = tab.id;

  switch (msg.type) {
    case 'GET_STATE': {
      sendResponse(getTabState(tabId));
      break;
    }
    case 'ACTIVATE': {
      const next = setTabState(tabId, { active: true, mode: msg.mode });
      updateBadge(tabId, true);
      await sendToContent(tabId, { type: 'ACTIVATE', mode: next.mode });
      sendResponse(next);
      break;
    }
    case 'DEACTIVATE': {
      const next = setTabState(tabId, { active: false });
      updateBadge(tabId, false);
      await sendToContent(tabId, { type: 'DEACTIVATE' });
      sendResponse(next);
      break;
    }
    case 'SWITCH_MODE': {
      const next = setTabState(tabId, { mode: msg.mode as Mode });
      await sendToContent(tabId, { type: 'SWITCH_MODE', mode: msg.mode as Mode });
      sendResponse(next);
      break;
    }
    case 'TOGGLE_GUIDES': {
      const next = setTabState(tabId, { showGuides: msg.enabled });
      await sendToContent(tabId, { type: 'TOGGLE_GUIDES', enabled: msg.enabled });
      sendResponse(next);
      break;
    }
    case 'TOGGLE_GUIDE_LABELS': {
      const next = setTabState(tabId, { showGuideLabels: msg.enabled });
      await sendToContent(tabId, { type: 'TOGGLE_GUIDE_LABELS', enabled: msg.enabled });
      sendResponse(next);
      break;
    }
    case 'TOGGLE_GUIDE_GAPS': {
      const next = setTabState(tabId, { showGuideGaps: msg.enabled });
      await sendToContent(tabId, { type: 'TOGGLE_GUIDE_GAPS', enabled: msg.enabled });
      sendResponse(next);
      break;
    }
    case 'TOGGLE_SNAP': {
      const next = setTabState(tabId, { snapToElements: msg.enabled });
      await sendToContent(tabId, { type: 'TOGGLE_SNAP', enabled: msg.enabled });
      sendResponse(next);
      break;
    }
    case 'TOGGLE_SPACING': {
      const next = setTabState(tabId, { showSpacing: msg.enabled });
      await sendToContent(tabId, { type: 'TOGGLE_SPACING', enabled: msg.enabled });
      sendResponse(next);
      break;
    }
    case 'TOGGLE_RULERS': {
      const next = setTabState(tabId, { showRulers: msg.enabled });
      await sendToContent(tabId, { type: 'TOGGLE_RULERS', enabled: msg.enabled });
      sendResponse(next);
      break;
    }
    case 'CAPTURE_SCREENSHOT': {
      sendResponse(await captureAndDownload(tabId));
      break;
    }
    default:
      sendResponse({ error: 'Unknown message type' });
  }
}

function captureVisible(windowId: number, opts: chrome.tabs.CaptureVisibleTabOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, opts, (url) => {
      if (chrome.runtime.lastError || !url) {
        reject(new Error(chrome.runtime.lastError?.message ?? 'Capture failed'));
        return;
      }
      resolve(url);
    });
  });
}

function downloadsAvailable(): boolean {
  return typeof chrome.downloads?.download === 'function';
}

function downloadUrl(url: string, filename: string): Promise<number> {
  return new Promise((resolve, reject) => {
    if (!downloadsAvailable()) {
      reject(new Error('chrome.downloads is unavailable (missing "downloads" permission)'));
      return;
    }
    chrome.downloads.download({ url, filename, saveAs: false }, (id) => {
      if (chrome.runtime.lastError || id === undefined) {
        reject(new Error(chrome.runtime.lastError?.message ?? 'Download failed'));
        return;
      }
      resolve(id);
    });
  });
}

/** Prefer chrome.downloads; fall back to a content-script <a download> click. */
async function saveDataUrl(tabId: number, dataUrl: string, filename: string): Promise<void> {
  if (downloadsAvailable()) {
    try {
      await downloadUrl(dataUrl, filename);
      return;
    } catch (err) {
      console.warn('[Raval] downloads API failed, falling back to content download', err);
    }
  } else {
    console.warn('[Raval] chrome.downloads missing; using content-script download fallback');
  }
  // Do not use sendToContent here — it swallows errors and would hide save failures.
  await chrome.tabs.sendMessage(tabId, {
    type: 'TRIGGER_DOWNLOAD',
    dataUrl,
    filename,
  } satisfies Message);
}

/**
 * Capture the visible tab and save via the downloads API.
 * Retina PNGs can exceed Chrome's data-URL download limit — fall back to JPEG.
 */
async function captureAndDownload(tabId: number): Promise<{ ok: true; filename: string } | { error: string }> {
  let stage = 'getTab';
  try {
    const tab = await chrome.tabs.get(tabId);
    const windowId = tab.windowId;

    stage = 'captureVisibleTab(png)';
    let dataUrl = await captureVisible(windowId, { format: 'png' });
    let filename = `raval-${Date.now()}.png`;

    // ~1.5MB string limit is a common failure point for chrome.downloads + data: URLs
    if (dataUrl.length > 1_500_000) {
      stage = 'captureVisibleTab(jpeg-fallback-size)';
      dataUrl = await captureVisible(windowId, { format: 'jpeg', quality: 92 });
      filename = `raval-${Date.now()}.jpg`;
    }

    try {
      stage = `save(${filename}, ${Math.round(dataUrl.length / 1024)}KB)`;
      await saveDataUrl(tabId, dataUrl, filename);
    } catch (downloadErr) {
      // Last resort: smaller JPEG if PNG download failed for any reason
      if (filename.endsWith('.png')) {
        stage = 'captureVisibleTab(jpeg-fallback-download)';
        dataUrl = await captureVisible(windowId, { format: 'jpeg', quality: 88 });
        filename = `raval-${Date.now()}.jpg`;
        stage = `save(${filename}, ${Math.round(dataUrl.length / 1024)}KB)`;
        await saveDataUrl(tabId, dataUrl, filename);
      } else {
        throw downloadErr;
      }
    }

    stage = 'notifyContent';
    await sendToContent(tabId, { type: 'SCREENSHOT_READY', dataUrl });
    return { ok: true, filename };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error = `[${stage}] ${message}`;
    console.error('[Raval] CAPTURE_SCREENSHOT failed:', error, err);
    return { error };
  }
}

async function handleContentMessage(
  msg: Message,
  tabId: number,
  sendResponse: (r: unknown) => void,
): Promise<void> {
  await settingsReady;
  switch (msg.type) {
    case 'GET_STATE': {
      sendResponse(getTabState(tabId));
      break;
    }
    case 'ACTIVATE': {
      const next = setTabState(tabId, { active: true, mode: msg.mode });
      updateBadge(tabId, true);
      await sendToContent(tabId, { type: 'ACTIVATE', mode: next.mode });
      sendResponse(next);
      break;
    }
    case 'DEACTIVATE': {
      const next = setTabState(tabId, { active: false });
      updateBadge(tabId, false);
      await sendToContent(tabId, { type: 'DEACTIVATE' });
      sendResponse(next);
      break;
    }
    case 'SWITCH_MODE': {
      const next = setTabState(tabId, { mode: msg.mode as Mode });
      await sendToContent(tabId, { type: 'SWITCH_MODE', mode: msg.mode as Mode });
      sendResponse(next);
      break;
    }
    case 'TOGGLE_GUIDES': {
      const next = setTabState(tabId, { showGuides: msg.enabled });
      await sendToContent(tabId, { type: 'TOGGLE_GUIDES', enabled: msg.enabled });
      sendResponse(next);
      break;
    }
    case 'TOGGLE_GUIDE_LABELS': {
      const next = setTabState(tabId, { showGuideLabels: msg.enabled });
      await sendToContent(tabId, { type: 'TOGGLE_GUIDE_LABELS', enabled: msg.enabled });
      sendResponse(next);
      break;
    }
    case 'TOGGLE_GUIDE_GAPS': {
      const next = setTabState(tabId, { showGuideGaps: msg.enabled });
      await sendToContent(tabId, { type: 'TOGGLE_GUIDE_GAPS', enabled: msg.enabled });
      sendResponse(next);
      break;
    }
    case 'TOGGLE_SNAP': {
      const next = setTabState(tabId, { snapToElements: msg.enabled });
      await sendToContent(tabId, { type: 'TOGGLE_SNAP', enabled: msg.enabled });
      sendResponse(next);
      break;
    }
    case 'TOGGLE_SPACING': {
      const next = setTabState(tabId, { showSpacing: msg.enabled });
      await sendToContent(tabId, { type: 'TOGGLE_SPACING', enabled: msg.enabled });
      sendResponse(next);
      break;
    }
    case 'TOGGLE_RULERS': {
      const next = setTabState(tabId, { showRulers: msg.enabled });
      await sendToContent(tabId, { type: 'TOGGLE_RULERS', enabled: msg.enabled });
      sendResponse(next);
      break;
    }
    case 'CAPTURE_SCREENSHOT': {
      sendResponse(await captureAndDownload(tabId));
      break;
    }
    case 'CAPTURE_VISIBLE': {
      sendResponse(await captureVisibleOnly(tabId));
      break;
    }
    case 'DOWNLOAD_DATA_URL': {
      try {
        await saveDataUrl(tabId, msg.dataUrl, msg.filename);
        sendResponse({ ok: true, filename: msg.filename });
      } catch (err) {
        sendResponse({ error: err instanceof Error ? err.message : String(err) });
      }
      break;
    }
    case 'MEASUREMENT_RESULT': {
      sendResponse({ ok: true });
      break;
    }
    default:
      sendResponse({ ok: true });
  }
}

async function captureVisibleOnly(
  tabId: number,
): Promise<{ ok: true; dataUrl: string } | { error: string }> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const dataUrl = await captureVisible(tab.windowId, { format: 'png' });
    return { ok: true, dataUrl };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Clean up state when a tab closes ────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
});

// ─── Re-activate on tab update (e.g. navigation) ────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    const state = getTabState(tabId);
    if (state.active) {
      // Page navigated while Raval was active — re-inject
      sendToContent(tabId, { type: 'ACTIVATE', mode: state.mode });
    }
  }
});
