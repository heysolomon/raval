import { CHROME_STORE_URL, GITHUB_URL } from './site';

export type DocNavItem = {
  label: string;
  href: string;
};

export type DocNavSection = {
  section: string;
  items: DocNavItem[];
};

export const DOC_NAV: DocNavSection[] = [
  {
    section: 'Getting Started',
    items: [
      { label: 'Introduction', href: '/docs' },
      { label: 'Installation', href: '/docs/getting-started/installation' },
      { label: 'Keyboard Shortcuts', href: '/docs/getting-started/shortcuts' },
    ],
  },
  {
    section: 'Modes',
    items: [
      { label: 'Inspect Mode', href: '/docs/features/inspect-mode' },
      { label: 'Measure Mode', href: '/docs/features/measure-mode' },
      { label: 'Alignment Guides', href: '/docs/features/guides' },
      { label: 'Annotate', href: '/docs/features/annotate' },
    ],
  },
  {
    section: 'Tools',
    items: [
      { label: 'Colours & Typography', href: '/docs/features/color-picker' },
      { label: 'Box Values', href: '/docs/features/box-model' },
      { label: 'Ruler Overlay', href: '/docs/features/rulers' },
      { label: 'Design Tokens', href: '/docs/features/design-tokens' },
      { label: 'Screenshot Export', href: '/docs/features/screenshot-export' },
    ],
  },
  {
    section: 'Project',
    items: [{ label: 'Contributing', href: '/docs/contributing' }],
  },
];

export type DocPage = {
  title: string;
  description: string;
  content: string;
};

export const DOC_PAGES: Record<string, DocPage> = {
  'getting-started/installation': {
    title: 'Installation',
    description: 'Install Raval from the Chrome Web Store or build from source.',
    content: `
# Installation

Raval is available as a Chrome extension from the Web Store, or you can build it from source for Chrome and Firefox.

## Chrome Web Store

1. Visit the [Raval listing on the Chrome Web Store](${CHROME_STORE_URL}).
2. Click **Add to Chrome**.
3. Confirm the permissions prompt.
4. Activate Raval with **Option+Shift+C** (Mac) or **Alt+Shift+C** (Windows/Linux), or click the extension icon in your toolbar.

## Build from source

\`\`\`bash
git clone ${GITHUB_URL}.git
cd raval
pnpm install
pnpm build --filter=@raval/extension
\`\`\`

Then load the extension in your browser:

1. Open **chrome://extensions** (Chrome) or **about:debugging** (Firefox).
2. Enable **Developer mode** (Chrome) or click **This Firefox** (Firefox).
3. Click **Load unpacked** and select \`apps/extension/dist/\`.

For Firefox, use the dedicated build:

\`\`\`bash
pnpm build --filter=@raval/extension -- --config vite.config.firefox.ts
\`\`\`

## Browser support

| Browser | Status | Notes |
|---|---|---|
| Chrome | Supported | Manifest V3 |
| Firefox | Supported | Manifest V2 build |
| Edge | Supported | Uses Chrome Web Store build |
| Safari | Not supported | No extension API |

## Permissions

Raval requests only what it needs:

- **activeTab** — inject the overlay on the page you are viewing
- **scripting** — run measurement tools when you activate Raval
- **storage** — save guides and preferences locally
- **tabs** — capture screenshots when you press S

No data is collected or transmitted. See the [privacy policy](/privacy) for details.
    `.trim(),
  },

  'getting-started/shortcuts': {
    title: 'Keyboard Shortcuts',
    description: 'Every Raval action has a keyboard shortcut for a fast, mouse-free workflow.',
    content: `
# Keyboard Shortcuts

Raval is keyboard-first. Press **?** while Raval is active to open the in-page shortcuts panel.

## Global

| Shortcut | Action |
|---|---|
| \`Option+Shift+C\` / \`Alt+Shift+C\` | Toggle Raval on/off |
| \`1\` – \`4\` | Switch mode: Inspect, Measure, Guides, Annotate |
| \`0\` | Browse: put the tool down and use the page; guides, pins and annotations stay. Pressing the active tool's toolbar button does the same |
| \`Shift+1\` – \`Shift+8\` | Pick the colour guides, highlights, measurements and new annotations are drawn in |
| \`R\` | Toggle rulers |
| \`D\` | Open design token panel |
| \`S\` | Capture screenshot |
| \`Cmd+Z\` / \`Ctrl+Z\` | Undo the last change in Measure, Guides, or Annotate |
| \`?\` | Show / hide shortcuts panel |
| \`Esc\` | Close whatever is open; when nothing is, close Raval |

## Inspect mode

| Shortcut | Action |
|---|---|
| Hover | Outline the element or word under the cursor and show its size |
| Click | Open details: typography, colours, and box values |
| Click again | Close the details |
| \`B\` | Show padding, margin and gaps on the element you click |
| \`F\` | Cycle colour format (HEX / RGB / HSL) |

## Measure mode

| Shortcut | Action |
|---|---|
| Click | Pin an element (up to 5: A–E) |
| Click pinned element | Unpin just that element (the cursor shows a minus) |
| Click label | Copy distance to clipboard |

## Guides mode

| Shortcut | Action |
|---|---|
| Click | Pin a guide at the cursor |
| \`C\` / \`H\` / \`V\` | Place both, horizontal only, or vertical only |
| Click a guide | Delete it |
| Drag a guide | Move it |
| Pointer between two guides | Shows the distance between them |
| \`Del\` / \`Backspace\` | Delete the hovered guide, or clear all |

## Annotate mode

| Shortcut | Action |
|---|---|
| \`M\` / \`N\` / \`A\` / \`P\` | Size, Note, Arrow, or Pen tool |
| Drag a note's handle | Rotate it (\`Shift\`: 15° steps) |
| Right-click an annotation | Remove it |
| \`Del\` / \`Backspace\` | Clear all annotations |
    `.trim(),
  },

  'features/inspect-mode': {
    title: 'Inspect Mode',
    description: 'Hover to see an element’s size; click to see its typography, colours, and box values.',
    content: `
# Inspect Mode

Inspect mode is the default when you activate Raval. Hover to see what is under the cursor, click to see everything about it — without opening DevTools.

## How it works

1. Activate Raval (\`Option+Shift+C\` on Mac, \`Alt+Shift+C\` elsewhere).
2. Hover over the page. Elements are outlined and labelled with \`width × height\`; words of text are highlighted. An element with rounded corners is outlined along them and its label adds the radius, for example \`200 × 48 · R 24\`. That is the radius as rendered, so a \`9999px\` pill reads as half its height; the Box section of the details panel has the value as written.
3. Click an element or a word to open its details.
4. Click it again, click empty space, or press \`Esc\` to close the details.

## The details panel

The panel opens next to what you clicked, with the tag and size at the top and one section open at a time:

- **Typography** (when you click text) — font, size, weight, line height, and letter spacing, with a **Copy CSS** button.
- **Colours** — text, background, and border colours in HEX, RGB, or HSL. Press \`F\` to cycle the format.
- **Box** — margin, border, padding, and corner radius.

## Spacing

Turn on **Show spacing** in the options card, or press \`B\`, and the element you click is drawn with its spacing on it:

- **Padding** in green and **margin** in amber, each side labelled in px.
- For a flex or grid container, the **gaps between its children** in purple.

Clicking a word shows the spacing of the element that holds it. The setting is off by default and is remembered.

Click any value to copy it. A closed section previews its contents in its header.

## Rulers

Enable **Rulers** in the options card, or press \`R\`, to show pixel rulers along the viewport edges.
    `.trim(),
  },

  'features/measure-mode': {
    title: 'Measure Mode',
    description: 'Click elements to measure pixel distance between their closest edges. Pin up to five elements at once.',
    content: `
# Measure Mode

Measure mode lets you click elements to see the pixel distance between their closest edges, with dimension lines and labels drawn on the canvas overlay.

## How it works

1. Switch to Measure mode — press \`2\` or select **Measure** in the control panel.
2. Click the **first element** — it stays highlighted and labelled **A**.
3. Click the **second element** — the gap between them is measured and labelled **B**.
4. Keep clicking to pin up to **five elements** (A through E). Every consecutive pair is measured simultaneously.
5. Click a pinned element again to unpin just that one. Press \`Cmd+Z\` / \`Ctrl+Z\` to undo.

## Smart edge detection

Raval automatically finds the closest edges between two elements:

- Side-by-side elements → horizontal gap (right edge to left edge)
- Stacked elements → vertical gap (bottom edge to top edge)

Alignment guidelines are drawn when edges line up horizontally or vertically.

## Multi-element measurement

Pin three or more elements to compare a whole row or column at once. Each consecutive pair gets its own measurement line and label — useful for checking consistent spacing across a toolbar, card grid, or nav items.

## Copying measurements

Click any distance label to copy the value to your clipboard (e.g. \`24px\`).
    `.trim(),
  },

  'features/guides': {
    title: 'Alignment Guides',
    description: 'Place draggable horizontal and vertical guides with snap-to-element-edge support.',
    content: `
# Alignment Guides

Alignment guides are persistent horizontal and vertical lines you can place anywhere on the page to check alignment against your layout.

## Placing guides

1. Switch to Guides mode — press \`3\`.
2. Move the crosshair to the position you want.
3. Click anywhere on the page to drop a **horizontal and vertical guide** at that point. This includes the very edges of the window, embedded frames, and disabled buttons.

## Moving guides

Drag a guide to reposition it. With **Snap to elements** enabled, both the placement preview and a guide being dragged snap to nearby element edges within 8px, and to elements you have pinned in Measure or marked in Annotate. A click places the guide exactly where the preview line is showing.

## Measuring between guides

Rest the pointer between two parallel guides and the distance between them is drawn along the pointer. Between two vertical guides you get the horizontal gap, between two horizontal guides the vertical gap, and both when you are inside a box of four. Point at a guide, or drag one, to see its distance to the neighbour on each side.

Turn it off with **Measure between guides** in the options card.

## Removing guides

Hover a guide and the cursor changes to a delete mark.

- **Click** the guide to remove it.
- Press **Del** or **Backspace** over a guide to remove it, or away from one to clear all guides.
- Press \`Cmd+Z\` / \`Ctrl+Z\` to undo adding, moving, deleting, or clearing.

## Persistence

Guides belong to the page they were placed on. Each page (site and path) keeps its own guides in \`chrome.storage.local\`, so guides from one site or page never appear on another. They survive mode switches and reopening Raval.

Toggle **Show guides** in the options card to hide guides without deleting them.
    `.trim(),
  },

  'features/color-picker': {
    title: 'Colours & Typography',
    description: 'Read the colours and type settings of anything on the page from Inspect mode.',
    content: `
# Colours & Typography

Colours and typography are part of [Inspect mode](/docs/features/inspect-mode). There is no separate colour picker mode.

## How it works

1. In Inspect mode, click a word of text or an element.
2. Open the **Typography** or **Colours** section in the details panel.
3. Click any value to copy it.

## Colour formats

Switch between three formats in the Colours section, or press \`F\`:

- **HEX** — \`#4A9EFF\` or \`#4A9EFF80\` with alpha
- **RGB** — \`rgb(74, 158, 255)\` or \`rgba(74, 158, 255, 0.5)\`
- **HSL** — \`hsl(210, 100%, 65%)\`

## Typography

Clicking text shows the font, size, weight, line height, and letter spacing. **Copy CSS** copies them all as CSS declarations, including the text colour.

Values are read from \`window.getComputedStyle()\`, so they reflect what is rendered. The font shown is the first family in the CSS font stack.
    `.trim(),
  },

  // Kept so old links still land somewhere useful.
  'features/spacing-grid': {
    title: 'Spacing Grid',
    description: 'Spacing grid has been replaced by Measure mode.',
    content: `
# Spacing Grid

Spacing grid mode has been removed. [Measure mode](/docs/features/measure-mode) covers the same job: pin up to five elements and every gap between consecutive ones is measured at once.
    `.trim(),
  },

  'features/annotate': {
    title: 'Annotate',
    description: 'Mark up a page with size callouts, notes, arrows, and freehand strokes.',
    content: `
# Annotate

Annotate mode lets you mark up the page you are looking at, then capture it with a screenshot.

## Tools

Switch to Annotate mode with \`4\`, then pick a tool in the options card or by key:

- **Size** (\`M\`) — click an element to add its width and height.
- **Note** (\`N\`) — click to write a note. \`Enter\` saves it, \`Esc\` cancels. Pick the text size (S, M, L, XL) in the options card.
- **Note** fonts: four handwriting faces (Hand, Marker, Neat, Script) in the options card. They use fonts that come with macOS and Windows, so the exact face depends on the computer.
- **Arrow** (\`A\`) — drag to draw an arrow. Hold \`Shift\` to lock the angle to 15° steps. **Start** and **End** in the options card set what each end is drawn with: nothing, an arrowhead, a bar, or a dot. Nothing at both ends is a plain line.
- **Pen** (\`P\`) — draw freehand in four widths. The line thins where you move fast. Hold \`Shift\` for a straight line; click without moving for a dot.

## Editing

- **Arrows** stay editable: drag either end to re-aim it, drag the middle to bend it into a curve, or drag the line to move it.
- **Notes** can be dragged to move them; pointing at one shows a delete button on its corner and a handle above it. Drag the handle to rotate the note; hold \`Shift\` to lock to 15° steps.
- Right-click any annotation to remove it.
- \`Del\` / \`Backspace\` clears all annotations.
- \`Cmd+Z\` / \`Ctrl+Z\` undoes the last change.

Annotations stay with the page they were made on and last until the page is reloaded.
    `.trim(),
  },

  'features/box-model': {
    title: 'Box Values',
    description: 'Read the margin, border, padding, and corner radius of any element.',
    content: `
# Box Values

Box values are part of [Inspect mode](/docs/features/inspect-mode).

## How it works

1. In Inspect mode, click an element.
2. Open the **Box** section in the details panel.
3. Click a value to copy it.

Margin, border, and padding are shown in CSS shorthand order (top, right, bottom, left), shortened where sides match. Values come from \`window.getComputedStyle()\`, so they reflect the rendered layout.
    `.trim(),
  },

  'features/rulers': {
    title: 'Ruler Overlay',
    description: 'Pixel rulers along the viewport edges with a cursor crosshair.',
    content: `
# Ruler Overlay

The ruler overlay adds pixel rulers along the top and left viewport edges, with a crosshair tracking your cursor position — similar to ruler guides in design tools.

## Enabling

Toggle **Rulers** in the control panel. Rulers are available in every mode.

## What you see

- Pixel tick marks along the top and left edges of the viewport
- A horizontal and vertical crosshair line following your cursor
- A position label showing \`x, y\` coordinates

In Guides mode, the crosshair also previews where guides will be placed when you click.
    `.trim(),
  },

  'features/design-tokens': {
    title: 'Design Tokens',
    description: 'Extract CSS custom properties from the page and export as JSON.',
    content: `
# Design Tokens

The design token panel reads all CSS custom properties (\`--*\` variables) defined on the page and lets you export them as JSON.

## Opening the panel

Press \`D\` while Raval is active, or click **Tokens** in the control panel.

## What it shows

Each token displays:

- **Name** — the custom property name (e.g. \`--color-primary\`)
- **Value** — the computed value
- **Type** — colour, spacing, typography, or other (classified automatically)

## Exporting

Click **Copy JSON** to copy all tokens as a JSON object to your clipboard — ready to paste into a design system file, Figma tokens plugin, or codebase.

## Click to copy

Click any individual token row to copy that single \`name: value\` pair.
    `.trim(),
  },

  'features/screenshot-export': {
    title: 'Screenshot Export',
    description: 'Capture the visible viewport with measurements overlaid as a PNG.',
    content: `
# Screenshot Export

Export the current viewport as a PNG with all Raval measurements, guides, and overlays baked in.

## How to export

Press \`S\` while Raval is active. The extension captures the visible tab via \`chrome.tabs.captureVisibleTab()\` and triggers a download.

The file is saved as \`raval-{timestamp}.png\`.

## What is included

The screenshot includes what you have drawn — dimension labels, measurement lines, guides, annotations, and rulers. The Raval toolbar, cursor, and notifications are hidden while the capture is taken.

## Tips

- Position your measurements before exporting — the capture is instant.
- Use screenshot exports to attach spacing checks to PRs, design reviews, or bug reports.
    `.trim(),
  },

  contributing: {
    title: 'Contributing',
    description: 'Set up the dev environment and contribute to Raval.',
    content: `
# Contributing to Raval

All contributions are welcome — code, documentation, bug reports, feature requests, and design feedback.

## Dev environment

\`\`\`bash
git clone ${GITHUB_URL}.git
cd raval
pnpm install
pnpm dev --filter=@raval/extension
\`\`\`

Load \`apps/extension/dist/\` as an unpacked extension in Chrome. The dev server rebuilds on save.

To run the companion website locally:

\`\`\`bash
pnpm dev --filter=@raval/web
\`\`\`

## Project structure

- \`apps/extension/\` — Chrome/Firefox extension (Vite + TypeScript)
  - \`src/background/\` — Service worker
  - \`src/content/\` — Content script, canvas overlay, and modes
  - \`src/popup/\` — Extension popup UI
- \`apps/web/\` — Companion website (Next.js)
- \`packages/shared/\` — Types and messages shared between extension and web

## Before opening a PR

1. Create a branch: \`feat/your-feature\` or \`fix/your-bug\`
2. Run \`pnpm typecheck && pnpm lint\`
3. Open a pull request against \`main\`

See [CONTRIBUTING.md](${GITHUB_URL}/blob/main/CONTRIBUTING.md) for commit format, branch naming, and the full PR process.

## Good first issues

Look for issues labelled [good first issue](${GITHUB_URL}/labels/good%20first%20issue) on GitHub.
    `.trim(),
  },
};

export function getAllDocSlugs(): string[] {
  return Object.keys(DOC_PAGES);
}

export function getDocPage(slug: string): DocPage | undefined {
  return DOC_PAGES[slug];
}
