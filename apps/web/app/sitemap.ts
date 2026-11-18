import type { MetadataRoute } from 'next';
import { SITE_URL } from '../lib/site';

type Entry = { path: string; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']; priority: number };

// `/welcome` is left out on purpose: it is for new installs, not search.
const PAGES: Entry[] = [
  { path: '', changeFrequency: 'weekly', priority: 1 },
  { path: '/use-cases/frontend-qa', changeFrequency: 'monthly', priority: 0.85 },
  { path: '/use-cases/design-handoff', changeFrequency: 'monthly', priority: 0.85 },
  { path: '/alternatives/pixelsnap', changeFrequency: 'monthly', priority: 0.85 },
  { path: '/alternatives/page-ruler', changeFrequency: 'monthly', priority: 0.85 },
  { path: '/changelog', changeFrequency: 'weekly', priority: 0.5 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PAGES.map(({ path, changeFrequency, priority }) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
