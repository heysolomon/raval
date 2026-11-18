import { DemoTrigger } from '../components/demo-trigger';
import { FeatureTiles } from '../components/feature-tiles';
import { HeroDemo } from '../components/hero-demo';
import type { Metadata } from 'next';
import { Footer } from '../components/footer';
import { SiteHeader } from '../components/site-header';
import { CHROME_STORE_URL } from '../lib/site';

// The title and description come from the layout; only the homepage should claim the root address.
export const metadata: Metadata = { alternates: { canonical: '/' } };

// ─── Data ─────────────────────────────────────────────────────────────────────

/** The two things people use it for, and what each gets them. */
const USES: { name: string; use: string; text: string; points: string[] }[] = [
  {
    name: 'Check your own work',
    use: 'Design review and frontend QA',
    text: 'Compare the build with the design without opening DevTools.',
    points: ['Measure the gap between any two elements', 'Line things up with guides that snap to edges', 'Mark up what is off and screenshot it'],
  },
  {
    name: 'Study any site',
    use: 'For designers and design engineers',
    text: 'Take apart a site you admire and see how it was put together.',
    points: ['See the fonts, sizes and colours it uses', 'Read its spacing and layout at a glance', 'Pull out its design tokens as JSON'],
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <div className="lp">
      <SiteHeader />

      <main>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="lp-hero">
        <h1 className="lp-display">Measure, inspect and annotate any webpage</h1>
        <div className="lp-hero-copy">
          <p>Raval is a free, open-source browser extension for designers and developers.</p>
          <p>
            Install it for{' '}
            <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="lp-link">
              Chrome<span className="sr-only"> (opens in new tab)</span>
            </a>
            , or <DemoTrigger variant="link" /> on this page.
          </p>
        </div>
      </section>

      {/* ── Showcase ───────────────────────────────────────────────────────── */}
      <section className="lp-showcase" aria-label="How Raval works">
        <div className="lp-grid">
          <div className="lp-frame lp-frame-demo">
            <HeroDemo camera />
          </div>
        </div>
        <div className="lp-grid">
          <div className="lp-frame lp-frame-tiles">
            <FeatureTiles />
          </div>
        </div>
      </section>

      {/* ── Approach ───────────────────────────────────────────────────────── */}
      <section className="lp-grid lp-approach">
        <div className="lp-column">
          <h2 className="lp-heading">How it works</h2>
          <div className="lp-prose">
            <p>
              Raval reads the page itself, not a picture of it, so every size, gap and colour is
              the value the browser is actually using.
            </p>
            <p>
              Open it on any page and a small toolbar appears. Press <kbd>1</kbd> to <kbd>4</kbd> to
              switch between Inspect, Measure, Guides and Annotate, and <kbd>?</kbd> to see every shortcut.
            </p>
            <p>
              It is MIT licensed, collects no data and runs entirely in your browser.
            </p>
          </div>

          <div className="lp-cards">
            {USES.map(({ name, use, text, points }) => (
              <div key={name} className="lp-card">
                <div>
                  <h3>{name}</h3>
                  <p className="lp-card-use">{use}</p>
                </div>
                <p>{text}</p>
                <ul>
                  {points.map((point) => (
                    <li key={point}>
                      <img src="/icons/check.svg" alt="" width={15} height={15} loading="lazy" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="lp-closing">
            Get it on the{' '}
            <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="lp-link">
              Chrome Web Store<span className="sr-only"> (opens in new tab)</span>
            </a>
          </p>
        </div>
      </section>

      </main>

      <div className="lp-footer">
        <Footer />
      </div>
    </div>
  );
}
