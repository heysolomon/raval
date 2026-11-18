import Link from 'next/link';
import { DemoTrigger } from './demo-trigger';
import { ThemeToggle } from './theme-toggle';
import { CHROME_STORE_URL, GITHUB_URL } from '../lib/site';
import { formatCount, getChromeUsers, getGithubStars } from '../lib/stats';

const NAV = [
  { label: 'Use Cases', href: '/use-cases/frontend-qa' },
  { label: 'Changelog', href: '/changelog' },
] as const;

function Stat({ href, tip, label, count, children }: {
  href: string; tip: string; label: string; count: number | null; children: React.ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="site-stat lp-tip" data-tip={tip} aria-label={`${label} (opens in new tab)`}>
      {children}
      {count !== null && <span>{formatCount(count)}</span>}
    </a>
  );
}

/**
 * The header every page shares: wordmark at the start; GitHub stars, Chrome Web
 * Store users, the theme button and the demo control at the end.
 */
export async function SiteHeader({ nav = false }: { nav?: boolean }) {
  const [stars, users] = await Promise.all([getGithubStars(), getChromeUsers()]);

  return (
    <header className="site-header">
      <Link href="/" className="site-wordmark">Raval</Link>

      <div className="site-header-end">
        {nav && (
          <nav aria-label="Main" className="site-nav">
            {NAV.map(({ label, href }) => (
              <Link key={label} href={href}>{label}</Link>
            ))}
          </nav>
        )}

        <Stat
          href={GITHUB_URL} count={stars} tip="Star on GitHub"
          label={stars === null ? 'Raval on GitHub' : `${stars} ${stars === 1 ? 'star' : 'stars'} on GitHub`}
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 1.5a10.5 10.5 0 0 0-3.32 20.46c.53.1.72-.23.72-.5v-1.96c-2.92.63-3.54-1.24-3.54-1.24-.48-1.21-1.17-1.54-1.17-1.54-.95-.65.07-.64.07-.64 1.06.08 1.61 1.08 1.61 1.08.94 1.6 2.46 1.14 3.06.87.1-.68.37-1.14.67-1.4-2.33-.27-4.78-1.17-4.78-5.19 0-1.15.41-2.08 1.08-2.82-.11-.26-.47-1.33.1-2.78 0 0 .88-.28 2.89 1.08a10 10 0 0 1 5.26 0c2-1.36 2.88-1.08 2.88-1.08.58 1.45.22 2.52.11 2.78.67.74 1.08 1.67 1.08 2.82 0 4.03-2.46 4.92-4.8 5.18.38.33.72.97.72 1.96v2.9c0 .28.19.6.73.5A10.5 10.5 0 0 0 12 1.5Z" />
          </svg>
        </Stat>

        <Stat
          href={CHROME_STORE_URL} count={users} tip="Install from the Chrome Web Store"
          label={users === null ? 'Raval on the Chrome Web Store' : `${users} users on the Chrome Web Store`}
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="12" cy="12" r="9.5" />
            <circle cx="12" cy="12" r="3.8" />
            <path d="M12 8.2h8.7M8.7 13.9 4.4 6.4M15.3 13.9 11 21.4" />
          </svg>
        </Stat>

        <ThemeToggle />
        <DemoTrigger variant="icon" />
      </div>
    </header>
  );
}
