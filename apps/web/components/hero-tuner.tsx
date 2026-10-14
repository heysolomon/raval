'use client';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { HeroDemo, HERO_TUNING, mergeTuning, type DemoScene, type HeroTuning, type HeroTuningPatch } from './hero-demo';

/**
 * Development only: the scripted demo with a panel beside it for tuning how it plays.
 * Every control edits one value of HERO_TUNING live. "Copy changes" puts what differs from
 * the shipped settings on the clipboard, to be handed over and written into hero-demo.tsx;
 * nothing here changes what the site ships. Edits are kept in this browser between reloads.
 */

const STORE = 'raval-hero-tuning';
const SCENES: DemoScene[] = ['inspect', 'measure', 'guides', 'annotate', 'screenshot'];

interface Control { path: string; label: string; min: number; max: number; step: number; unit?: string }
interface Group { title: string; note?: string; controls: Control[] }

const GROUPS: Group[] = [
  {
    title: 'Speed',
    controls: [
      { path: 'pace', label: 'Pace', min: 0.3, max: 1.6, step: 0.01, unit: '× (lower is faster)' },
      { path: 'travel', label: 'Cursor travel', min: 0.4, max: 2, step: 0.05, unit: '×' },
      { path: 'typing', label: 'Typing, per letter', min: 10, max: 160, step: 2, unit: 'ms' },
      { path: 'inkStep', label: 'Pen, per sample', min: 8, max: 90, step: 1, unit: 'ms' },
    ],
  },
  {
    title: 'Holds',
    note: 'Seconds the demo rests on each beat before moving on.',
    controls: [
      { path: 'hold.spacing', label: 'Inspect: padding bands', min: 0, max: 4, step: 0.05, unit: 's' },
      { path: 'hold.typography', label: 'Inspect: typography', min: 0, max: 4, step: 0.05, unit: 's' },
      { path: 'hold.colours', label: 'Inspect: colours', min: 0, max: 4, step: 0.05, unit: 's' },
      { path: 'hold.measured', label: 'Measure: both gaps', min: 0, max: 4, step: 0.05, unit: 's' },
      { path: 'hold.unpinHover', label: 'Measure: before unpin', min: 0, max: 4, step: 0.05, unit: 's' },
      { path: 'hold.gaps', label: 'Guides: between guides', min: 0, max: 4, step: 0.05, unit: 's' },
      { path: 'hold.guideHint', label: 'Guides: on a guide', min: 0, max: 4, step: 0.05, unit: 's' },
      { path: 'hold.gapAfterDrag', label: 'Guides: after the drag', min: 0, max: 4, step: 0.05, unit: 's' },
      { path: 'hold.callout', label: 'Annotate: callout', min: 0, max: 4, step: 0.05, unit: 's' },
      { path: 'hold.arrowBent', label: 'Annotate: arrow bent', min: 0, max: 4, step: 0.05, unit: 's' },
      { path: 'hold.noteTyped', label: 'Annotate: note typed', min: 0, max: 4, step: 0.05, unit: 's' },
      { path: 'hold.noteTurned', label: 'Annotate: note turned', min: 0, max: 4, step: 0.05, unit: 's' },
      { path: 'hold.ink', label: 'Annotate: pen stroke', min: 0, max: 4, step: 0.05, unit: 's' },
      { path: 'hold.saved', label: 'Screenshot: saved', min: 0, max: 5, step: 0.05, unit: 's' },
    ],
  },
  {
    title: 'Label centring',
    note: 'How far text is moved to sit optically centred. Stage pixels.',
    controls: [
      { path: 'nudge.tab', label: 'Tab labels, down', min: -1, max: 4, step: 0.05, unit: 'px' },
      { path: 'nudge.caps', label: 'Capitals-only tabs, down', min: -1, max: 4, step: 0.05, unit: 'px' },
      { path: 'nudge.badgeY', label: 'Badge letters, down', min: -1, max: 3, step: 0.02, unit: 'px' },
      { path: 'nudge.badgeBX', label: 'Badge B, sideways', min: -1.5, max: 1.5, step: 0.02, unit: 'px' },
    ],
  },
  {
    title: 'Note',
    controls: [
      { path: 'note.x', label: 'Left', min: 380, max: 580, step: 1, unit: 'px' },
      { path: 'note.y', label: 'Top', min: 300, max: 390, step: 1, unit: 'px' },
      { path: 'note.size', label: 'Text size', min: 10, max: 28, step: 0.5, unit: 'px' },
      { path: 'note.tilt', label: 'Lean when written', min: -15, max: 15, step: 0.5, unit: '°' },
      { path: 'note.turned', label: 'Angle after turning', min: -45, max: 45, step: 0.5, unit: '°' },
    ],
  },
  {
    title: 'Pen stroke',
    controls: [
      { path: 'ink.x', label: 'Start, left', min: 240, max: 420, step: 1, unit: 'px' },
      { path: 'ink.y', label: 'Start, top', min: 200, max: 330, step: 1, unit: 'px' },
      { path: 'ink.length', label: 'Length', min: 10, max: 140, step: 1, unit: 'px' },
      { path: 'ink.size', label: 'Width', min: 1, max: 10, step: 0.1, unit: 'px' },
      { path: 'ink.wave', label: 'Waviness', min: 0, max: 8, step: 0.1, unit: 'px' },
      { path: 'ink.rise', label: 'Rise to the right', min: -10, max: 10, step: 0.1, unit: 'px' },
    ],
  },
];

type Values = Record<string, number | Record<string, number>>;

function read(values: HeroTuning, path: string): number {
  const [a, b] = path.split('.') as [string, string | undefined];
  const top = (values as unknown as Values)[a];
  return typeof top === 'number' ? top : (top?.[b ?? ''] ?? 0);
}

function write(values: HeroTuning, path: string, value: number): HeroTuning {
  const [a, b] = path.split('.') as [string, string | undefined];
  const next = structuredClone(values) as unknown as Values;
  if (b === undefined) next[a] = value;
  else (next[a] as Record<string, number>)[b] = value;
  return next as unknown as HeroTuning;
}

/** Only what differs from the shipped settings. */
function changes(values: HeroTuning): HeroTuningPatch {
  const out: Values = {};
  for (const group of GROUPS) {
    for (const { path } of group.controls) {
      const v = read(values, path);
      if (v === read(HERO_TUNING, path)) continue;
      const [a, b] = path.split('.') as [string, string | undefined];
      if (b === undefined) out[a] = v;
      else out[a] = { ...(out[a] as Record<string, number> | undefined), [b]: v };
    }
  }
  return out as HeroTuningPatch;
}

const COPY_HEADING = 'Raval hero demo tuning: changes from the shipped settings (apps/web/components/hero-demo.tsx, HERO_TUNING)';

const FONT = `'Neue Plak Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
const MONO = `'JetBrains Mono', 'SF Mono', ui-monospace, monospace`;
const button: CSSProperties = {
  height: 26, padding: '0 10px', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 7, background: '#fff', color: '#000',
  fontFamily: 'inherit', fontSize: 11.5, fontWeight: 500, letterSpacing: 'normal', cursor: 'pointer', whiteSpace: 'nowrap',
};

export function HeroTuner({ scenes }: { scenes: DemoScene[] }) {
  const [values, setValues] = useState<HeroTuning>(HERO_TUNING);
  // What the demo is playing with. It trails the controls a little, so a slider being dragged does not restart the script on every step.
  const [applied, setApplied] = useState<HeroTuningPatch>({});
  const [playing, setPlaying] = useState<DemoScene[]>(scenes);
  const [paused, setPaused] = useState(false);
  const [run, setRun] = useState(0);
  const [open, setOpen] = useState(true);
  const [said, setSaid] = useState('');
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const loaded = useRef(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORE);
      if (saved) setValues(mergeTuning(JSON.parse(saved) as HeroTuningPatch));
    } catch { /* nothing saved, or not ours */ }
    loaded.current = true;
  }, []);

  const patch = useMemo(() => changes(values), [values]);
  const changed = JSON.stringify(patch) !== '{}';

  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => {
      setApplied(patch);
      try { window.localStorage.setItem(STORE, JSON.stringify(patch)); } catch { /* storage off */ }
    }, 350);
    return () => clearTimeout(t);
  }, [patch]);

  const say = (text: string): void => {
    setSaid(text);
    setTimeout(() => setSaid((cur) => (cur === text ? '' : cur)), 2200);
  };

  const copy = async (): Promise<void> => {
    if (!changed) { say('Nothing changed yet'); return; }
    const text = `${COPY_HEADING}\n${JSON.stringify(patch, null, 2)}`;
    try {
      await navigator.clipboard.writeText(text);
      say('Copied. Paste it to Claude.');
    } catch {
      // No clipboard access: show it in the paste box to be copied by hand.
      setPasting(true);
      setPasted(text);
      say('Could not reach the clipboard; copy it from the box');
    }
  };

  const load = (): void => {
    try {
      // Accepts a copied block, with or without its heading line.
      const json = pasted.slice(pasted.indexOf('{'));
      setValues(mergeTuning(JSON.parse(json) as HeroTuningPatch));
      setPasting(false);
      setPasted('');
      say('Settings loaded');
    } catch {
      say('That is not a copied settings block');
    }
  };

  const toggleScene = (scene: DemoScene): void => {
    setPlaying((prev) => {
      const next = prev.includes(scene) ? prev.filter((s) => s !== scene) : SCENES.filter((s) => s === scene || prev.includes(s));
      return next.length > 0 ? next : prev;
    });
  };

  return (
    <>
      <HeroDemo key={run} scenes={playing} tuning={applied} paused={paused} />

      <aside
        data-demo-ui="true"
        style={{
          // Stops short of the corner, where the site's own feedback button sits.
          position: 'fixed', top: 12, right: 12, bottom: open ? 72 : 'auto', width: 308, zIndex: 100000, display: 'flex', flexDirection: 'column',
          background: '#fff', color: '#000', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 14, boxShadow: '0 2px 6px rgba(0,0,0,0.06), 0 12px 32px rgba(0,0,0,0.12)',
          fontFamily: FONT, fontSize: 12, lineHeight: 1.35, letterSpacing: 'normal', textAlign: 'left', overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: open ? '1px solid rgba(0,0,0,0.08)' : 'none' }}>
          <strong style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>Hero demo tuning</strong>
          <span style={{ fontSize: 10.5, color: '#737373' }}>dev only</span>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} style={{ ...button, height: 22, padding: '0 8px' }}>{open ? 'Hide' : 'Show'}</button>
        </div>

        {open && (
          <>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {SCENES.map((scene) => {
                  const on = playing.includes(scene);
                  return (
                    <button
                      key={scene} type="button" aria-pressed={on} onClick={() => toggleScene(scene)}
                      style={{ ...button, height: 24, padding: '0 8px', textTransform: 'capitalize', background: on ? '#000' : '#fff', color: on ? '#fff' : '#737373', borderColor: on ? '#000' : 'rgba(0,0,0,0.12)' }}
                    >
                      {scene}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button type="button" onClick={() => setPaused((v) => !v)} aria-pressed={paused} style={{ ...button, flex: 1 }}>{paused ? 'Resume' : 'Pause'}</button>
                <button type="button" onClick={() => { setPaused(false); setRun((n) => n + 1); }} style={{ ...button, flex: 1 }}>Restart</button>
              </div>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 12px 10px' }}>
              {GROUPS.map((group) => (
                <section key={group.title} style={{ paddingTop: 10 }}>
                  <h2 style={{ margin: 0, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#737373' }}>{group.title}</h2>
                  {group.note && <p style={{ margin: '3px 0 0', fontSize: 10.5, color: '#737373' }}>{group.note}</p>}
                  {group.controls.map((c) => {
                    const value = read(values, c.path);
                    const base = read(HERO_TUNING, c.path);
                    const edited = value !== base;
                    const set = (v: number): void => { if (Number.isFinite(v)) setValues((prev) => write(prev, c.path, v)); };
                    return (
                      <div key={c.path} style={{ marginTop: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                          <label htmlFor={`tune-${c.path}`} style={{ flex: 1, fontSize: 11.5, fontWeight: edited ? 600 : 400 }}>{c.label}</label>
                          {edited && (
                            <button type="button" onClick={() => set(base)} title={`Back to ${base}`} style={{ border: 'none', background: 'none', padding: 0, color: '#FF4500', fontFamily: 'inherit', fontSize: 10.5, cursor: 'pointer' }}>
                              reset
                            </button>
                          )}
                          <input
                            type="number" value={value} min={c.min} max={c.max} step={c.step} aria-label={`${c.label}, exact value`}
                            onChange={(e) => set(e.target.valueAsNumber)}
                            style={{ width: 62, height: 22, padding: '0 5px', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 6, background: '#fff', color: '#000', fontFamily: MONO, fontSize: 11, textAlign: 'right', boxSizing: 'border-box' }}
                          />
                        </div>
                        <input
                          id={`tune-${c.path}`} type="range" value={value} min={c.min} max={c.max} step={c.step}
                          onChange={(e) => set(e.target.valueAsNumber)}
                          style={{ display: 'block', width: '100%', margin: '4px 0 0', accentColor: '#FF4500' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 9.5, color: '#A3A3A3' }}>
                          <span>{c.min}</span><span>{c.unit}</span><span>{c.max}</span>
                        </div>
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>

            <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
              {pasting && (
                <div style={{ marginBottom: 8 }}>
                  <textarea
                    value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste a copied settings block here" aria-label="Settings to load" rows={5}
                    style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: 6, border: '1px solid rgba(0,0,0,0.12)', borderRadius: 7, background: '#fff', color: '#000', fontFamily: MONO, fontSize: 10.5, resize: 'vertical' }}
                  />
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button type="button" onClick={load} style={{ ...button, flex: 1 }}>Load these</button>
                    <button type="button" onClick={() => { setPasting(false); setPasted(''); }} style={{ ...button, flex: 1 }}>Cancel</button>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => void copy()} style={{ ...button, flex: 1.4, background: '#FF4500', borderColor: '#FF4500', color: '#fff' }}>Copy changes</button>
                {!pasting && <button type="button" onClick={() => setPasting(true)} style={{ ...button, flex: 1 }}>Paste</button>}
                <button type="button" onClick={() => { setValues(HERO_TUNING); say('Back to the shipped settings'); }} disabled={!changed} style={{ ...button, flex: 1, opacity: changed ? 1 : 0.45, cursor: changed ? 'pointer' : 'default' }}>Reset all</button>
              </div>
              <div role="status" style={{ minHeight: 15, marginTop: 6, fontSize: 10.5, color: '#737373' }}>
                {said || (changed ? `${Object.keys(patch).length === 1 ? 'One group' : `${Object.keys(patch).length} groups`} changed. Saved in this browser.` : 'Matches the shipped settings.')}
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
