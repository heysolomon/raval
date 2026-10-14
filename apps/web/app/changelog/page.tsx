import type { Metadata } from 'next';
import type { JSX } from 'react';
import Link from 'next/link';
import { SiteHeader } from '../../components/site-header';
import { Footer } from '../../components/footer';
import { buildPageMetadata } from '../../components/content-page';

export const metadata: Metadata = buildPageMetadata({
  title: 'Changelog',
  description:
    'What is new in Raval, the free, open-source browser extension for measuring, inspecting and annotating webpages. Every release, newest first.',
  path: '/changelog',
});

type SectionName = 'Added' | 'Changed' | 'Fixed' | 'Removed';

type ChangelogEntry = {
  version: string;
  date: string | null;
  preRelease?: boolean;
  sections: Partial<Record<SectionName, string[]>>;
};

const SECTION_ORDER: SectionName[] = ['Added', 'Changed', 'Fixed', 'Removed'];

const entries: ChangelogEntry[] = [
  {
    version: '0.4.0',
    date: null,
    preRelease: true,
    sections: {
      Added: [
        'Inspect shows an element’s corner radius next to its size, and the outline follows its rounded corners',
        'Show spacing in Inspect (B): the padding, margin, and gaps between children of the element you click',
        'Guides measure the distance between two parallel guides when the pointer rests between them, and from a guide you point at or drag',
        'Browse: put the tool down with 0, the hand button, or by pressing the active tool again. The page works as usual and your guides and annotations stay',
        'One colour for guides, highlights, measurements, and annotations, picked in any mode’s options or with Shift+1–8',
        'Notes can be rotated with the handle above them; hold Shift for 15° steps',
        'Four handwriting fonts for notes',
        'Arrow ends: nothing, an arrowhead, a bar, or a dot at either end, so an arrow can also be a plain line',
        'The pen draws ink that thins as you move faster, in four widths. Hold Shift for a straight line; click for a dot',
      ],
      Changed: [
        'Snapping guides to page edges takes far less work, so Guides stays smooth on slower computers',
      ],
      Fixed: [
        'Keyboard shortcuts stopped working after clicking a toolbar button',
        'Clicking the page could put the cursor in a text field, after which shortcuts were typed into it',
        'After switching tools with a key, the focus ring stayed on the previous tool',
        'Guides could not be placed along the top and left edges of the window, over embedded content, or on disabled buttons',
        'The toolbar did not move back after an options card closed',
        'Undo did not reverse moving a note or an arrow',
      ],
    },
  },
  {
    version: '0.3.2',
    date: null,
    preRelease: true,
    sections: {
      Fixed: [
        'A motion tuning panel meant only for development was included in 0.3.1 by mistake. It is removed',
      ],
    },
  },
  {
    version: '0.3.1',
    date: '2026-10-08',
    sections: {
      Added: [
        'A welcome page opens after installing, with the three steps to get started and something to practise on',
      ],
      Changed: [
        'Renamed from Calipers to Raval. Your saved guides and settings carry over',
        'Notes are written straight onto the page, with no box around them',
        'The first Annotate tool is now called Callout (it was Size)',
        'The default shortcut to open Raval is Alt+Shift+C (Option+Shift+C on a Mac). The old one clashed with the browser’s own',
      ],
    },
  },
  {
    version: '0.2.0',
    date: '2026-10-06',
    sections: {
      Added: [
        'Inspect details — click text or an element for its typography, colours, and box values, each in a collapsible section',
        'Undo — Cmd/Ctrl+Z reverses changes in Measure, Guides, and Annotate',
        'Guides — click a guide to delete it, drag to move it; guides are now kept per page',
        'Toolbar — a single compact bar with options that open on demand',
        'Annotate mode — notebook-style UI critique with size callouts, notes, arrows, freehand, and PNG export',
        'Canvas layers — guides and measurements stay visible across mode switches until cleared',
        'Guide placement — choose Both, Horizontal only, or Vertical only (H / V / C)',
        'Region screenshot — drag a rectangle to capture a cropped PNG',
        'Draggable control panel — drag the header to reposition; position is saved across sessions',
        'Clear guides / measurements / annotations from the control panel in any mode',
        'Figma plugin — import Raval measurements directly into a Figma file',
        'Shareable sessions — generate a link that replays a measurement session in another browser',
        'Measurement presets — save and name common measurements (e.g. "8pt grid", "nav height")',
        'Accessibility auditing — contrast ratio checker and touch target size validator (WCAG 2.1 AA/AAA)',
        'Changelog diff mode — visually compare how element sizes changed between two page snapshots',
      ],
      Changed: [
        'Colours is now part of Inspect, and Spacing grid is removed in favour of Measure; modes are Inspect, Measure, Guides, Annotate on keys 1–4',
        'The box model overlay on the page is replaced by the Box section in Inspect details',
        'Highlights, tabs, tooltips, and notifications share one lighter design',
        'Raval redraws only while something is happening, and the cursor and labels move without forcing layout',
        'Screenshots no longer include the Raval toolbar, cursor, or notifications',
      ],
      Fixed: [
        'Clicking the extension icon now works in tabs that were open before Raval was installed or updated',
        'Number-key mode shortcuts now update the toolbar',
        'Guides no longer appear on other sites or pages',
        'Guides cleared with right-click, Del/Backspace, or Clear all now stay deleted after reopening Raval',
      ],
    },
  },
  {
    version: '0.1.0',
    date: '2026-06-24',
    sections: {
      Added: [
        'Inspect mode — hover any element to see width × height, typography, CSS path, and viewport distances',
        'Measure mode — click two or more elements to see pixel distance between closest edges',
        'Guides mode — place draggable horizontal and vertical alignment guides with snap-to-element edges',
        'Colour picker mode — sample element colours and copy as HEX, RGB, or HSL',
        'Spacing grid mode — show all gaps between sibling elements at once',
        'Box model overlay — colour-coded margin, padding, border, and content rings',
        'Ruler overlay — pixel rulers along viewport edges with cursor crosshair',
        'Design token panel — extract CSS custom properties and export as JSON',
        'Screenshot export — capture the viewport with measurements baked in',
        'Multi-element measurement — pin up to 5 elements; every consecutive pair measured simultaneously',
        'Copy-to-clipboard for all measurements and colour values',
        'Keyboard shortcuts for every mode and tool (1–5, B, D, S, ?, Esc)',
        'Floating control panel with mode switcher and per-mode toggles',
        'Persist guides and settings across sessions via chrome.storage',
        'Firefox extension build with WebExtensions API parity',
        'Companion website with interactive demo, docs, and keyboard shortcut reference',
        'Chrome Web Store listing',
      ],
      Changed: [
        'Redesigned extension panel UI with partial DOM updates for smooth transitions',
        'Migrated UI typography to self-hosted Neue Plak Text and Ashbury font families',
      ],
    },
  },
];

/** Formatted on the server in one locale and time zone, so the page and its hydration agree. */
const DATE_FORMAT = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' });

function SectionLabel({ label }: { label: string }): JSX.Element {
  return (
    <h3
      style={{
        fontSize: '16px',
        fontWeight: 500,
        color: 'var(--text)',
        marginBottom: '4px',
        marginTop: '20px',
        scrollMarginTop: '2rem',
      }}
    >
      {label}
    </h3>
  );
}

function VersionBadge(): JSX.Element {
  return (
    <span
      style={{
        fontSize: '12px',
        fontWeight: 500,
        padding: '2px 8px',
        borderRadius: '999px',
        background: 'var(--hover)',
        border: '1px solid var(--line-soft)',
        color: 'var(--text-body)',
        letterSpacing: '-0.01em',
      }}
    >
      In development
    </span>
  );
}

export default function ChangelogPage(): JSX.Element {
  return (
    <main style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <SiteHeader nav />

      <div
        style={{
          width: '100%',
          maxWidth: '744px',
          margin: '0 auto',
          padding: '56px 20px 96px',
        }}
      >
        <h1 className="page-title">
          Changelog
        </h1>
        <p
          style={{
            fontSize: '16px',
            color: 'var(--text-body)',
            lineHeight: '25.6px',
            letterSpacing: '-0.01em',
            marginBottom: '48px',
            maxWidth: '60ch',
          }}
        >
          All notable changes to Raval. Follows{' '}
          <Link
            href="https://keepachangelog.com"
            target="_blank"
            rel="noopener noreferrer"
            className="lp-link"
          >
            Keep a Changelog
          </Link>{' '}
          format.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '48px' }}>
          {entries.map((entry) => (
            <section key={entry.version}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: '10px',
                  flexWrap: 'wrap',
                  marginBottom: '4px',
                  paddingBottom: '12px',
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <h2
                  style={{
                    fontFamily: '"Ashbury", Georgia, "Times New Roman", serif',
                    fontSize: '22px',
                    fontWeight: 500,
                    lineHeight: '29.7px',
                    letterSpacing: '-0.01em',
                    color: 'var(--text)',
                  }}
                >
                  {entry.version === 'Unreleased' ? entry.version : `v${entry.version}`}
                </h2>
                {entry.date && (
                  <time
                    dateTime={entry.date}
                    style={{ fontSize: '14px', color: 'var(--text-2)' }}
                  >
                    {DATE_FORMAT.format(new Date(`${entry.date}T00:00:00Z`))}
                  </time>
                )}
                {entry.preRelease && <VersionBadge />}
              </div>

              {SECTION_ORDER.map((sectionName) => {
                const items = entry.sections[sectionName];
                if (!items?.length) return null;

                return (
                  <div key={sectionName}>
                    <SectionLabel label={sectionName} />
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                      {items.map((item) => (
                        <li
                          key={item}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '10px',
                            fontSize: '16px',
                            color: 'var(--text-body)',
                            lineHeight: '25.6px',
                            letterSpacing: '-0.01em',
                            marginBottom: '2px',
                          }}
                        >
                          <span
                            style={{
                              marginTop: '11px',
                              width: '4px',
                              height: '4px',
                              borderRadius: '50%',
                              background: 'var(--text-3)',
                              flexShrink: 0,
                            }}
                          />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>

      <Footer />
    </main>
  );
}
