'use client';
import 'dialkit/vanilla/styles.css';
import { useEffect, useState } from 'react';
import { HeroDemo, HERO_TUNING, type HeroTuningPatch } from './hero-demo';

/**
 * Development only: the scripted demo with a DialKit panel for tuning how it plays.
 * The panel's controls mirror HERO_TUNING in hero-demo.tsx key for key, so its
 * "Copy parameters" output (for example `"hold.measured": 2`) names exactly the value
 * to change there. Nothing here changes what the site ships. DialKit keeps edits in
 * this browser between reloads.
 */

type Range = [number, number, number, number];
/** A slider starting at the shipped value. */
const dial = (value: number, min: number, max: number, step: number): Range => [value, min, max, step];

const T = HERO_TUNING;

/** Laid out like HERO_TUNING, plus playback controls that are not part of it. */
function dialConfig() {
  return {
    pace: dial(T.pace, 0.3, 1.6, 0.01),
    travel: dial(T.travel, 0.4, 2, 0.05),
    hold: {
      sized: dial(T.hold.sized, 0, 4, 0.05),
      typography: dial(T.hold.typography, 0, 4, 0.05),
      measured: dial(T.hold.measured, 0, 4, 0.05),
      _collapsed: true,
    },
    nudge: {
      caps: dial(T.nudge.caps, -2, 2, 0.05),
      badgeY: dial(T.nudge.badgeY, -2, 2, 0.02),
      badgeBX: dial(T.nudge.badgeBX, -1.5, 1.5, 0.02),
      _collapsed: true,
    },
    // Playback, not tuning: a hold on the clock, and a fresh start.
    playback: {
      paused: false,
      restart: { type: 'action' as const, label: 'Restart' },
    },
  };
}

type Resolved = Record<string, unknown> & { playback: Record<string, unknown> };

export function HeroTuner() {
  const [tuning, setTuning] = useState<HeroTuningPatch>({});
  const [paused, setPaused] = useState(false);
  const [run, setRun] = useState(0);

  useEffect(() => {
    let teardown: (() => void) | null = null;
    let cancelled = false;
    // Loaded here rather than imported at the top, so the panel's code is only fetched when it is used.
    void import('dialkit/vanilla').then(({ createDialKit, createDialRoot }) => {
      if (cancelled) return;
      const host = document.createElement('div');
      // The live demo leaves anything marked as its own UI alone.
      host.dataset['demoUi'] = 'true';
      document.body.appendChild(host);
      const root = createDialRoot({ target: host, position: 'top-right', defaultOpen: true });
      const kit = createDialKit('Hero demo', dialConfig(), {
        persist: { key: 'raval-hero-dials' },
        onAction: (action) => { if (action === 'playback.restart') { setPaused(false); setRun((n) => n + 1); } },
      });

      // Changes are applied a moment after the last one, so dragging a slider does not restart the script on every step.
      let timer: ReturnType<typeof setTimeout> | null = null;
      const apply = (v: Resolved): void => {
        const { playback, ...values } = v;
        setPaused(playback['paused'] === true);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => setTuning(values as HeroTuningPatch), 350);
      };
      apply(kit.values as unknown as Resolved);
      const unsubscribe = kit.subscribe((v) => apply(v as unknown as Resolved));

      teardown = () => {
        if (timer) clearTimeout(timer);
        unsubscribe();
        kit.destroy();
        root.destroy();
        host.remove();
      };
    });
    return () => { cancelled = true; teardown?.(); };
  }, []);

  return <HeroDemo key={run} tuning={tuning} paused={paused} camera />;
}
