// Qloo client: search + insights, with a disk cache and a rate gate.
// The hackathon key allows 5 requests/s and 10,000/month, so every response is cached by its full URL and
// requests are spaced 250 ms apart. A cached answer carries the date it was fetched, so the UI can say so.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com';
const CACHE_DIR = process.env.QLOO_CACHE_DIR || path.resolve('cache');
const TTL_MS = Number(process.env.QLOO_CACHE_DAYS || 14) * 86_400_000;
const GAP_MS = 250;

export const TYPES = {
  brand: 'urn:entity:brand', podcast: 'urn:entity:podcast', artist: 'urn:entity:artist',
  movie: 'urn:entity:movie', tv_show: 'urn:entity:tv_show', place: 'urn:entity:place',
  person: 'urn:entity:person', book: 'urn:entity:book',
};

export class QlooError extends Error {
  constructor(status, body) { super(`Qloo ${status}: ${String(body).slice(0, 200)}`); this.status = status; }
}

let last = 0, chain = Promise.resolve();
const gate = () => (chain = chain.then(async () => {
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
}));

export const stats = { calls: 0, cached: 0, monthRemaining: null };

async function get(p, params, { key = process.env.QLOO_API_KEY } = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
  qs.sort();
  const url = `${BASE}${p}?${qs}`;
  const file = path.join(CACHE_DIR, crypto.createHash('sha1').update(url).digest('hex') + '.json');
  try {
    const hit = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - Date.parse(hit.at) < TTL_MS) {
      stats.cached++;
      if (hit.status !== 200) throw new QlooError(hit.status, hit.body);
      return { ...hit.body, _fetched: hit.at, _cached: true };
    }
  } catch (e) { if (e instanceof QlooError) throw e; }
  if (!key) throw new Error('QLOO_API_KEY is not set');
  await gate();
  stats.calls++;
  const res = await fetch(url, { headers: { 'X-Api-Key': key }, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  const left = res.headers.get('x-month-ratelimit-remaining');
  if (left != null) stats.monthRemaining = Number(left);
  const at = new Date().toISOString();
  // 200s and 400s are answers (400 = "no usable signal" for that entity); 429/5xx are not cached
  if (res.status === 200 || res.status === 400) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ at, url: url.replace(BASE, ''), status: res.status, body: res.status === 200 ? JSON.parse(text) : text }));
  }
  if (res.status !== 200) throw new QlooError(res.status, text);
  return { ...JSON.parse(text), _fetched: at, _cached: false };
}

const imageOf = (p) => (typeof p?.image === 'object' ? p.image?.url : p?.image) || null;

// a compact, model- and UI-friendly view of a Qloo entity
export function slim(e) {
  const p = e.properties || {};
  return {
    id: e.entity_id,
    name: e.name,
    type: e.type || e.types?.[0] || null,
    popularity: e.popularity != null ? +e.popularity.toFixed(3) : null,
    affinity: e.query?.affinity != null ? +e.query.affinity.toFixed(3) : null,
    about: (p.short_description || p.description || '').slice(0, 220) || null,
    image: imageOf(p),
    year: p.release_year || p.inception || p.founded_year || null,
    content_rating: p.content_rating || null,
    tags: (e.tags || []).map((t) => t.name).filter(Boolean).slice(0, 5),
    explain: (e.query?.explainability?.['signal.interests.entities'] || []).map((x) => ({ id: x.entity_id, score: +x.score.toFixed(2) })),
  };
}

export async function search(query, type, take = 5) {
  const r = await get('/search', { query, take, types: TYPES[type] || type });
  return (r.results || []).map(slim);
}

// seeds = Qloo entity ids (1–3). type = output type key. opts: take, location (free text), age, popularityMax
export async function insights(seeds, type, { take = 12, location, age, popularityMax } = {}) {
  const r = await get('/v2/insights', {
    'filter.type': TYPES[type] || type,
    'signal.interests.entities': seeds.join(','),
    'feature.explainability': seeds.length > 1 ? 'true' : undefined,
    'filter.location.query': location,
    'signal.demographics.age': age,
    'filter.popularity.max': popularityMax,
    take,
  });
  return { items: (r.results?.entities || []).map(slim), fetched: r._fetched, cached: r._cached };
}
