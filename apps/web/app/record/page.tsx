import type { Metadata } from 'next';
import { HeroDemo, type DemoScene } from '../../components/hero-demo';
import { HeroTuner } from '../../components/hero-tuner';

// A bare stage for recording the scripted demo as video: 1280 × 720 with the demo centred.
//   /record                      the whole script
//   /record?scenes=inspect,measure
// Not linked from anywhere and not indexed.
//
//   /record?tune                 under `next dev` only: the demo with its tuning panel (see hero-tuner.tsx)
// A built site never shows the panel, and plain /record stays bare so recordings are not affected.
export const metadata: Metadata = { title: 'Demo recording', robots: { index: false, follow: false } };

const SCENES: DemoScene[] = ['inspect', 'measure', 'guides', 'annotate', 'screenshot'];

export default async function RecordPage({ searchParams }: { searchParams: Promise<{ scenes?: string; tune?: string }> }) {
  const params = await searchParams;
  const asked = params.scenes?.split(',') ?? [];
  const tune = process.env.NODE_ENV === 'development' && params.tune !== undefined;
  const scenes = SCENES.filter((scene) => asked.includes(scene));

  return (
    <main style={{ width: 1280, height: 720, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', overflow: 'hidden' }}>
      <div style={{ width: 1030 }}>
        {tune
          ? <HeroTuner scenes={scenes.length > 0 ? scenes : SCENES} />
          : <HeroDemo scenes={scenes.length > 0 ? scenes : SCENES} />}
      </div>
    </main>
  );
}
