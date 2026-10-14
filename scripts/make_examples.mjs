// Pre-run the example businesses so visitors can open finished runs without spending live calls.
// node scripts/make_examples.mjs [slug…]   → examples/<slug>.json + examples/index.json
import fs from 'node:fs';
import '../src/env.mjs';
import { run } from '../src/pipeline.mjs';
import { publicResult } from '../src/guard.mjs';

export const EXAMPLES = [
  { slug: 'tartine-bakery', name: 'Tartine Bakery', type: 'place', city: 'San Francisco', label: 'bakery · SF', text: 'I run Tartine Bakery in San Francisco and want local partners, podcast ads and a store playlist.' },
  { slug: 'katzs-delicatessen', name: "Katz's Delicatessen", type: 'place', city: 'New York', label: 'deli · NYC', text: "We are Katz's Delicatessen in New York and want podcast ads and brand collabs." },
  { slug: 'huberman-lab', name: 'Huberman Lab', type: 'podcast', label: 'podcast', text: 'We produce Huberman Lab and want sponsors and guest-swap shows.' },
  { slug: 'emma-chamberlain', name: 'Emma Chamberlain', type: 'person', label: 'creator', text: "I'm on Emma Chamberlain's team; we want sponsors and collabs for her channel." },
  { slug: 'liquid-death', name: 'Liquid Death', type: 'brand', label: 'brand', text: 'We are Liquid Death and want co-marketing partners and podcast ads.' },
];

const only = process.argv.slice(2);
fs.mkdirSync('examples', { recursive: true });
for (const x of EXAMPLES.filter((e) => !only.length || only.includes(e.slug))) {
  const r = await run({ name: x.name, type: x.type, city: x.city, text: x.text });
  const ok = r.ok && r.plan && r.guess;
  console.log(x.slug, ok ? 'ok' : 'INCOMPLETE', r.meta?.notes || r.error);
  if (ok) fs.writeFileSync(`examples/${x.slug}.json`, JSON.stringify({ ...publicResult(r), example: x.slug }));
}
const index = EXAMPLES.filter((e) => fs.existsSync(`examples/${e.slug}.json`)).map(({ slug, name, type, label }) => ({ slug, name, type, label }));
fs.writeFileSync('examples/index.json', JSON.stringify(index));
console.log('index', index.length);
