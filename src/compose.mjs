// Phase 3 — turn the audience data into actions, and show what a model would have said without it.
// The writer only sees ledger items and must cite them by id; any id it invents is dropped in code
// (provenance check), so every partner, podcast, artist and reference in the plan is a real Qloo result.
import { z } from 'zod';
import { llm, hasModel, WRITER_MODEL, FAST_MODEL } from './llm.mjs';
import { usable } from './safety.mjs';

const planSchema = z.object({
  audience_read: z.string().describe('2–3 sentences: who this audience is, inferred only from the listed items; name 2–3 of them'),
  partners: z.array(z.object({
    id: z.string(), why: z.string().describe('one sentence, plain'),
    outreach: z.object({ subject: z.string(), body: z.string().describe('max 110 words, first person from the business owner, cites the shared-audience evidence in plain words, ends with one concrete ask, signs off [Your name]') }),
  })).describe('3 brands to co-market with — not direct competitors'),
  podcasts: z.array(z.object({ id: z.string(), angle: z.string().describe('the ad or guest angle, one sentence') })).describe('4 podcasts for an ad read or a guest spot'),
  playlist: z.object({ title: z.string(), artist_ids: z.array(z.string()).describe('8 artists, in play order') }),
  content_ideas: z.array(z.object({ title: z.string(), hook: z.string().describe('one sentence'), ref_ids: z.array(z.string()).describe('1–2 ledger items the idea riffs on (film, artist, brand)') })).describe('3 ideas'),
  local_partners: z.array(z.object({ id: z.string(), idea: z.string().describe('one-sentence cross-promotion') })).describe('only when a "place" section is given: 3 nearby venues that complement (never compete with) the business; otherwise empty'),
});

const WRITER = `You are a growth strategist for small businesses and creators. You get a business and a list of things its audience loves (Qloo taste data, each with an id). Turn that into a practical action plan.
Rules:
- Cite only ids from the list. Never mention a brand, podcast, artist or title that is not in the list.
- The data says what the audience also likes; it is not proof of anything else. Say "your audience also loves", never "your customers are" or invented numbers.
- Prefer specific, surprising items over generic giants when both fit.
- Partners: complementary, never direct competitors. Outreach is a draft the owner will edit; no false claims about the sender. Mention once, in plain words, that the overlap comes from Qloo taste data.
- Say nothing about an item beyond its name and description (no locations, founders or facts you were not given).
- Write names in prose, never ids. Ids go only in the id fields.`;

const line = (it) => `${it.id} | ${it.name}${it.about ? ` — ${it.about.slice(0, 110)}` : ''}${it.safety?.action === 'flag' ? ` [flag: ${it.safety.reason}]` : ''}`;

export async function plan(brief, ledger) {
  if (!hasModel()) return null;
  const sections = ['brand', 'podcast', 'artist', 'movie', 'place', 'tv_show', 'book']
    .map((k) => [k, ledger.byKind(k).filter(usable)]).filter(([, xs]) => xs.length)
    .map(([k, xs]) => `## ${k}\n${xs.map(line).join('\n')}`).join('\n\n');
  const seeds = ledger.seeds.map((s) => s.name).join(' + ');
  const r = await llm(WRITER_MODEL, {
    schema: planSchema, instructions: WRITER,
    prompt: `Business: ${seeds}\nWhat the owner told us: ${brief.text}\n\nTheir audience also loves (Qloo):\n${sections}`,
  });
  return verify(r.output, ledger);
}

// provenance check: keep only real, usable ledger ids of the right kind
export function verify(p, ledger) {
  const dropped = [];
  const ok = (id, kinds) => { const it = ledger.get(id); const good = it && usable(it) && (!kinds || kinds.includes(it.kind)); if (!good) dropped.push(id); return good; };
  const noIds = (t) => String(t).replace(/\s*\(?\b[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\b\)?/gi, '');
  const out = {
    audience_read: noIds(p.audience_read),
    partners: p.partners.filter((x) => ok(x.id, ['brand'])).map((x) => ({ ...x, item: ledger.get(x.id) })),
    podcasts: p.podcasts.filter((x) => ok(x.id, ['podcast'])).map((x) => ({ ...x, item: ledger.get(x.id) })),
    playlist: { title: p.playlist.title, artists: p.playlist.artist_ids.filter((id) => ok(id, ['artist'])).map((id) => ledger.get(id)) },
    content_ideas: p.content_ideas.map((c) => ({ ...c, hook: noIds(c.hook), refs: c.ref_ids.filter((id) => ok(id)).map((id) => ledger.get(id)) })),
    local_partners: (p.local_partners || []).filter((x) => ok(x.id, ['place'])).map((x) => ({ ...x, item: ledger.get(x.id) })),
  };
  for (const x of [...out.partners, ...out.podcasts]) for (const k of ['why', 'angle']) if (x[k]) x[k] = noIds(x[k]);
  out.dropped_ids = dropped;
  return out;
}

// The control: the same questions answered by a model with no data — what a generic AI assistant says.
const guessSchema = z.object({
  partners: z.array(z.string()).describe('5 brand names'),
  podcasts: z.array(z.string()).describe('5 podcast names'),
  artists: z.array(z.string()).describe('8 musical artists'),
  films: z.array(z.string()).describe('5 films'),
});

export async function guess(brief, ledger) {
  if (!hasModel()) return null;
  const seeds = ledger.seeds.map((s) => s.name).join(' + ') || brief.name;
  const r = await llm(FAST_MODEL, {
    schema: guessSchema,
    prompt: `Business: ${seeds}. ${brief.text}\nWithout looking anything up: which 5 brands would its audience also love (good co-marketing partners, not competitors), which 5 podcasts do they listen to, which 8 artists, which 5 films?`,
  });
  return r.output;
}

const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|podcast|show|inc|co)\b/g, '').trim();

// how much of the guess Qloo's data also contains (top N of each Qloo list)
export function overlap(g, ledger, n = 12) {
  const pairs = { partners: 'brand', podcasts: 'podcast', artists: 'artist', films: 'movie' };
  return Object.fromEntries(Object.entries(pairs).map(([gk, kind]) => {
    const real = new Set(ledger.byKind(kind).slice(0, n).map((x) => norm(x.name)));
    const shared = (g?.[gk] || []).filter((name) => real.has(norm(name)));
    return [gk, { guessed: g?.[gk]?.length || 0, shared }];
  }));
}
