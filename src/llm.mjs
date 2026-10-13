// Gemini through the Vercel AI SDK. Several keys (GEMINI_API_KEYS=a,b) rotate on a quota error.
// Two tiers: FAST for the research loop and the safety screen, WRITER for the action plan and outreach.
import { generateText, Output } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

export const FAST_MODEL = process.env.FAST_MODEL || 'gemini-3.5-flash';
export const WRITER_MODEL = process.env.WRITER_MODEL || 'gemini-3.1-pro-preview';

const keys = () => (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '').split(',').map((k) => k.trim()).filter(Boolean);
let providers = null, idx = 0;
const prov = () => (providers ??= keys().map((apiKey) => createGoogleGenerativeAI({ apiKey })));

export const hasModel = () => prov().length > 0;

const thinking = (model) => ({ google: { thinkingConfig: { thinkingLevel: model.includes('pro') ? (process.env.WRITER_THINKING || 'low') : (process.env.FAST_THINKING || 'minimal') } } });

// opts = generateText options minus model; schema (zod) → structured output in r.output
export async function llm(modelId, { schema, ...opts }) {
  const ps = prov();
  if (!ps.length) throw new Error('no Gemini key');
  let err;
  for (let tries = 0; tries < ps.length; tries++) {
    try {
      return await generateText({
        model: ps[idx](modelId), maxRetries: 1, providerOptions: thinking(modelId),
        ...(schema && { output: Output.object({ schema }) }), ...opts,
      });
    } catch (e) {
      err = e;
      if (!/quota|rate|429|RESOURCE_EXHAUSTED/i.test(String(e.message) + (e.statusCode || ''))) break;
      idx = (idx + 1) % ps.length;
    }
  }
  throw err;
}
