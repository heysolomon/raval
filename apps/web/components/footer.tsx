import Link from 'next/link';
import { GITHUB_URL, X_URL } from '../lib/site';

const LINKS = [
  { label: 'Use Cases',    href: '/use-cases/frontend-qa' },
  { label: 'Alternatives', href: '/alternatives/page-ruler' },
  { label: 'Changelog',    href: '/changelog' },
  { label: 'Privacy',      href: '/privacy' },
  { label: 'GitHub',       href: GITHUB_URL, external: true },
  { label: 'X',            href: X_URL, external: true },
] as const;

export function Footer() {
  return (
    <footer className="site-footer">
      <span>©{new Date().getFullYear()} Raval</span>

      <nav aria-label="Footer" className="site-footer-links">
        {LINKS.map(({ label, href, ...rest }) => {
          const external = 'external' in rest && rest.external;
          return (
            <Link
              key={label}
              href={href}
              className="lp-link"
              target={external ? '_blank' : undefined}
              rel={external ? 'noopener noreferrer' : undefined}
            >
              {label}
              {external && <span className="sr-only"> (opens in new tab)</span>}
            </Link>
          );
        })}
      </nav>
    </footer>
  );
}
