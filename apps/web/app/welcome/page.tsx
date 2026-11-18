import type { Metadata } from 'next';
import { FeatureTiles } from '../../components/feature-tiles';
import { Footer } from '../../components/footer';
import { SiteHeader } from '../../components/site-header';
import { GITHUB_URL } from '../../lib/site';

// The extension opens this page once, right after it is installed.
export const metadata: Metadata = {
  title: 'Raval is installed',
  description: 'Open Raval, pick a mode and try it on this page.',
  robots: { index: false, follow: false },
};

const STEPS: { title: string; text: React.ReactNode }[] = [
  {
    title: 'Pin it',
    text: <>Click the puzzle icon in your browser’s toolbar and pin Raval, so it is always one click away.</>,
  },
  {
    title: 'Open it',
    text: <>Click the Raval icon. Or press <kbd>⌥</kbd> <kbd>⇧</kbd> <kbd>C</kbd> on a Mac, <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>C</kbd> on Windows and Linux.</>,
  },
  {
    title: 'Pick a mode',
    text: <><kbd>1</kbd> Inspect, <kbd>2</kbd> Measure, <kbd>3</kbd> Guides, <kbd>4</kbd> Annotate. Press <kbd>?</kbd> for every shortcut and <kbd>Esc</kbd> to close.</>,
  },
];

const TRY: { mode: string; text: string }[] = [
  { mode: 'Inspect', text: 'Hover a tile for its size, then click a word for its font and colour.' },
  { mode: 'Measure', text: 'Click one tile, then another, to read the gap between them.' },
  { mode: 'Guides', text: 'Move near a tile’s edge and click; the guide snaps to it.' },
  { mode: 'Annotate', text: 'Draw an arrow, write a note, then press S to save a screenshot.' },
];

export default function WelcomePage() {
  return (
    <div className="lp">
      <SiteHeader nav />

      <main>
        <section className="lp-hero welcome-hero">
          <h1 className="lp-display">Raval is installed</h1>
          <div className="lp-hero-copy">
            <p>It works on any page, including this one. Open it here and try it before you take it anywhere else.</p>
          </div>
        </section>

        <section className="lp-grid" aria-label="Getting started">
          <ol className="lp-column welcome-steps">
            {STEPS.map(({ title, text }, i) => (
              <li key={title} className="lp-card">
                <span className="welcome-step-number" aria-hidden="true">{i + 1}</span>
                <div>
                  <h2>{title}</h2>
                  <p>{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="lp-grid welcome-section">
          <div className="lp-column">
            <h2 className="lp-heading">Something to practise on</h2>
            <dl className="welcome-try">
              {TRY.map(({ mode, text }) => (
                <div key={mode}>
                  <dt>{mode}</dt>
                  <dd>{text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="lp-grid welcome-practice" aria-label="Practice area">
          <div className="lp-frame lp-frame-tiles">
            <FeatureTiles />
          </div>
        </section>

        <section className="lp-grid welcome-section">
          <div className="lp-column">
            <h2 className="lp-heading">Good to know</h2>
            <div className="lp-prose">
              <p>
                Raval cannot open on the Chrome Web Store, a new tab, or your browser’s settings pages. Browsers do not
                let any extension run there.
              </p>
              <p>
                If the shortcut does nothing, another extension or the browser has taken those keys. Set your own under
                Keyboard shortcuts on your browser’s extensions page (<code>chrome://extensions/shortcuts</code> in Chrome).
                The icon always works.
              </p>
              <p>Guides are saved for each page. Measurements and annotations stay until you leave the page.</p>
              <p>It collects no data and runs entirely in your browser.</p>
              <p>
                Something not working?{' '}
                <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noopener noreferrer" className="lp-link">
                  Report a problem<span className="sr-only"> (opens in new tab)</span>
                </a>
                .
              </p>
            </div>
          </div>
        </section>
      </main>

      <div className="lp-footer">
        <Footer />
      </div>
    </div>
  );
}
