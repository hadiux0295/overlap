// Phase 1 — research. An agent reads the brief, resolves the business to a Qloo entity, and pulls the
// audience's affinities across podcasts, brands, artists and films (and places when a city matters).
// Every Qloo result lands in the ledger; later phases may only cite ledger ids, so nothing in the plan
// can be invented. Without a model key, the rule path does the same fetches in a fixed order.
import { tool, stepCountIs } from 'ai';
import { z } from 'zod';
import * as qloo from './qloo.mjs';
import { llm, hasModel, FAST_MODEL } from './llm.mjs';

export const OUTPUTS = ['podcast', 'brand', 'artist', 'movie'];
const INPUT_TYPES = ['brand', 'place', 'person', 'podcast', 'artist', 'tv_show', 'movie', 'book'];

export class Ledger {
  constructor() { this.items = new Map(); this.seeds = []; this.calls = []; this.notes = []; }
  add(kind, items, meta) {
    this.calls.push({ kind, n: items.length, ...meta });
    const key = (x) => `${kind}:${x.name.toLowerCase().trim()}`;
    const seen = new Set([...this.items.values()].filter((x) => x.kind === kind).map(key));
    for (const it of items) {
      if (this.items.has(it.id) || seen.has(key(it)) || this.seeds.some((s) => s.id === it.id || s.name.toLowerCase() === it.name.toLowerCase())) continue;
      seen.add(key(it));
      this.items.set(it.id, { ...it, kind });
    }
  }
  byKind(kind) { return [...this.items.values()].filter((x) => x.kind === kind); }
  get(id) { return this.items.get(id); }
}

// the tools the research agent (and the MCP server) can call
export function researchTools(ledger) {
  return {
    find_entity: {
      description: 'Look up a business, venue, creator, podcast or title in Qloo. Returns up to 4 candidates with their type and a short description. Always pass the type you believe it is.',
      inputSchema: z.object({ name: z.string(), type: z.enum(INPUT_TYPES) }),
      execute: async ({ name, type }) => {
        try { return { candidates: (await qloo.search(name, type, 4)).map(({ id, name, type, about, popularity }) => ({ id, name, type, about, popularity })) }; }
        catch (e) { return { error: e.message }; }
      },
    },
    set_seeds: {
      description: 'Commit the 1–3 Qloo entity ids that represent the business (the business itself first; optionally up to two close references the user named). Call once before audience_affinities.',
      inputSchema: z.object({ ids: z.array(z.string()).min(1).max(3), names: z.array(z.string()).min(1).max(3) }),
      // new seeds = a new audience: results fetched for earlier seeds no longer apply
      execute: async ({ ids, names }) => { ledger.seeds = ids.map((id, i) => ({ id, name: names[i] || id })); ledger.items.clear(); return { ok: true }; },
    },
    audience_affinities: {
      description: 'What else the audience of the seed entities loves, from Qloo: one output type per call. Optional: location (a city, only for type place), age bracket filter.',
      inputSchema: z.object({
        type: z.enum([...OUTPUTS, 'place', 'tv_show', 'book']),
        location: z.string().optional(),
        age: z.enum(['24_and_younger', '25_to_29', '30_to_34', '35_and_younger', '36_to_55', '55_and_older']).optional(),
      }),
      execute: async ({ type, location, age }) => {
        if (!ledger.seeds.length) return { error: 'call set_seeds first' };
        try {
          const r = await qloo.insights(ledger.seeds.map((s) => s.id), type, { take: 12, location: type === 'place' ? location : undefined, age });
          ledger.add(type, r.items, { location, age, fetched: r.fetched, cached: r.cached });
          return { count: r.items.length, items: r.items.map(({ id, name, about, affinity }) => ({ id, name, about: about?.slice(0, 90), affinity })) };
        } catch (e) {
          ledger.notes.push(`${type}: ${e.message}`);
          return { error: e.status === 400 ? 'Qloo has no usable audience signal for these seeds — try another candidate from find_entity' : e.message };
        }
      },
    },
  };
}

const INSTRUCTIONS = `You research a business's audience with Qloo's taste data.
1. Work out what the business is from the brief (brand, venue/place, creator = person, podcast …). Call find_entity with the right type; if the first try misses, try the obvious alternative type once.
2. Pick the candidate that is clearly the same business (name and description match). Call set_seeds with it, plus up to two reference entities only if the user explicitly named them.
3. Call audience_affinities for each of: podcast, brand, artist, movie. If the brief mentions a city and the business is local, also call it for place with that location. Use the age filter only if the user asks for a specific age group.
4. If a call says there is no usable signal, go back to step 2 with the next candidate (at most once).
5. Finish with one line: the entity you used and anything that failed. Do not write the plan — another step does.`;

export async function research(brief, { log = () => {} } = {}) {
  const ledger = new Ledger();
  const specs = researchTools(ledger);
  if (hasModel()) {
    try {
      const tools = Object.fromEntries(Object.entries(specs).map(([k, v]) => [k, tool(v)]));
      const r = await llm(FAST_MODEL, { instructions: INSTRUCTIONS, prompt: brief.text, tools, stopWhen: stepCountIs(12) });
      ledger.trace = r.steps.flatMap((s) => s.toolCalls.map((c) => `${c.toolName}(${JSON.stringify(c.input).slice(0, 80)})`));
      ledger.summary = r.text;
      log(ledger.trace.join('\n'));
      if (ledger.seeds.length && ledger.items.size) return ledger;
      ledger.notes.push('agent finished without data → rule path');
    } catch (e) { ledger.notes.push(`agent error → rule path: ${String(e.message).slice(0, 120)}`); }
  }
  return rulePath(brief, ledger, specs);
}

// no model (or the agent failed): first matching entity of the stated type, then the four outputs
async function rulePath(brief, ledger, specs) {
  ledger.trace = ['rules'];
  for (const type of [brief.type, ...INPUT_TYPES.filter((t) => t !== brief.type)].filter(Boolean).slice(0, 3)) {
    const hits = await qloo.search(brief.name, type, 3).catch(() => []);
    const hit = hits.find((h) => h.name.toLowerCase() === brief.name.toLowerCase()) || hits[0];
    if (!hit) continue;
    ledger.seeds = [{ id: hit.id, name: hit.name }];
    for (const t of OUTPUTS) await specs.audience_affinities.execute({ type: t });
    if (ledger.items.size) return ledger;
    ledger.items.clear();
  }
  return ledger;
}
