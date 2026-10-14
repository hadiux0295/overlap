// research → safety → plan + guess (in parallel) → one result object for the CLI, the web UI and MCP.
import { research } from './research.mjs';
import { screen } from './safety.mjs';
import { plan, guess, overlap } from './compose.mjs';
import { stats } from './qloo.mjs';
import { WRITER_MODEL, FAST_MODEL, hasModel } from './llm.mjs';

// brief = { name, type?, text? } — text is what the owner wrote; name/type are the business itself
export async function run(brief, { log = () => {}, emit = () => {} } = {}) {
  const t0 = Date.now();
  const calls0 = stats.calls, cached0 = stats.cached;
  const b = { ...brief, text: [
    brief.text || `${brief.name}${brief.type ? ` (${brief.type})` : ''}`,
    brief.name && brief.text && !brief.text.toLowerCase().includes(brief.name.toLowerCase()) ? `Business: ${brief.name}${brief.type ? ` (${brief.type})` : ''}.` : '',
    brief.city ? `Located in ${brief.city}.` : '',
    brief.refs?.length ? `Also use these references as seeds: ${brief.refs.join(', ')}.` : '',
  ].filter(Boolean).join(' ') };
  emit({ step: 'start', text: 'Agent is reading your brief' });
  const ledger = await research(b, { log, emit });
  if (!ledger.seeds.length || !ledger.items.size) {
    return { ok: false, error: 'Qloo has no audience data for this name yet — try the brand name, a flagship venue, or the creator\'s name.', notes: ledger.notes, trace: ledger.trace };
  }
  emit({ step: 'safety', text: `Brand-safety screen on ${ledger.items.size} results` });
  const safety = await screen(ledger);
  emit({ step: 'write', text: 'Writing the action plan — and asking the same model to guess without data' });
  const [p, g] = await Promise.all([
    plan(b, ledger).catch((e) => { ledger.notes.push(`plan failed: ${String(e.message).slice(0, 120)}`); return null; }),
    guess(b, ledger).catch((e) => { ledger.notes.push(`guess failed: ${String(e.message).slice(0, 120)}`); return null; }),
  ]);
  const fetched = ledger.calls.map((c) => c.fetched).filter(Boolean).sort();
  return {
    ok: true,
    brief: b,
    seeds: ledger.seeds,
    audience: Object.fromEntries(['podcast', 'brand', 'artist', 'movie', 'place'].map((k) => [k, ledger.byKind(k)]).filter(([, v]) => v.length)),
    safety,
    plan: p,
    guess: g,
    overlap: g ? overlap(g, ledger) : null,
    meta: {
      models: hasModel() ? { research: FAST_MODEL, safety: FAST_MODEL, plan: WRITER_MODEL, guess: WRITER_MODEL } : null,
      qloo: { calls: stats.calls - calls0, cached: stats.cached - cached0, data_from: fetched[0] || null },
      trace: ledger.trace, summary: ledger.summary, notes: ledger.notes, ms: Date.now() - t0,
    },
  };
}
