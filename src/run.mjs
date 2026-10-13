// CLI: node src/run.mjs "Glossier" [--type brand] [--brief "I run …"] [--out out/]
import fs from 'node:fs';
import path from 'node:path';
import './env.mjs';
import { run } from './pipeline.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const type = opt('type'), text = opt('brief'), outDir = opt('out') || 'out', verbose = args.includes('-v');
const name = args.filter((a) => a !== '-v').join(' ').trim();
if (!name) { console.error('usage: node src/run.mjs "<business name>" [--type brand|place|person|podcast] [--brief "..."] [-v]'); process.exit(2); }

const r = await run({ name, type, text }, { log: verbose ? console.error : () => {} });
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json');
fs.writeFileSync(file, JSON.stringify(r, null, 2));

if (!r.ok) { console.log('✗', r.error, r.notes); process.exit(1); }
const p = r.plan;
console.log(`▶ ${r.seeds.map((s) => s.name).join(' + ')} · ${Object.entries(r.audience).map(([k, v]) => `${k} ${v.length}`).join(' · ')} · held back ${r.safety.held} (${r.safety.reasons.map((x) => `${x.reason} ${x.n}`).join(', ') || '-'}) · flagged ${r.safety.flagged}`);
if (p) {
  console.log(`\nAudience: ${p.audience_read}`);
  console.log(`\nPartners: ${p.partners.map((x) => x.item.name).join(' · ')}`);
  console.log(`  ✉ ${p.partners[0]?.outreach.subject}\n  ${p.partners[0]?.outreach.body.replace(/\n/g, '\n  ')}`);
  console.log(`Podcasts: ${p.podcasts.map((x) => x.item.name).join(' · ')}`);
  console.log(`Playlist "${p.playlist.title}": ${p.playlist.artists.map((a) => a.name).join(' · ')}`);
  if (p.local_partners.length) console.log(`Local: ${p.local_partners.map((x) => `${x.item.name} — ${x.idea}`).join(" · ")}`);
  for (const c of p.content_ideas) console.log(`Idea: ${c.title} — ${c.hook} [${c.refs.map((x) => x.name).join(', ')}]`);
  if (p.dropped_ids.length) console.log(`(provenance check dropped ${p.dropped_ids.length} ids)`);
}
if (r.overlap) console.log(`\nGuess vs Data overlap: ${Object.entries(r.overlap).map(([k, v]) => `${k} ${v.shared.length}/${v.guessed}`).join(' · ')}`);
console.log(`Qloo calls ${r.meta.qloo.calls} (cached ${r.meta.qloo.cached}) · ${Math.round(r.meta.ms / 1000)} s · trace ${r.meta.trace.length} · notes ${JSON.stringify(r.meta.notes)}`);
console.log(`→ ${file}`);
