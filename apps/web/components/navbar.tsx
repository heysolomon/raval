'use client';
import Link from 'next/link';
import { useDemo } from './demo-provider';

const NAV = [
  { label: 'Use Cases',    href: '/use-cases/frontend-qa' },
  { label: 'Alternatives', href: '/alternatives/page-ruler' },
  { label: 'Changelog',    href: '/changelog' },
  { label: 'GitHub',       href: 'https://github.com/heysolomon/raval', external: true },
] as const;

export function Navbar() {
  const { isOpen } = useDemo();
  return (
    <header
      style={{
        position: 'fixed',
        top: isOpen ? 44 : 0,
        left: 0,
        right: 0,
        zIndex: 100,
        height: '44px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        background: '#F7F7F7',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
      }}
    >
      <Link
        href="/"
        className="site-link"
        style={{ fontSize: '13px', fontWeight: 500, color: '#000', letterSpacing: '-0.02em' }}
      >
        Raval
      </Link>

      <nav aria-label="Main" style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
        {NAV.map(({ label, href, ...rest }) => {
          const external = 'external' in rest && rest.external;
          return (
            <Link
              key={label}
              href={href}
              className="site-link"
              style={{ fontSize: '12px', color: '#737373', letterSpacing: '-0.01em' }}
              target={external ? '_blank' : undefined}
              rel={external ? 'noopener noreferrer' : undefined}
            >
              {label}
              {external && <span className="sr-only"> (opens in new tab)</span>}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
