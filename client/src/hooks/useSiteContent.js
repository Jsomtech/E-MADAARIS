import { useEffect, useState } from 'react';
import { apiGet } from '../api/client.js';
import { SITE_DEFAULTS } from '../content/siteDefaults.js';

let cache = null;
let inflight = null;
const listeners = new Set();

/** Deep merge so a page saved with a partial shape still renders every default field. */
function merge(base, override) {
  if (override === undefined || override === null) return base;
  if (Array.isArray(base) || Array.isArray(override)) return override;
  if (typeof base !== 'object' || typeof override !== 'object') return override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) out[key] = merge(base[key], value);
  return out;
}

function load() {
  if (cache) return Promise.resolve(cache);
  inflight = inflight || apiGet('/public/content')
    .then((body) => {
      cache = body?.data || {};
      listeners.forEach((fn) => fn(cache));
      return cache;
    })
    .catch(() => ({}))
    .finally(() => { inflight = null; });
  return inflight;
}

/** Called after the platform editor saves, so the next public render refetches. */
export function invalidateSiteContent() {
  cache = null;
  load();
}

/**
 * Public page copy: stored CMS values override the bundled defaults.
 * `stored` is false when the super admin has never saved the page, which lets the
 * pages keep their translated copy instead of showing English-only defaults.
 */
export function useSiteContent(page) {
  const [map, setMap] = useState(cache || {});

  useEffect(() => {
    let alive = true;
    const update = (next) => { if (alive) setMap({ ...next }); };
    listeners.add(update);
    load().then(update);
    return () => { alive = false; listeners.delete(update); };
  }, []);

  if (!page) return map;
  const stored = map[page] || null;
  return { content: merge(SITE_DEFAULTS[page] || {}, stored), stored: Boolean(stored) };
}
