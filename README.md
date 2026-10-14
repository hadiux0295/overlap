# Overlap — who else does your audience love?

**An agent that reads Qloo's taste data on the people who like a business and turns it into this week's marketing moves: partners to pitch (with drafted outreach), podcasts to sponsor, a playlist, content ideas, and — for venues — neighbours to team up with.**

Live demo: **https://overlap.hun-is.com** · MCP endpoint for other agents: `https://overlap.hun-is.com/mcp`

A bakery owner, a DTC brand or a creator types their name. About 30 seconds later they get a plan in which every partner, podcast, artist and reference is a real Qloo result about *their* audience — and, one tab over, what the same model says when it has no data. On the example runs the two lists barely meet: for Katz's Delicatessen the model alone guesses Frank Sinatra, Billy Joel and *The Godfather*; Qloo's audience data says Floating Points, Nicolas Jaar and dating podcasts. That gap is the product.

```
brief ─▶ research agent (tool loop)
           find_entity ─▶ set_seeds ─▶ audience_affinities × podcast · brand · artist · film (+ place in a city)
      ─▶ ledger (every Qloo result, by id)
      ─▶ brand-safety screen (rules + model: hold explicit / partisan / extremist, flag alcohol · cannabis · gambling …)
      ─▶ writer: action plan that may cite ledger ids only ─▶ provenance check drops anything else
      ─▶ control: same writer model, same questions, no data ─▶ overlap score
```

## Why it is built this way

- **Small businesses guess their audience; Qloo knows it.** "People who like us probably like X" is how most co-marketing and podcast buys start. We measured it: across 10 brand lists a no-tools model shared at most 2 of 5 names with Qloo, and 0 of 5 in 7 lists. Overlap makes that measurement visible on every run (the **AI guess** tab), using the *same* model as the plan so the control is not handicapped.
- **Nothing in the plan can be invented.** The research agent writes every Qloo result into a ledger. The writer model only sees ledger items and must cite them by id; `verify()` in `src/compose.mjs` drops any id that is unknown, held for safety, or of the wrong kind, and strips raw ids from prose.
- **Audience data is honest; ad buys need judgment.** Real taste data includes explicit and partisan shows. The safety screen holds those back from partner and ad picks — and the page says how many and why instead of hiding them. A restaurant that serves wine is not flagged; a beer brand is.
- **What we left out on purpose.** Qloo's demographic signal contradicted public profiles for 2 of 8 brands we checked, so age/gender skews are not shown. Explainability scores are near-even when several seeds are combined, so the UI never says "driven by X".

## How Qloo is used

| Call | Where | What for |
|---|---|---|
| `GET /search` (`types` always set) | `find_entity` | Resolve a brand, venue (`urn:entity:place`), creator (`urn:entity:person`) or podcast. Without `types`, 3 of 12 names resolved to the wrong kind. |
| `GET /v2/insights` `filter.type=urn:entity:{podcast,brand,artist,movie}` | `audience_affinities` | What the seed's audience also loves, with affinity scores. |
| `GET /v2/insights` `filter.type=urn:entity:place` + `filter.location.query` | same | Nearby venues the same people love (local cross-promotion). |
| `feature.explainability=true` | 2–3 seeds | Per-seed contribution for each result (business + references). |
| `signal.demographics.age` | optional | Narrow to an age bracket on request. All 8 values were probed. |

The hackathon key allows 5 requests/s and 10,000/month, so `src/qloo.mjs` caches every response by URL on disk (400 "no usable signal" answers included), spaces requests 250 ms apart, and tracks the monthly quota from the response headers.

## Run it

Node 24.

```bash
npm install
cat > .env <<'EOF'
QLOO_API_KEY=...            # hackathon key, https://hackathon.api.qloo.com
GEMINI_API_KEYS=...         # one or more Google AI keys, comma-separated
EOF
node src/run.mjs "Tartine Bakery" --type place --brief "Local partners and a store playlist in San Francisco" -v
npm start                   # web UI + /mcp on http://127.0.0.1:8743
npm test                    # offline: provenance check, safety rules, ledger, overlap
node scripts/make_examples.mjs   # pre-run the example businesses into examples/
```

Optional: `WRITER_MODEL` (default `gemini-3.1-pro-preview`), `FAST_MODEL` (default `gemini-3.5-flash`), `LIMIT_*` (see `src/guard.mjs`), `QLOO_CACHE_DIR`. Without a Gemini key the agent falls back to a fixed research path and shows the raw Qloo results.

Docker: `docker build -t overlap . && docker run --read-only --tmpfs /tmp --cap-drop ALL -p 127.0.0.1:8743:8743 --env-file .env -v overlap-cache:/cache overlap` — the image runs as the unprivileged `node` user.

## MCP

`POST /mcp` (Streamable HTTP, stateless). Tools:

- `find_entity(name, type)` → Qloo candidates
- `audience_affinities(seed_ids[1–3], type, location?, take?)` → what the audience also loves, with explainability for 2+ seeds
- `audience_action_plan(name, type, city?, brief?)` → the full agent: plan, safety summary, guess-vs-data overlap

## The public demo

- Live runs are capped per visitor and per day, and stop before the Qloo quota runs low; the five example runs are saved results and always work.
- Strict CSP, all data rendered with `textContent`, no cookies, no analytics. Briefs are sent to Gemini and Qloo for the run and not stored.
- The container has no route to private networks or cloud metadata.

## Files

`src/qloo.mjs` client + cache · `src/research.mjs` agent tools + loop · `src/safety.mjs` · `src/compose.mjs` plan, provenance check, guess, overlap · `src/pipeline.mjs` · `src/server.mjs` · `src/mcp.mjs` · `src/guard.mjs` limits · `public/` UI.

## Disclosure

Plans and drafts are written by Google Gemini. Audience data comes from Qloo's taste graph and describes affinities, not verified facts about anyone's customers. Example runs use public businesses for illustration; this project is not affiliated with or endorsed by them, and is not an official Qloo product. Images and logos shown in the UI are served by Qloo and belong to their owners.

MIT © Hun AI Lab — built for the Qloo Agentic Hackathon (2026).
