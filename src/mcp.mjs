// MCP endpoint (Streamable HTTP, stateless): any agent can use the same Qloo audience tools the web
// agent uses, or ask for the whole action plan. Same limits as the web UI.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import * as qloo from './qloo.mjs';
import { run } from './pipeline.mjs';
import { admit, admitLookup, release, clientIp, publicNotes, clean } from './guard.mjs';

const INSTRUCTIONS = 'Audience-to-action tools on Qloo taste data. find_entity resolves a business, venue, creator or podcast to a Qloo id; audience_affinities returns what that audience also loves (podcasts, brands, artists, films, places); audience_action_plan runs the full agent (partners with outreach drafts, podcast shortlist, playlist, content ideas, brand-safety screen). Results are Qloo affinity data, not verified facts.';
const OUT = ['podcast', 'brand', 'artist', 'movie', 'place', 'tv_show', 'book'];
const text = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], ...(o?.error && { isError: true }) });

function build(ip) {
  const server = new McpServer({ name: 'audience-agent', version: '0.2.0' }, { instructions: INSTRUCTIONS });
  server.registerTool('find_entity', {
    description: 'Resolve a name to Qloo entities (up to 4 candidates with id, type, description).',
    inputSchema: { name: z.string().max(80), type: z.enum(['brand', 'place', 'person', 'podcast', 'artist', 'movie', 'tv_show', 'book']) },
  }, async ({ name, type }) => {
    const no = admitLookup(ip); if (no) return text({ error: no });
    try { return text({ candidates: (await qloo.search(clean(name, 80), type, 4)).map(({ id, name, type, about }) => ({ id, name, type, about })) }); }
    catch (e) { return text({ error: e.status === 400 ? 'no match' : 'lookup failed' }); }
  });
  server.registerTool('audience_affinities', {
    description: 'What the audience of 1–3 Qloo entities also loves, for one output type. With 2–3 seeds each result carries per-seed explainability scores.',
    inputSchema: { seed_ids: z.array(z.string().max(64)).min(1).max(3), type: z.enum(OUT), location: z.string().max(60).optional(), take: z.number().int().min(1).max(20).optional() },
  }, async ({ seed_ids, type, location, take }) => {
    const no = admitLookup(ip); if (no) return text({ error: no });
    try { const r = await qloo.insights(seed_ids, type, { take: take || 10, location: type === 'place' ? location : undefined }); return text({ items: r.items, data_fetched: r.fetched }); }
    catch (e) { return text({ error: e.status === 400 ? 'Qloo has no usable signal for these seeds' : 'lookup failed' }); }
  });
  server.registerTool('audience_action_plan', {
    description: 'Run the full agent for a business: audience research, brand-safety screen, partners with outreach drafts, podcasts, playlist, content ideas, and a no-data guess for comparison. Takes 20–50 s.',
    inputSchema: { name: z.string().max(80), type: z.enum(['brand', 'place', 'person', 'podcast']), city: z.string().max(60).optional(), brief: z.string().max(400).optional() },
  }, async ({ name, type, city, brief }) => {
    const no = admit(ip); if (no) return text({ error: no.reason });
    try {
      const r = await run({ name: clean(name, 80), type, city: clean(city, 60) || undefined, text: clean(brief, 400) || undefined });
      if (!r.ok) return text({ error: r.error });
      return text({ seeds: r.seeds, plan: r.plan, safety: r.safety, guess_overlap: r.overlap, notes: publicNotes(r.meta.notes), models: r.meta.models });
    } catch { return text({ error: 'the agent failed on our side' }); } finally { release(); }
  });
  return server;
}

export function createMcp() {
  return async function handle(req, res) {
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); return res.end(); }
    const server = build(clientIp(req));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  };
}
