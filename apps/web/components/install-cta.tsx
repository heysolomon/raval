'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { CHROME_STORE_URL, GITHUB_URL } from '../lib/site';

export function InstallCTA() {
  const reduceMotion = useReducedMotion();

  return (
    <section id="install" className="py-24 px-6">
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ type: 'spring', stiffness: 280, damping: 28 }}
        className="max-w-2xl mx-auto text-center rounded-2xl p-12"
        style={{
          background: 'rgba(74,158,255,0.05)',
          border: '1px solid rgba(74,158,255,0.15)',
          boxShadow: '0 0 60px rgba(74,158,255,0.06)',
        }}
      >
        <div
          className="w-14 h-14 rounded-2xl mx-auto mb-6 flex items-center justify-center"
          style={{
            background: 'rgba(74,158,255,0.12)',
            border: '1px solid rgba(74,158,255,0.25)',
          }}
        >
          <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 4v12m0 0l-4-4m4 4l4-4"
              stroke="#4A9EFF"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M4 20h16" stroke="#4A9EFF" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>

        <h2
          className="text-3xl font-semibold mb-3"
          style={{ letterSpacing: '-0.02em', color: 'rgba(255,255,255,0.92)', textWrap: 'balance' }}
        >
          Ready to measure?
        </h2>
        <p className="mb-8 text-base" style={{ color: 'rgba(255,255,255,0.5)' }}>
          Install Raval from the Chrome Web Store — it&apos;s free, open source, and takes 10
          seconds.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <a
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-7 py-3.5 rounded-xl font-semibold text-sm w-full sm:w-auto justify-center"
            style={{
              background: '#4A9EFF',
              color: '#0f0f14',
              boxShadow: '0 0 24px rgba(74,158,255,0.35)',
              transition: 'box-shadow 0.2s ease',
            }}
          >
            Add to Chrome — it&apos;s free
            <span className="sr-only"> (opens in new tab)</span>
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-7 py-3.5 rounded-xl font-medium text-sm w-full sm:w-auto justify-center site-link"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.6)',
              transition: 'background 0.2s ease, color 0.2s ease',
            }}
          >
            View on GitHub
            <span className="sr-only"> (opens in new tab)</span>
          </a>
        </div>

        <p className="mt-6 text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
          No account required · Works on any website · Manifest V3
        </p>
      </motion.div>
    </section>
  );
}
