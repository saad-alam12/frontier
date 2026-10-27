# Progress

## Morning summary (2026-10-27, written by the overnight cloud session)

**What works.** M0 to M4 are built, tested and pushed on `claude/build-progress-m4-oxebft` (88 tests, typecheck and lint clean, Electron build runs). The app opens with all eight screens; Settings, Library, Goals and Session are real, the rest are placeholders for M5 and M6. The model connection, the ingestion pipeline, goal compile, probe, plan and the full teaching loop all run against the fake provider in tests. Three things were also run live against the real model from the cloud session (it had its own credentials): the connection test, and a five-card teaching session (planner, two index passes, predict, explain, check) whose cards all validated on the first attempt and whose grading and explanations read well.

**What to try first.** The steps under "Next step" below: install, open the app, test the connection, add a lecture PDF, compile a goal, run a session. Then write what you think under "Owner feedback" and start the next cloud session.

**Update 2026-10-27:** the owner's review is done; see "Next step" (R1) and "Owner feedback".

**What is blocked or untested here.**
- The embedding model download (Hugging Face hub) was blocked from the cloud container, so the local embedder has never run; it follows the documented transformers.js API. Your first ingest downloads it (about 130 MB).
- No real PDF has been ingested live, only the fake-provider fixtures and a tiny generated PDF; the reader itself was verified inside Electron.
- M5 (practice, scheduler, Today) and M6 (map, lookup, trails, packaging) are not started. Compound practice at the end of a session and tomorrow's preview question on the Today screen will appear with M5.
- One terms question for you under "Open questions for the owner" (subscription login in a product you might distribute).

## Status

| Milestone | Status | Notes |
| --- | --- | --- |
| M0 Skeleton and model provider | Done | Live connection test passed through the Agent SDK in the cloud session |
| M1 Knowledge store and core logic | Done | 56 tests; seed graph of 36 nodes |
| M2 Ingestion and Library | Done | Pipeline tested with fake provider and fake embedder; live run is the owner's checkpoint |
| M3 Goals, probe and plan | Done | Compiler, prober, planner on the fake provider; 80 tests |
| M4 Teaching session | Done | Full loop on the fake provider; five cards run live against the real model |
| R1 Feedback round 1 and visual design | In progress | §1 bugs, §2 one answer field, §3 visual foundation, §4 session history done; `docs/feedback-round-1.md`, `docs/visual-design.md`; owner checkpoint after |
| M5 Practice, scheduler and Today | Not started | Starts after the owner's R1 feedback |
| M6 Map, Lookup, Trails, packaging | Not started | Owner checkpoint after |

## Next step

**Start R1.** The owner reviewed M0–M4 on 2026-10-27. Read `docs/feedback-round-1.md` (what to change, with acceptance checks and the order of work in its section 9) and `docs/visual-design.md` (the chosen Atlas look; mockups in `docs/mockups/`). Build R1, then stop at CHECKPOINT R1 READY with exact steps for the owner. Do not start M5 before the owner's R1 feedback.

The M4 checkpoint steps below are kept for reference; the owner tested steps 1–4 and part of 5, the rest will be tested after R1.

Exact steps for the owner, on the Mac (M4 checkpoint, done):

1. `git fetch && git checkout claude/build-progress-m4-oxebft && npm install && npm run dev`. The window should open with the sidebar.
2. Settings: press "Test connection". Expect "Connected via agentSdk" in one attempt. If not, run `npm run live:connection` in a terminal and send me the output.
3. Library: "Add files", pick a 20–40 page lecture PDF. The first run downloads the embedding model (a minute or two), then chunks fill in. Spot-check 20 ideas and the chains; add the same PDF again (should be skipped); add a second overlapping source (duplicates should merge).
4. Goals: add a goal over that lecture, press Compile, then "Probe what I know" (answer some wrongly with high confidence), then "Preview next session".
5. Session: "Start session" on that goal. Work through it honestly: predict with the slider, read the explanation, answer the check, state a link, write the idea in your own words, do the use task. Quit the app mid-session and reopen: it should resume at the same card. Finish with the close-out recall and the preview question.
6. Judge the teaching quality: does the predict question make you feel the gap, does the explanation anchor in what you already said, is the grading fair, are the misconceptions real? Write it under "Owner feedback" below.
7. Commit and push, then start the next cloud session with `claude --cloud "Continue the build"` (it will start M5).

## Owner feedback

### 2026-10-27, after M4
Full list with acceptance checks: `docs/feedback-round-1.md`. In short:
- Works: connection test, ingesting real lectures (4 and 5) incl. the embedding model, re-upload detection, goal compile, probe questions, explanation and grading quality, restart. Usage per session is acceptable.
- Bugs: probe disappears when leaving Goals; "Leave session" ends the session instead of pausing.
- Answering: one field for answer and reasoning, empty = no idea, three-way confidence; answers are dictated (Handy), so prompts must read spoken math and ignore transcription slips.
- Session: show the learner's own answers and all previous steps (questions, scores, rationales) like a chat; one thing at a time; probe one question at a time.
- Library: render LaTeX, show chains, lecture order with page citations, roots count as learnable, no summary-slide or worked-example nodes, extract headline ideas, collapse repeated animation slides (low priority).
- Goals v2: course vs personal, assessment types, material roles, exam profile from past exams, incremental compile, editable goals, unverified guesses not taught, saner depth targets.
- Settings: model dropdowns, effort per role, new defaults, escalation role, comparison script.
- Visual design: the Atlas direction in `docs/visual-design.md`; the owner checks alignment and consistency closely.
- Not yet tested (later): session close-out, transcript ingestion, mid-session resume, reconstruction on the second session.

## Commands

- `npm install` then `npm run dev` opens the app in development.
- `npm test` runs unit and integration tests with the fake provider (no network).
- `npm run typecheck`, `npm run lint`.
- `npm run build` builds the desktop app into `release/`.
- `npm run seed [path]` loads the 36-node example graph into a database (default `~/Frontier/frontier.db`).
- `npm run live:session [-- maxCards]` seeds the example graph into a temporary database and walks a few teaching cards with the real model and canned answers; prints every card and grade.
- `npm run live:ingest -- path/to/lecture.pdf [db path]` ingests one real file with the real model and the local embedding model (downloads bge-small-en-v1.5, about 130 MB, on first use), then prints the delta sentence.
- `npm run live:connection` runs the connection test against the real model (uses the Claude login on this machine; set `FRONTIER_PROVIDER=anthropicApi` and `ANTHROPIC_API_KEY` for the API provider).

## Owner checkpoints to review

Collected here because the owner was asleep while the build continued.

### After M4 (this is the M4 checkpoint)

- Run a full session on a real goal (steps 5 and 6 under "Next step"). Evidence, own statements and bugs land in the database: `sqlite3 ~/Frontier/frontier.db 'select kind, score, substr(reasoning,1,60) from evidence order by at desc limit 20'` if you want to look.
- Mid-session restart: quit and reopen; the Session screen should show the same card with the lesson map in the same state.
- After "Finish session", the Library should show a new source "Session <date>: <title>" being ingested: that is the tutor's prose (explanations, index gists, confirmed links) going through the same pipeline, so valid links can become chains.
- Reconstruction: start a second session on the same goal; it should open with a free-recall box instead of the orientation.
- Known gaps you will notice: no compound practice at the end of the session yet (M5), the Today screen is empty (M5), and the lesson map in the side panel is a list, not a graph (M6).

### After M3

- In Goals, add a goal over the lecture you ingested (for example "Pass the exam on this lecture with a top grade") and press Compile. Judge the capabilities: are they testable can-do statements, do the targets and depths make sense, are the "unverified" nodes really missing from the lecture?
- Press "Probe what I know": at most 8 questions, highest-information ideas first. Answer a few honestly and a few wrongly with high confidence; the results should score the wrong ones low and may note a misconception. A good derivation should credit the premises ("Also credits: ...").
- Press "Preview next session": the plan should start from ideas whose prerequisites you own (or root terms, if you own nothing yet) and never contain something you already own.

### After M2 (this is the M2 checkpoint; the owner was asleep, so the build went on)

- In the app, open Library and press "Add files". Pick a real 20–40 page lecture PDF. Watch the chunk list fill in; the first run also downloads the embedding model (about 130 MB, a minute or two) before the first chunk starts.
- When it is done, check the list of ideas: are the statements self-contained, are the page citations right (hover is not there yet; the chunk locators show the page ranges), do chains look like real derivations? Spot-check 20 nodes.
- Add the same PDF again: it should say "already in the library" and change nothing.
- Add a second overlapping source (another lecture on the same topic, or notes): duplicates should merge rather than reappear. The matcher leans toward merging paraphrases; tell me if it merges things that are not the same idea, or keeps obvious duplicates apart.
- The delta sentence will say everything is "new, needs a prerequisite first" until goals and sessions exist (M3, M4): that is expected.
- If a chunk fails, "Run again" retries only the failed chunks.
- Terminal alternative: `npm run live:ingest -- path/to/lecture.pdf` prints the same information without the app.

### After M1

- Nothing visible in the app yet. `npm run seed` then `npm test` is the check; the seed graph is game theory (Nash, SPE, backward induction) so you can judge the chains by eye in `backend/store/seed/exampleGraph.ts`.

### After M0

- Run `npm install` and `npm run dev`. The window should open with the sidebar and eight screens.
- In Settings, press "Test connection". With the Claude login on this Mac it should report "Connected via agentSdk" with one attempt. If it fails, try `npm run live:connection` in a terminal for the full error.

## Decisions

Record choices the design did not settle, newest first: date, decision, reason.

- 2026-10-27 — Session history is rebuilt from session events on every snapshot (`sessionHistory`): each `card` event is paired with the next `response` event for the same idea and stage; the open card is not history. Answer keys never reach it (cards go through `publicCard`).
- 2026-10-27 — The side-panel map shows up to 12 ideas around the current one (`neighbourhood` in core: premises first, at most four dependents, other plan steps included) laid out deterministically in the UI: x by state band (yours, current on the dashed edge line, learnable, beyond), y by neighbour averaging seeded from an id hash. "Learnable" = on the fringe or still on today's plan. "N ideas on your edge" counts the goal's fringe candidates.
- 2026-10-27 — Pause and End session sit in a quiet row at the bottom of the session column, not next to the breadcrumb, so the breadcrumb keeps the full width.
- 2026-10-27 — The "why this now" sentence moved from the card header to the side panel ("Why this now" card); cards show only learner-facing text.

- 2026-10-27 — Atlas is implemented as CSS variables in `ui/styles.css` (exposed to Tailwind through `@theme inline`) plus a small set of component classes (`.btn`, `.chip`, `.answer-surface`, `.list-card`, `.def-grid`, `.step-path`, `.v-path`, `.markdown`); screens compose them from `ui/components/` (`Shell`, `controls`, `paths`, `AnswerSurface`, `Markdown`). Spacing in screens uses the token steps only.
- 2026-10-27 — Questions use a new Question type style (24/1.45, weight 400) with KaTeX math, not the mockups' 36/500 Display with Unicode math (owner's instruction). Display stays for page titles. Recorded in `docs/visual-design.md`.
- 2026-10-27 — Settings is the eighth rail item, alone at the bottom (the mockups show only the seven learning screens).
- 2026-10-27 — Errors use one muted tone (`--danger-text`, #E3A59B) for text only; there is no red fill anywhere, so nothing competes with the accent.
- 2026-10-27 — The effort rating after an explanation became five chips (Easy · Fine · Took effort · Hard · Lost me), stored as 1–5 as before.
- 2026-10-27 — Library layout: the selected source's ideas in the main column, the list of sources (with progress) in the right panel.

- 2026-10-27 — The "Listening" indicator shows for 1.5 s after the answer field grows by four or more characters in one input event: dictation tools (Handy) deliver text in bursts, typing delivers one character at a time. There is no other way to tell dictated text from typed text in a plain textarea, and the field stays plain so pasting and simulated typing keep working.
- 2026-10-27 — The answer-reading instructions (one field, empty = no idea, dictated speech) live in `prompts/answering.md` and are appended to the tutor, recall and prober prompts by `answerReadingPrompt()`; the M5 grader must use it too. Confidence reaches models as a word ("fairly sure"), never a number.
- 2026-10-27 — Session cards also keep drafts (key: session, node, stage, step), so a paused session keeps a half-written answer.

- 2026-10-27 — Drafts (unsent probe and session answers) live in a `drafts` table in the database rather than browser storage, so they survive quitting the app and a dev-server port change. The UI saves them debounced (400 ms) and flushes on leaving the screen; submitting deletes them.
- 2026-10-27 — Pause records a `pause` session event and returns to Today; the session stays `active`, so reopening Session shows the same card from the saved state with no model call. End session (with a one-line confirmation) sets it to `abandoned` as before.
- 2026-10-27 — Probe SQL moved from the probe service into `backend/store/probes.ts` (only the store touches the database).

- 2026-10-26 — One tutor call per transition: the call that grades the learner's response also produces the next card. When the edge rules then change the next stage (worked example after three failures, skip ahead after two easy successes), a second call produces the right card. Node boundaries cost two calls.
- 2026-10-26 — Evidence per stage: predict → `predict`, check → `check`, derive → `derive`, use → `use`, compress (own words) → `explain`, index pass recognition → `predict` (depth 1). Connect writes no evidence; a confirmed link goes into the session transcript so extraction can turn it into a chain. The effort rating given after an explanation rides on the next evidence row.
- 2026-10-26 — Edge rules: a score below 0.5 is a failure, three in a row insert a worked-example card and reset; a score of 0.9 or more is easy, two in a row jump to the compress step. Counters reset per node.
- 2026-10-26 — Session state (plan, current card, per-node history, transcript, edge counters) is one JSON blob on the session row, saved after every transition; answer keys stay in it and never reach the renderer. Session events (card, response, node-done, reconstruct, close) are appended for Trails.
- 2026-10-26 — Transcript ingestion: after "Finish session", explanations, index gists, worked examples and confirmed links are added as a source of kind `session` titled "Session <date>: <title>" and run through the normal pipeline.
- 2026-10-26 — A session plans at most 6 nodes. Compound practice (design §4.1 step 5) is left for M5, where the scheduler and problem generator arrive.

- 2026-10-26 — "A goal needs a node" includes everything the targets are built on (transitive premises), so root terms on the way to a target are on the fringe. Without this, a goal over an ungrounded topic had no starting point.
- 2026-10-26 — Probe: code ranks targets by decayed count of dependent targets and hands the top candidates to the prober; at most 8 questions, one per node, keys and rubrics stored (in `problems`) before the questions are shown. A passing `derive` or `use` answer (≥ 0.7) writes `check` evidence on the node's direct premises at 0.9 × the score. Misconceptions become bugs.
- 2026-10-26 — Planner: code computes the candidate set (walk from the fringe toward the targets through chains whose premises are owned or already candidates), the agent picks at most 6 and gives the why, code re-orders by dependencies and sets the mode: `index` for index-tier nodes, `derive` when the target depth is 3 or more, else `teach`.
- 2026-10-26 — Goal compile hands the whole graph (id, name, kind, short statement) to the compiler up to 400 nodes; beyond that, the 400 nearest to the goal text by embedding.

- 2026-10-26 — pdfjs: the modern build (`pdfjs-dist/build/pdf.mjs`) is used inside Electron because the legacy build crashes Electron's Node runtime on import (SIGTRAP, reproduced in Electron 45); the legacy build is used under plain Node (tests, scripts) because the modern build expects Node 24 builtins. Same API; the switch is one line in `backend/ingest/readers/pdf.ts`.
- 2026-10-26 — Chunk budget 1500 tokens, estimated as characters/4, packed at block (page/heading) boundaries; a block larger than the budget is split at paragraphs, then sentences. Tiny trailing chunks fold into the previous one.
- 2026-10-26 — Embeddings: `Xenova/bge-small-en-v1.5` (384 dims, cls pooling, normalized) through transformers.js, cached in the data folder's `models-cache`. Candidate search is brute-force cosine (top 5 at ≥ 0.55) plus token-overlap name matching (≥ 0.5). Tests use a deterministic hashing embedder.
- 2026-10-26 — The matcher is only called for extracted nodes that have at least one candidate; nodes with none are new without a model call. Decisions are validated against the candidate list the model was shown.
- 2026-10-26 — HTML goes through Readability (Apache-2.0) over linkedom (ISC) with a plain-text fallback; headings become locators.
- 2026-10-26 — Extractor conflicts are stored on the chunk (`source_chunks.conflicts`) and surface in the delta view as `conflict`; investigations are post-MVP.

- 2026-10-26 — Depth is the highest level certified by any passing (score ≥ 0.7) evidence: lookup/predict → 1, recall/check/explain → 2, derive → 3, use → 4, practice → 2/4/5 by rung (<2 / 2–3 / 4). Failures never lower depth; they lower FSRS stability, which is what removes ownership. Implicit credit never certifies depth.
- 2026-10-26 — Score → FSRS rating: < 0.4 Again, < 0.6 Hard, < 0.85 Good, else Easy. Partial credit (implicit, weight w) moves stability and difficulty a fraction w of the way toward a full review. A lookup counts as a review with weight 0.2.
- 2026-10-26 — Ownership needs depth ≥ 2 and recall ≥ 0.8 (design §2.4). Claims with no chains into them are never on the fringe (they need a source or a chain first); root terms are on the fringe only when a goal targets them.
- 2026-10-26 — Tiers: target depth ≥ 3 → internalize; other targeted nodes → index, except the top 20% by leverage among targeted claims and procedures, which are internalized; untargeted nodes → archive. `expectedEffort` = 1 (0.5 for terms) + unowned premises on the cheapest chain. Centrality = decayed count of transitive dependents (factor 0.5).
- 2026-10-26 — Added a `backend/services/` layer for orchestration that combines core and store (evidence service, knowledge view, later ingestion and sessions). Design §11.2 updated.
- 2026-10-26 — Chain simplification runs over existing plus new chains at merge time, so a shorter argument arriving later retires an existing longer one.

- 2026-10-26 — Agent SDK calls are stateless: a multi-message conversation is flattened into one prompt because `query()` takes a single prompt. Every agent builds its full context per call, so nothing is lost; the API provider sends real multi-turn messages.
- 2026-10-26 — Default models: `claude-opus-5-5` for tutor, goal compiler, prober, planner, problem generator, grader; `claude-sonnet-5-5` for extractor, matcher, librarian and the connection test. Editable per role in Settings.
- 2026-10-26 — Settings (provider, models, data folder, concurrency) live in `settings.json` under Electron's userData folder, not in the database, because the data folder path must be known before the database can open. The `settings` table in the DB (M1) is for in-app preferences.
- 2026-10-26 — Prompts are read from `prompts/*.md` at runtime (bundled with the app) instead of being inlined by the bundler, so the same code runs under vitest, tsx scripts and Electron.
- 2026-10-26 — SQLite through Node's built-in `node:sqlite` (available in Node 22+ and in Electron 45's Node 24) instead of better-sqlite3. Same synchronous API, no native module to rebuild for Electron, tests and app share one driver. Design table updated. better-sqlite3 remains the fallback if `node:sqlite` proves limiting.
- 2026-10-26 — Build tooling: electron-vite (MIT) with Vite 7, React 19, Tailwind 4, vitest 5, electron-builder for packaging. Layout: `backend/` for main-process code with `backend/main.ts` as the entry, `backend/api/preload.ts` as the preload, `ui/` as the renderer root.
- 2026-10-26 — The IPC transport is one `invoke` channel carrying a method name plus input, typed by `backend/api/contract.ts`; the UI imports only types from the backend. Events flow back over one event channel.

## Open questions for the owner

- The embedding model download (Hugging Face hub) was blocked from the cloud container, so the live embedder is untested here; it follows the documented transformers.js API. If the first ingest fails on the model download, tell me the error.

- The Agent SDK documentation says: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." For personal use on your own machine this is your login and your product; if you later distribute or sell Frontier, the subscription-login path may need Anthropic's approval, and the API-key provider is the clean alternative. Worth reading Anthropic's commercial terms before deciding on distribution.
