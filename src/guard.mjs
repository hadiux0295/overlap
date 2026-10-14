// Cost and abuse limits for the public demo. Every live run spends paid model calls and part of the
// Qloo key's monthly quota, so live runs are capped per visitor, per day and by the quota left;
// the example businesses are served from saved results and never count.
import { stats } from './qloo.mjs';

const num = (k, d) => Number(process.env[k] || d);
export const LIMITS = {
  perIpHour: num('LIMIT_IP_HOUR', 4),
  perIpDay: num('LIMIT_IP_DAY', 10),
  perDay: num('LIMIT_DAY', 60), // ≈ $0.05 per run on the writer model → a few dollars a day at most
  concurrent: num('LIMIT_CONCURRENT', 2),
  qlooFloor: num('QLOO_FLOOR', 1500), // keep this much of the monthly quota for judging
};

const hits = new Map(); // ip → [timestamps]
let day = new Date().toISOString().slice(0, 10), today = 0, running = 0;

export const clientIp = (req) => String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '?');

// → null when allowed (and counted), else { status, reason }
export function admit(ip) {
  const now = Date.now(), d = new Date().toISOString().slice(0, 10);
  if (d !== day) { day = d; today = 0; }
  if (stats.monthRemaining != null && stats.monthRemaining < LIMITS.qlooFloor) return { status: 503, reason: 'Live runs are paused to keep the Qloo quota for judging — the examples still work.' };
  if (today >= LIMITS.perDay) return { status: 429, reason: 'Today\'s live runs are used up — try an example, or come back tomorrow (UTC).' };
  if (running >= LIMITS.concurrent) return { status: 429, reason: 'The agent is busy with other runs — try again in a minute.' };
  const mine = (hits.get(ip) || []).filter((t) => now - t < 86_400_000);
  if (mine.filter((t) => now - t < 3_600_000).length >= LIMITS.perIpHour || mine.length >= LIMITS.perIpDay) return { status: 429, reason: 'You have reached the live-run limit for now — the examples are unlimited.' };
  mine.push(now); hits.set(ip, mine); today++; running++;
  if (hits.size > 5000) hits.delete(hits.keys().next().value);
  return null;
}
export const release = () => { running = Math.max(0, running - 1); };
export const status = () => ({ live: today < LIMITS.perDay && !(stats.monthRemaining != null && stats.monthRemaining < LIMITS.qlooFloor), runsLeftToday: Math.max(0, LIMITS.perDay - today) });

// what leaves the server: no stack traces, keys or upstream error text
export function publicNotes(notes = []) {
  return notes.map((n) => (/no usable signal|400/i.test(n) ? 'Qloo had no usable signal for one candidate; the agent moved on.'
    : /safety/i.test(n) ? 'The safety model was unavailable; rule-based screening only.'
      : /plan failed/i.test(n) ? 'The plan writer failed for this run.'
        : /guess failed/i.test(n) ? 'The no-data guess failed for this run.'
          : /rule path/i.test(n) ? 'The agent fell back to its fixed research path.' : 'A step had a problem.'));
}

// what the browser gets from a result: the plan and data, minus server internals
export function publicResult(r) {
  if (!r.ok) return { ok: false, error: r.error };
  return { ...r, meta: { ...r.meta, notes: publicNotes(r.meta.notes), summary: undefined } };
}

export const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

// MCP clients calling Qloo tools directly: a lighter per-visitor budget on raw lookups
const lookups = new Map();
export function admitLookup(ip, perHour = num('LIMIT_LOOKUPS_HOUR', 40)) {
  const now = Date.now();
  if (stats.monthRemaining != null && stats.monthRemaining < LIMITS.qlooFloor) return 'Qloo lookups are paused to keep the quota for judging.';
  const mine = (lookups.get(ip) || []).filter((t) => now - t < 3_600_000);
  if (mine.length >= perHour) return 'Lookup limit reached for this hour.';
  mine.push(now); lookups.set(ip, mine);
  if (lookups.size > 5000) lookups.delete(lookups.keys().next().value);
  return null;
}
