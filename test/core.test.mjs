// Offline tests: provenance check, guess overlap, rule-based safety, ledger de-dup. No network, no model.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEYS = ''; process.env.GEMINI_API_KEY = '';
const { Ledger } = await import('../src/research.mjs');
const { verify, overlap } = await import('../src/compose.mjs');
const { screen } = await import('../src/safety.mjs');

const item = (id, name, extra = {}) => ({ id, name, about: null, ...extra });
function ledger() {
  const l = new Ledger();
  l.seeds = [{ id: 'S', name: 'Seed Co' }];
  l.add('brand', [item('B1', 'Oddfellows'), item('B2', 'Tillamook'), item('B3', 'oddfellows'), item('S', 'Seed Co')], {});
  l.add('podcast', [item('P1', 'The Sporkful'), item('P2', 'Guys We F****d'), item('P3', 'Clean Show', { content_rating: 'explicit' })], {});
  l.add('artist', [item('A1', 'Vulfpeck')], {});
  l.add('place', [item('L1', 'Souvla')], {});
  return l;
}

test('ledger drops the seed itself and same-name duplicates of a kind', () => {
  const l = ledger();
  assert.deepEqual(l.byKind('brand').map((x) => x.id), ['B1', 'B2']);
});

test('safety rules hold bleeped titles and explicit ratings without a model', async () => {
  const l = ledger();
  const s = await screen(l);
  assert.equal(s.held, 2);
  assert.equal(l.get('P2').safety.action, 'hold');
  assert.equal(l.get('P3').safety.action, 'hold');
  assert.equal(l.get('P1').safety, undefined);
});

test('provenance check drops invented, held and wrong-kind ids and strips ids from prose', async () => {
  const l = ledger();
  await screen(l);
  const out = verify({
    audience_read: 'They love Oddfellows (742FBE1B-B70F-471F-AD07-A55C9A903628).',
    partners: [{ id: 'B1', why: 'x', outreach: { subject: 's', body: 'b' } }, { id: 'FAKE', why: 'x', outreach: { subject: 's', body: 'b' } }, { id: 'P1', why: 'x', outreach: { subject: 's', body: 'b' } }],
    podcasts: [{ id: 'P1', angle: 'a' }, { id: 'P2', angle: 'a' }],
    playlist: { title: 't', artist_ids: ['A1', 'B2'] },
    content_ideas: [{ title: 't', hook: 'h', ref_ids: ['A1', 'NOPE'] }],
    local_partners: [{ id: 'L1', idea: 'i' }, { id: 'B2', idea: 'i' }],
  }, l);
  assert.deepEqual(out.partners.map((x) => x.id), ['B1']);
  assert.deepEqual(out.podcasts.map((x) => x.id), ['P1']);
  assert.deepEqual(out.playlist.artists.map((x) => x.id), ['A1']);
  assert.deepEqual(out.content_ideas[0].refs.map((x) => x.id), ['A1']);
  assert.deepEqual(out.local_partners.map((x) => x.id), ['L1']);
  assert.equal(out.audience_read, 'They love Oddfellows.');
  assert.deepEqual(out.dropped_ids.sort(), ['B2', 'B2', 'FAKE', 'NOPE', 'P1', 'P2'].sort());
});

test('overlap matches names loosely (case, "The", punctuation)', () => {
  const l = ledger();
  const o = overlap({ partners: ['ODDFELLOWS', 'Nike'], podcasts: ['Sporkful'], artists: [], films: [] }, l);
  assert.deepEqual(o.partners.shared, ['ODDFELLOWS']);
  assert.deepEqual(o.podcasts.shared, ['Sporkful']);
  assert.equal(o.films.guessed, 0);
});
