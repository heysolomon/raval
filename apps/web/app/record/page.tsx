import type { Metadata } from 'next';
import { HeroDemo } from '../../components/hero-demo';
import { HeroTuner } from '../../components/hero-tuner';

// A bare stage for recording the homepage demo as video: 1280 × 720, the demo centred in the same
// frame and with the camera, exactly as the homepage plays it. Not linked from anywhere and not indexed.
//
//   /record?tune                 under `next dev` only: the demo with its tuning panel (see hero-tuner.tsx)
// A built site never shows the panel, and plain /record stays bare so recordings are not affected.
export const metadata: Metadata = { title: 'Demo recording', robots: { index: false, follow: false } };

export default async function RecordPage({ searchParams }: { searchParams: Promise<{ tune?: string }> }) {
  const params = await searchParams;
  const tune = process.env.NODE_ENV === 'development' && params.tune !== undefined;

  return (
    <main style={{ width: 1280, height: 720, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', overflow: 'hidden' }}>
      <div className="lp-frame lp-frame-demo" style={{ width: 1030, '--lp-line': 'var(--line)' } as React.CSSProperties}>
        {tune ? <HeroTuner /> : <HeroDemo camera />}
      </div>
    </main>
  );
}
