<div align="center">

# Raval

**Precision measurement for the web.** Free, open-source Chrome extension to measure pixel distances, inspect element dimensions, and check alignment on any webpage.

![Demo](docs/assets/demo.gif)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-install-blue?style=flat-square&logo=google-chrome)](https://chromewebstore.google.com/detail/raval/anocimjcbeijomifkdcdkafdjphcdale)
[![GitHub Stars](https://img.shields.io/github/stars/heysolomon/raval?style=flat-square&color=4A9EFF)](https://github.com/heysolomon/raval/stargazers)
[![GitHub Issues](https://img.shields.io/github/issues/heysolomon/raval?style=flat-square)](https://github.com/heysolomon/raval/issues)
[![Contributors](https://img.shields.io/github/contributors/heysolomon/raval?style=flat-square)](https://github.com/heysolomon/raval/graphs/contributors)
[![XERJ Corpus Hub contributor](https://hub.xerj.org/contributors/heysolomon/badge.svg)](https://hub.xerj.org/contributors/heysolomon)

</div>

---

## What is Raval?

Raval is a free, open-source Chrome extension that lets designers and developers instantly measure distances, inspect dimensions, and check alignment on any webpage. Think PixelSnap, but for the browser — with direct DOM access for pixel-perfect accuracy.

Activate it with `⌥⇧C` (`Alt+Shift+C`), hover over any element, and immediately see its exact size. No screenshots. No switching apps.

---

## Features

- **Inspect mode** — hover over elements to see `width × height` in a floating label
- **Measure mode** — click two elements and see the pixel distance between their closest edges
- **Alignment guides** — drag horizontal and vertical guide lines anywhere on the page
- **Box model overlay** — colour-coded margin, padding, border, and content visualisation
- **Screenshot export** — capture the viewport with measurements overlaid, saved as PNG
- **Keyboard-first** — every action has a shortcut; no mouse required

---

## Install

### From the Chrome Web Store

[Install Raval for Chrome →](https://chromewebstore.google.com/detail/raval/anocimjcbeijomifkdcdkafdjphcdale)

Also available: [companion website & docs](https://raval.solomonakuson.com) · [Chrome Web Store listing copy](docs/CHROME_WEB_STORE_LISTING.md)

### From Source

```bash
# 1. Clone
git clone https://github.com/heysolomon/raval.git
cd raval

# 2. Install dependencies
pnpm install

# 3. Build the extension
pnpm build --filter=@raval/extension

# 4. Load in Chrome
#    → chrome://extensions → Enable Developer mode → Load unpacked → select apps/extension/dist/
```

---

## Development

**Prerequisites:** Node.js 18+, pnpm 8+

```bash
# Install all workspace dependencies
pnpm install

# Watch-build the extension (reloads on save)
pnpm dev --filter=@raval/extension

# Run the companion website locally
pnpm dev --filter=@raval/web

# Lint all packages
pnpm lint

# Type-check all packages
pnpm typecheck

# Production build
pnpm build
```

After running the extension dev server, load `apps/extension/dist/` as an unpacked extension in Chrome.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Extension | TypeScript, Canvas API, Chrome Manifest V3 |
| Bundler | Vite + `@crxjs/vite-plugin` |
| Website | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Animations | Framer Motion |
| Monorepo | pnpm workspaces + Turborepo |

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `⌥⇧C` / `Alt+Shift+C` | Toggle Raval on/off |
| `1` – `4` | Switch mode: Inspect, Measure, Guides, Annotate |
| `R` | Toggle rulers |
| `D` | Open design token panel |
| `F` | Cycle colour format (Inspect) |
| `S` | Take screenshot |
| `⌘Z` / `Ctrl+Z` | Undo in Measure, Guides, and Annotate |
| `?` | Show all shortcuts |
| `Esc` | Close what is open, then Raval |

---

## Contributing

Contributions of all kinds are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, branch naming conventions, commit format, and the PR process.

Good first issues are labelled [`good first issue`](https://github.com/heysolomon/raval/labels/good%20first%20issue).

---

## Roadmap

Track planned work and progress on the [GitHub Projects board](https://github.com/heysolomon/raval/projects).

---

## Community

- **Bugs & features:** [GitHub Issues](https://github.com/heysolomon/raval/issues)
- **Discussion:** [GitHub Discussions](https://github.com/heysolomon/raval/discussions)
- **Website & docs:** [raval.solomonakuson.com](https://raval.solomonakuson.com)

---

## License

[MIT](LICENSE) © Raval Contributors
