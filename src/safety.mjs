// Phase 2 — brand safety. Audience data is honest about what people like, and some of it is not
// something a brand should buy ads on or co-market with. Items are held back (never silently dropped:
// the plan lists how many and why) or flagged with a badge the user can judge.
import { z } from 'zod';
import { llm, hasModel, FAST_MODEL } from './llm.mjs';

export const HOLD = ['sexual or explicit', 'partisan political', 'extremist or hateful', 'conspiracy or medical misinformation'];
export const FLAG = ['alcohol', 'cannabis', 'gambling', 'tobacco or vaping', 'mature themes'];

// bleeped or explicit words in a title are a hold even without a model
const EXPLICIT = /\*|\bf+u+c+k|\bsex\b|\bc[u*]m\b|\bporn|\bnsfw\b/i;

const schema = z.object({
  verdicts: z.array(z.object({
    id: z.string(),
    action: z.enum(['hold', 'flag']),
    reason: z.enum([...HOLD, ...FLAG]),
  })).describe('only items that need a hold or a flag; everything else is fine'),
});

export async function screen(ledger) {
  const items = [...ledger.items.values()];
  const out = new Map(); // id → { action, reason, by }
  for (const it of items) {
    if (it.content_rating === 'explicit' || EXPLICIT.test(it.name)) out.set(it.id, { action: 'hold', reason: 'sexual or explicit', by: 'rule' });
  }
  if (hasModel()) {
    const list = items.filter((it) => !out.has(it.id)).map((it) => `${it.id} | ${it.kind} | ${it.name} | ${(it.about || '').slice(0, 140)}`).join('\n');
    try {
      const r = await llm(FAST_MODEL, {
        schema,
        instructions: `You screen candidates for a brand's ad buys and co-marketing. Hold anything ${HOLD.join(', ')}. Flag (do not hold) an item only when ${FLAG.join(', ')} is its main product or topic — a restaurant that also serves wine is not flagged. Judge from the name and description only; when unsure, leave the item out of the list. A comedy or true-crime show is fine unless it is explicitly sexual or partisan.`,
        prompt: list,
      });
      for (const v of r.output.verdicts) if (ledger.get(v.id) && !out.has(v.id)) out.set(v.id, { action: v.action, reason: v.reason, by: 'model' });
    } catch (e) { ledger.notes.push(`safety model failed, rules only: ${String(e.message).slice(0, 100)}`); }
  }
  for (const [id, v] of out) Object.assign(ledger.get(id), { safety: v });
  const held = [...out.values()].filter((v) => v.action === 'hold');
  return {
    held: held.length,
    reasons: Object.entries(held.reduce((a, v) => ({ ...a, [v.reason]: (a[v.reason] || 0) + 1 }), {})).map(([reason, n]) => ({ reason, n })),
    flagged: [...out.values()].filter((v) => v.action === 'flag').length,
  };
}

export const usable = (it) => it.safety?.action !== 'hold';
