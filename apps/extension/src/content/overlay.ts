/**
 * Overlay manager — creates and manages the canvas + DOM label container
 * that sits above the page.
 */

/** While this class is on <html>, the page's own cursors are hidden in favour of the Raval mark. */
export const HIDE_CURSOR_CLASS = 'raval-hide-cursor';
export const TEXT_CURSOR_CLASS = 'raval-text-cursor';
/** While this class is on <html>, clicks reach the page everywhere, so a guide can be placed anywhere. */
export const PASS_THROUGH_CLASS = 'raval-pass-through';

export interface OverlayElements {
  root: HTMLDivElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  labelContainer: HTMLDivElement;
}

let overlay: OverlayElements | null = null;

/** Create the overlay if not already present */
export function createOverlay(): OverlayElements {
  if (overlay) return overlay;

  const root = document.createElement('div');
  root.id = 'raval-overlay-root';
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483644',
    pointerEvents: 'none',
    overflow: 'hidden',
  });

  const canvas = document.createElement('canvas');
  canvas.id = 'raval-canvas-overlay';
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  });

  const labelContainer = document.createElement('div');
  labelContainer.id = 'raval-labels';
  Object.assign(labelContainer.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
  });

  root.appendChild(canvas);
  root.appendChild(labelContainer);

  // Rules that inline styles cannot express.
  if (!document.getElementById('raval-base-style')) {
    const base = document.createElement('style');
    base.id = 'raval-base-style';
    base.textContent = `
      /* Keyboard focus: every control drops its outline inline, so restore one for keyboard users only. */
      [id^="raval-"] button:focus-visible,
      [id^="raval-"] [tabindex]:focus-visible {
        outline: 2px solid #FF4500 !important;
        outline-offset: 1px !important;
      }
      /* Links and buttons set their own cursor, which would show next to the crosshair. */
      html.${HIDE_CURSOR_CLASS}, html.${HIDE_CURSOR_CLASS} * {
        cursor: none !important;
      }
      /* Embedded frames swallow the pointer and disabled controls never report a click. Let both
         fall through to what is behind them while something is being placed. */
      html.${PASS_THROUGH_CLASS} iframe, html.${PASS_THROUGH_CLASS} embed, html.${PASS_THROUGH_CLASS} object,
      html.${PASS_THROUGH_CLASS} :disabled {
        pointer-events: none !important;
      }
      /* Placing a note: the I-beam everywhere, not only where the page has text. */
      html.${TEXT_CURSOR_CLASS}, html.${TEXT_CURSOR_CLASS} * {
        cursor: text !important;
      }
    `;
    document.head.appendChild(base);
  }

  // Inject @font-face for Neue Plak Text so all Raval UI uses the brand font
  if (!document.getElementById('raval-fonts')) {
    const fontStyle = document.createElement('style');
    fontStyle.id = 'raval-fonts';
    const fontBase = chrome.runtime.getURL('assets/fonts');
    fontStyle.textContent = `
      @font-face {
        font-family: 'Neue Plak Text';
        src: url('${fontBase}/Neue Plak Text Light.ttf') format('truetype');
        font-weight: 300;
        font-style: normal;
        font-display: swap;
      }
      @font-face {
        font-family: 'Neue Plak Text';
        src: url('${fontBase}/Neue Plak Regular.ttf') format('truetype');
        font-weight: 400;
        font-style: normal;
        font-display: swap;
      }
      @font-face {
        font-family: 'Neue Plak Text';
        src: url('${fontBase}/Neue Plak Text SemiBold.ttf') format('truetype');
        font-weight: 600;
        font-style: normal;
        font-display: swap;
      }
      @font-face {
        font-family: 'Neue Plak Text';
        src: url('${fontBase}/Neue Plak Text Bold.ttf') format('truetype');
        font-weight: 700;
        font-style: normal;
        font-display: swap;
      }
    `;
    document.head.appendChild(fontStyle);
  }

  document.documentElement.appendChild(root);

  // Size canvas to match viewport with device pixel ratio
  resizeCanvas(canvas);
  const ctx = canvas.getContext('2d')!;

  overlay = { root, canvas, ctx, labelContainer };
  return overlay;
}

/** Remove the overlay from the DOM */
export function removeOverlay(): void {
  if (overlay) {
    overlay.root.remove();
    overlay = null;
  }
}

/** Get the current overlay, or null */
export function getOverlay(): OverlayElements | null {
  return overlay;
}

/** Resize canvas to match current viewport and DPR */
export function resizeCanvas(canvas: HTMLCanvasElement): void {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
}

/** Enable pointer events on the canvas only — root stays none so the panel is never blocked */
export function enablePointerEvents(): void {
  if (overlay) {
    overlay.canvas.style.pointerEvents = 'all';
  }
}

/** Disable pointer events — canvas passes all events through to the page */
export function disablePointerEvents(): void {
  if (overlay) {
    overlay.canvas.style.pointerEvents = 'none';
  }
}
