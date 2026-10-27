'use client';
import 'dialkit/vanilla/styles.css';
import { useEffect, useState } from 'react';
import { HeroDemo, HERO_TUNING, type DemoScene, type HeroTuningPatch } from './hero-demo';

/**
 * Development only: the scripted demo with a DialKit panel for tuning how it plays.
 * The panel's controls mirror HERO_TUNING in hero-demo.tsx key for key, so its
 * "Copy parameters" output (for example `"hold.gaps": 2`) names exactly the value
 * to change there. Nothing here changes what the site ships. DialKit keeps edits in
 * this browser between reloads.
 */

const SCENES: DemoScene[] = ['inspect', 'measure', 'guides', 'annotate', 'screenshot'];

type Range = [number, number, number, number];
/** A slider starting at the shipped value. */
const dial = (value: number, min: number, max: number, step: number): Range => [value, min, max, step];

const T = HERO_TUNING;

/** Laid out like HERO_TUNING, plus playback controls that are not part of it. */
function dialConfig(scenes: DemoScene[]) {
  return {
    pace: dial(T.pace, 0.3, 1.6, 0.01),
    travel: dial(T.travel, 0.4, 2, 0.05),
    typing: dial(T.typing, 10, 160, 2),
    inkStep: dial(T.inkStep, 8, 90, 1),
    hold: {
      spacing: dial(T.hold.spacing, 0, 4, 0.05),
      typography: dial(T.hold.typography, 0, 4, 0.05),
      colours: dial(T.hold.colours, 0, 4, 0.05),
      measured: dial(T.hold.measured, 0, 4, 0.05),
      unpinHover: dial(T.hold.unpinHover, 0, 4, 0.05),
      gaps: dial(T.hold.gaps, 0, 4, 0.05),
      guideHint: dial(T.hold.guideHint, 0, 4, 0.05),
      gapAfterDrag: dial(T.hold.gapAfterDrag, 0, 4, 0.05),
      callout: dial(T.hold.callout, 0, 4, 0.05),
      arrowBent: dial(T.hold.arrowBent, 0, 4, 0.05),
      noteTyped: dial(T.hold.noteTyped, 0, 4, 0.05),
      noteTurned: dial(T.hold.noteTurned, 0, 4, 0.05),
      ink: dial(T.hold.ink, 0, 4, 0.05),
      saved: dial(T.hold.saved, 0, 5, 0.05),
      _collapsed: true,
    },
    nudge: {
      tab: dial(T.nudge.tab, -2, 2, 0.05),
      caps: dial(T.nudge.caps, -2, 2, 0.05),
      badgeY: dial(T.nudge.badgeY, -2, 2, 0.02),
      badgeBX: dial(T.nudge.badgeBX, -1.5, 1.5, 0.02),
      _collapsed: true,
    },
    note: {
      x: dial(T.note.x, 380, 580, 1),
      y: dial(T.note.y, 300, 390, 1),
      size: dial(T.note.size, 10, 28, 0.5),
      tilt: dial(T.note.tilt, -15, 15, 0.5),
      turned: dial(T.note.turned, -45, 45, 0.5),
      _collapsed: true,
    },
    ink: {
      x: dial(T.ink.x, 240, 420, 1),
      y: dial(T.ink.y, 200, 330, 1),
      length: dial(T.ink.length, 10, 140, 1),
      size: dial(T.ink.size, 1, 10, 0.1),
      wave: dial(T.ink.wave, 0, 8, 0.1),
      rise: dial(T.ink.rise, -10, 10, 0.1),
      _collapsed: true,
    },
    // Playback, not tuning: which scenes play, a hold on the clock, and a fresh start.
    playback: {
      ...Object.fromEntries(SCENES.map((s) => [s, scenes.includes(s)])),
      paused: false,
      restart: { type: 'action' as const, label: 'Restart' },
    },
  };
}

type Resolved = Record<string, unknown> & { playback: Record<string, unknown> };

export function HeroTuner({ scenes }: { scenes: DemoScene[] }) {
  const [tuning, setTuning] = useState<HeroTuningPatch>({});
  const [playing, setPlaying] = useState<DemoScene[]>(scenes);
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
      const kit = createDialKit('Hero demo', dialConfig(scenes), {
        persist: { key: 'raval-hero-dials' },
        onAction: (action) => { if (action === 'playback.restart') { setPaused(false); setRun((n) => n + 1); } },
      });

      // Changes are applied a moment after the last one, so dragging a slider does not restart the script on every step.
      let timer: ReturnType<typeof setTimeout> | null = null;
      const apply = (v: Resolved): void => {
        const { playback, ...values } = v;
        setPaused(playback['paused'] === true);
        const picked = SCENES.filter((s) => playback[s] === true);
        setPlaying((prev) => (picked.length === 0 || picked.join() === prev.join() ? prev : picked));
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
    // The panel is built once; `scenes` only seeds its scene switches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <HeroDemo key={run} scenes={playing} tuning={tuning} paused={paused} />;
}
