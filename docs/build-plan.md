# Frontier — Build Plan

The MVP is milestones M0 to M6. Build them in order; each must pass its acceptance checks before the next starts. After each milestone: run all tests, update `docs/progress.md`, commit with message `M<n>: <title>`.

Hour figures are rough estimates of autonomous Claude Code working time.

## MVP definition

The learner can open the app, add a goal and a lecture PDF, see what is new to them, run a teaching session at their edge, get compound practice when ideas fade, look things up in their own words, and see their knowledge map grow. Everything runs locally on their Claude subscription.

Out of MVP: self-tuning, bridges, dictation, sketch handles, conflict investigations, micro-cards, mobile, code signing, auto-update.

---

## M0 — Skeleton and model provider (≈2 h)

- Electron + Vite + React + TypeScript (strict) + Tailwind app that opens a window with the sidebar and empty screens from design §10.
- `backend/llm/`: provider interface `complete({role, system, messages, tools, submitSchema})` returning a validated submit payload; implementations:
  - `AgentSdkProvider` using the Claude Agent SDK with the user's Claude login; custom tools exposed through the SDK's in-process tool support.
  - `AnthropicApiProvider` using `@anthropic-ai/sdk` and an API key from settings.
  - `FakeProvider` with scripted responses for tests.
- Submit-tool loop with zod validation and error-back retries (max 3).
- Settings screen: provider choice, model per role, data folder path.
- vitest set up; `npm run dev`, `npm test`, `npm run build` work.

**Accept:** the app opens; a "Test connection" button in Settings gets a validated structured reply from Claude through the Agent SDK using the subscription login; tests pass with the fake provider and no network.

## M1 — Knowledge store and core logic (≈2.5 h)

- SQLite schema and migrations for: nodes, chains, sources, node_states, evidence, bugs, goals, capabilities, targets, sessions, session_events, practice_sets, problems, answers, settings.
- `backend/store/` repositories; only module touching the DB.
- `backend/core/` pure functions with unit tests:
  - FSRS wrapper (ts-fsrs) and recall probability
  - derive NodeState from evidence (depth rules, FSRS updates)
  - implicit credit along chains
  - ownership, fringe
  - centrality and leverage, tier assignment
  - chain dedupe and simplification
- A seed script that loads a small hand-written example graph (about 30 nodes) for development.

**Accept:** unit tests cover every core function, including chain simplification cases and fringe on the seed graph; DB recreated from scratch by migrations.

## M2 — Ingestion and Library (≈3.5 h)

- Readers: PDF (pdfjs-dist), Markdown/text, HTML (readability-style text extraction, permissive library only).
- Chunker (token-budgeted, respects headings and pages).
- Extractor agent (graph-so-far digest, citations) → local embeddings (transformers.js + sqlite-vec) → Matcher agent → deterministic merger.
- Delta classification per learner.
- Library screen: add file, progress per chunk, delta view summary and list.
- Per-source sequential chunks, global concurrency limit 3, failure isolation per chunk.

**Accept:** ingesting a real 20–40 page lecture PDF produces nodes and chains with page citations; re-ingesting the same file is a no-op; ingesting a second overlapping source merges duplicates (spot-check 20 nodes by hand-written test fixtures with the fake provider, and one live run); delta view shows counts and lists.

## M3 — Goals, probe and plan (≈2.5 h)

- Goals screen: add goal with priority; Goal Compiler agent → capabilities and target nodes with depths (missing nodes created as `unverified`).
- Prober agent: few high-information questions with confidence and think-aloud; assessment writes evidence.
- Planner agent: lesson map DAG from owned nodes to targets, using the fringe.

**Accept:** for a goal over an ingested lecture, compile produces sensible capabilities and targets; a probe of at most 8 questions updates depths; the planner's map only contains nodes reachable from the fringe.

## M4 — Teaching session (≈5 h)

- Session screen with structured cards: Predict (confidence slider + think-aloud), Explain (Markdown + KaTeX), Check (commit-before-pose; answer key stored before display), Connect, Compress, Use; index pass for index-tier nodes; lesson map side panel with live statuses.
- Tutor agent producing one card at a time via submit tools; receives the node, its chains, learner's neighbourhood and own statements, bugs and source excerpts.
- Edge rules (drop a level after 3 failures, skip ahead on easy success).
- Reconstruct warm-up at start; close-out recall and preview question at end.
- Evidence written for every step; bugs recorded; own statements saved.
- Session transcript ingested through the M2 pipeline after the session (tutor prose only, as a source of type `session`).
- Session resumable after app restart.

**Accept:** a full session on a real goal runs end to end on the subscription; evidence, own statements and bugs are in the DB; reopening the app mid-session resumes at the same card; teaching quality reviewed by the owner (manual checkpoint).

## R1 — Feedback round 1 and visual design (≈10–14 h)

Everything in `docs/feedback-round-1.md`, in the order its section 9 gives, and the Atlas visual design in `docs/visual-design.md` across all screens. Includes Goals v2 (goal kinds, assessment types, material roles, incremental compile, edit goal), session history, one answer field, Library/extraction fixes, model and effort settings, and the model comparison script.

**Accept:** every acceptance check in `docs/feedback-round-1.md`; then CHECKPOINT R1 READY for the owner.

## M5 — Practice, scheduler and Today (≈3.5 h)

M5 builds on Goals v2: the scheduler uses the goal's date and `hoursPerWeek`, practice uses the exam profile and the goal's `practice` materials, and behaviour follows the assessment type (design §3). Practice uses the one-field answer from R1.

- Scheduler: due nodes from FSRS, grouping into compound sets, choosing build / deepen / consolidate.
- Problem Generator agent (rung, cue distance, presentation; never names the node; solution + rubric committed first; avoids repeating recent problems).
- Practice UI: one attempt in the one answer field, instant solution reveal, grade arrives async.
- Grader agent → evidence with implicit credit.
- Today screen: start session, goal progress, due count, preview question.

**Accept:** with seeded evidence that makes nodes due, a compound set is generated covering them; grades update FSRS state and premises get implicit credit; Today reflects the new state.

## M6 — Map, Lookup, Trails, packaging (≈3 h)

- Map: graph view coloured by depth, faded by freshness, fringe highlighted, goal outline, chain markers; click a node to open its card.
- Lookup: semantic + fuzzy search, node card (own words, handle, chains, derivation path, trail link), Librarian synthesized answer.
- Trails: session list and replay of session events.
- Unsigned local build for macOS (and a dev script for Windows/Linux).

**Accept:** map renders 500+ nodes smoothly; lookup finds a node by paraphrase; a trail replays a past session; the built app opens from Finder.

---

## Total

About 22 hours of autonomous work for M0–M6 (realistic range 15–30), plus owner checkpoints after M2, M4 and M6.

## Post-MVP (in rough priority)

1. Self-tuning metrics and monthly report
2. Dictation for think-aloud fields
3. Conflict investigations
4. Micro-cards for term nodes
5. Bridges (cross-domain analogies)
6. Sketch/image handles
7. Code signing, auto-update, Windows/Linux installers
