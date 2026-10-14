// Overlap — browser side. All data goes into the page via textContent (never innerHTML).
const $ = (id) => document.getElementById(id);
const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
};
const KIND = { brand: 'Brand', podcast: 'Podcast', artist: 'Artist', movie: 'Film', place: 'Place', tv_show: 'TV show', book: 'Book' };
const TYPE_WORD = { brand: 'brand', place: 'venue', person: 'creator', podcast: 'podcast' };
const safeImg = (u) => (typeof u === 'string' && u.startsWith('https://images.qloo.com/') ? u : null);

// ---------- form ----------
const form = $('f');
const typeVal = () => form.querySelector('input[name=type]:checked').value;
const syncCity = () => { $('city-wrap').hidden = typeVal() !== 'place'; };
form.addEventListener('change', syncCity); syncCity();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = { name: $('name').value.trim(), type: typeVal(), city: typeVal() === 'place' ? $('city').value.trim() : '', brief: $('brief').value.trim() };
  if (!body.name) return;
  await live(body);
});

// ---------- examples ----------
fetch('/api/examples').then((r) => r.json()).then((list) => {
  for (const x of list) $('examples').append(h('button', { type: 'button', onclick: () => openExample(x) }, x.name, ' ', h('small', { text: x.label || TYPE_WORD[x.type] || '' })));
}).catch(() => {});

fetch('/api/health').then((r) => r.json()).then((s) => {
  if (s.models) { $('m-plan').textContent = s.models.plan; $('m-fast').textContent = s.models.research; }
  if (!s.live) { $('live-hint').textContent = 'Live runs are paused right now — the finished runs below still work.'; }
}).catch(() => {});
$('mcp-url').textContent = `${location.origin}/mcp`;

async function openExample(x) {
  reset();
  const r = await fetch(`/api/example/${encodeURIComponent(x.slug)}`).then((r) => r.json()).catch(() => null);
  if (!r?.ok) return fail('That example could not be loaded.');
  render(r, { example: true });
}

// ---------- live run (NDJSON stream) ----------
async function live(body) {
  reset();
  $('run').disabled = true;
  $('progress').hidden = false;
  step('Sending your brief to the agent');
  try {
    const res = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); return fail(j.error || 'Something went wrong.'); }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '', result = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const m = JSON.parse(line);
        if (m.event) step(m.event.text);
        if (m.result) result = m.result;
      }
    }
    if (!result?.ok) return fail(result?.error || 'The agent did not finish.');
    step('Done');
    render(result, { example: false });
  } catch { fail('Connection lost — try again.'); } finally { $('run').disabled = false; }
}

function step(text) {
  const ol = $('steps');
  ol.querySelectorAll('li.now').forEach((li) => li.classList.remove('now'));
  ol.append(h('li', { class: text === 'Done' ? '' : 'now', text }));
}
function reset() {
  $('error').hidden = true; $('result').hidden = true; $('steps').replaceChildren(); $('progress').hidden = true;
}
function fail(msg) { $('progress').hidden = true; $('error').textContent = msg; $('error').hidden = false; }

// ---------- render ----------
function card(item, { why, extra, contain } = {}) {
  const el = $('tpl-card').content.firstElementChild.cloneNode(true);
  const img = el.querySelector('img'), src = safeImg(item.image);
  if (src) { img.src = src; img.alt = item.name; } else el.querySelector('.pic').remove();
  if (contain) el.querySelector('.pic')?.classList.add('contain');
  el.querySelector('h4').textContent = item.name;
  const about = el.querySelector('.about');
  if (item.about) about.textContent = item.about; else about.remove();
  const w = el.querySelector('.why');
  if (why) w.textContent = why; else w.remove();
  const b = el.querySelector('.badges');
  if (item.affinity != null) b.append(h('span', { class: 'badge', title: 'Qloo affinity with your audience (0–1)', text: `Qloo affinity ${item.affinity.toFixed(2)}` }));
  if (item.safety?.action === 'flag') b.append(h('span', { class: 'badge flag', text: item.safety.reason }));
  if (extra) el.querySelector('.body').append(extra);
  return el;
}

function draft(o, partner) {
  const box = h('div', { class: 'draft', hidden: '' },
    h('p', { class: 'subj', text: `Subject: ${o.subject}` }),
    h('p', { class: 'text', text: o.body }),
    h('button', { type: 'button', class: 'copy', onclick: (e) => { navigator.clipboard?.writeText(`Subject: ${o.subject}\n\n${o.body}`); e.target.textContent = 'Copied'; } }, 'Copy draft'),
    h('p', { class: 'tag', text: 'AI-drafted — check every claim before you send it.' }));
  const btn = h('button', { type: 'button', class: 'draft-btn', onclick: () => { box.hidden = !box.hidden; btn.textContent = box.hidden ? `Draft email to ${partner}` : 'Hide draft'; } }, `Draft email to ${partner}`);
  return h('div', {}, btn, box);
}

function render(r, { example }) {
  $('progress').hidden = example;
  const p = r.plan;
  const seeds = r.seeds.map((s) => s.name).join(' + ');
  $('r-kicker').textContent = example ? 'Finished run' : 'Your run';
  $('r-example').hidden = !example;
  $('r-example').textContent = example ? `Illustrative example — Overlap is not affiliated with or endorsed by ${seeds}. The drafts show what the agent writes for a business; nothing was sent.` : '';
  $('r-title').textContent = `The audience of ${seeds}`;
  $('r-read').textContent = p?.audience_read || 'The plan writer did not finish for this run — the raw Qloo results are below.';
  const n = Object.values(r.audience).flat().length;
  const facts = [
    `${n} Qloo results`,
    `${r.safety.held} held back for brand safety`,
    r.meta.qloo.data_from ? `Qloo data from ${r.meta.qloo.data_from.slice(0, 10)}` : null,
    r.meta.trace?.length > 1 ? `${r.meta.trace.length} agent tool calls` : null,
    ...(r.meta.notes || []),
  ].filter(Boolean);
  $('r-facts').replaceChildren(...facts.map((t) => h('li', { text: t })));

  // data view
  $('partners').replaceChildren(...(p?.partners || []).map((x) => card(x.item, { why: x.why, extra: draft(x.outreach, x.item.name), contain: true })));
  $('b-local').hidden = !p?.local_partners?.length;
  $('local').replaceChildren(...(p?.local_partners || []).map((x) => card(x.item, { why: x.idea })));
  $('podcasts').replaceChildren(...(p?.podcasts || []).map((x) => card(x.item, { why: x.angle })));
  $('pl-title').textContent = p?.playlist?.title ? `Playlist: “${p.playlist.title}”` : 'Playlist';
  $('playlist').replaceChildren(...(p?.playlist?.artists || []).map((a) => h('li', {},
    safeImg(a.image) ? h('img', { src: safeImg(a.image), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', { class: 'ph', 'aria-hidden': 'true', text: a.name.replace(/^the\s+/i, '').charAt(0) }),
    h('div', {}, h('div', { class: 'nm', text: a.name }), h('div', { class: 'tg', text: (a.tags || []).slice(0, 2).join(' · ') })))));
  $('ideas').replaceChildren(...(p?.content_ideas || []).map((c) => h('div', { class: 'idea' },
    h('h4', { text: c.title }), h('p', { text: c.hook }), ...(c.refs || []).map((x) => h('span', { class: 'chip', text: `${KIND[x.kind] || ''}: ${x.name}` })))));

  const held = Object.values(r.audience).flat().filter((x) => x.safety?.action === 'hold');
  $('held').hidden = !held.length;
  $('held-sum').textContent = `${held.length} result${held.length === 1 ? '' : 's'} held back for brand safety (${r.safety.reasons.map((x) => `${x.reason}: ${x.n}`).join(', ')})`;
  $('held-list').replaceChildren(...held.map((x) => h('li', { text: `${KIND[x.kind]} · ${x.name} — ${x.safety.reason}` })));

  $('raw').replaceChildren(...Object.entries(r.audience).map(([k, xs]) => h('div', {},
    h('h5', { text: `${KIND[k] || k} · ${xs.length}` }),
    h('div', { class: 'rows' }, ...xs.map((x) => {
      const bar = h('i'); bar.style.setProperty('--w', `${Math.round((x.affinity ?? 0) * 100)}%`);
      return h('div', { class: `r${x.safety?.action === 'hold' ? ' heldrow' : ''}` }, h('span', { text: x.name }), h('span', { class: 'bar', title: x.affinity != null ? `affinity ${x.affinity}` : '' }, bar));
    })))));

  // guess view
  const o = r.overlap;
  if (o && r.guess) {
    const total = Object.values(o).reduce((a, v) => a + v.guessed, 0), shared = Object.values(o).reduce((a, v) => a + v.shared.length, 0);
    $('overlap').replaceChildren('Without data, the same model guessed ', h('b', { text: `${total} names` }), ' — ', h('b', { text: `${shared}` }), ` appear in Qloo's results for this audience.`);
    $('guess-note').textContent = `This is the control: ${r.meta.models?.guess || 'the same model'}, asked the same questions with no data. Names marked “in Qloo” also appear in Qloo's top results for this audience; everything else is the model's assumption.`;
    const cols = { partners: ['Brands', 'brand'], podcasts: ['Podcasts', 'podcast'], artists: ['Artists', 'artist'], films: ['Films', 'movie'] };
    $('guess').replaceChildren(...Object.entries(cols).map(([k, [title, kind]]) => {
      const hit = new Set(o[k].shared);
      const real = (r.audience[kind] || []).filter((x) => x.safety?.action !== 'hold').slice(0, 5);
      return h('div', { class: 'g-pair' },
        h('div', { class: 'g-col' }, h('h4', { text: `${title} — AI guess` }),
          h('ul', {}, ...(r.guess[k] || []).map((name) => h('li', {}, h('span', { text: name }), hit.has(name) ? h('span', { class: 'hit', text: 'in Qloo' }) : null))),
          h('p', { class: 'score', text: `${o[k].shared.length} of ${o[k].guessed} in Qloo's data` })),
        h('div', { class: 'q-col' }, h('h4', { text: `Qloo's top 5` }),
          h('ul', {}, ...real.map((x) => h('li', { text: x.name })))));
    }));
    $('t-guess').disabled = false;
  } else {
    $('overlap').textContent = '';
    $('t-guess').disabled = true;
  }
  tab('data');
  $('result').hidden = false;
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function tab(which) {
  $('t-data').setAttribute('aria-selected', String(which === 'data'));
  $('t-guess').setAttribute('aria-selected', String(which === 'guess'));
  $('data-view').hidden = which !== 'data';
  $('guess-view').hidden = which !== 'guess';
}
$('t-data').addEventListener('click', () => tab('data'));
$('t-guess').addEventListener('click', () => tab('guess'));
