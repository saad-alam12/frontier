# Progress

## Summary at the M6 checkpoint (2026-10-28, cloud session)

**What works.** The MVP is built. Your two R1 points are fixed: "End session" now keeps your place (the next session recalls what you finished and reopens a half-done idea at the exact card, with your earlier answers shown), and the session's frontier map is laid out in rows so labels, points and the dashed line never touch (checked by a test over 800 random maps and in screenshots). M5 adds practice: a scheduler finds fading ideas (and pulls reviews forward before an exam date), groups them into compound problems, writes them without naming the ideas, shows the solution as soon as you answer and grades each idea in the background; it runs from Today and at the end of a session, and mock exams open four weeks before a written exam. Today is now a real screen. M6 adds the Map (every idea, left to right from definitions to results, smooth at 600+ ideas), Lookup (by meaning, by name and by your own words, with a short answer built only from your cards) and Trails (every session as a replayable timeline). 137 tests pass; typecheck, lint and the packaged Linux build are clean; every new screen was checked in Electron screenshots.

**Try first.** Today (what it suggests and why), then Map (click an idea: the card shows how you get there from what you own), then Lookup with a real question, then Trails → Replay on your last session. Steps are under "Next step".

**Blocked or untested here.** Everything model-facing in M5 and M6 (problem generator, grader, librarian) ran only on the fake provider; the first real practice set and lookup answer are yours to judge. The real embedding model is still blocked from the cloud, so Lookup "by meaning" was tested with the test embedder only. The macOS build (`npm run build:mac`) cannot be made on Linux; the Linux build was packaged and launched here. One fix touches your existing data: a partial review (a lookup, implicit credit) no longer resets an idea's review clock to now, so a few ideas may show slightly lower recall than before.

## Summary of R1 (2026-10-27, cloud session)

**What changed.** Everything in `docs/feedback-round-1.md` is built, in the order of its section 9, one commit per section: probe and session bugs, one answer field read as dictated, the Atlas look on every screen, the session as a conversation with a frontier map, Library fixes and better extraction, models and effort per role with an escalation tutor and a comparison script, and Goals v2 (course or personal, assessment, material with roles, incremental compile, exam profile, goal page, edit goal). 106 tests pass; typecheck, lint and the Electron build are clean. Screens were checked against the mockups in Electron screenshots.

**Owner change applied.** Questions no longer use the mockups' 36 px medium Display style with hand-typed math: every question uses one Question style (24 px, regular weight) with real KaTeX math, and math is sized to match Geist everywhere. Recorded in `docs/visual-design.md`.

**What is blocked or untested here.**
- The embedding model download (Hugging Face) is still blocked from the cloud container, so `npm run live:compare` and live ingestion could not run here. One live connection test with the new model and effort settings passed (Haiku 5.5, medium, via the Agent SDK).
- Goals v2's background work (reading new material, profiling past exams, recompiling) is tested with the fake model only; the role guess for a dropped file and the exam profile have not run against the real model.
- Your existing database migrates automatically: each existing goal keeps its skills and gets every non-session source in your library as its teaching material. It has no short title until it is compiled again ("Edit goal", then save, or add material).

## Status

| Milestone | Status | Notes |
| --- | --- | --- |
| M0 Skeleton and model provider | Done | Live connection test passed through the Agent SDK in the cloud session |
| M1 Knowledge store and core logic | Done | 56 tests; seed graph of 36 nodes |
| M2 Ingestion and Library | Done | Pipeline tested with fake provider and fake embedder; live run is the owner's checkpoint |
| M3 Goals, probe and plan | Done | Compiler, prober, planner on the fake provider; 80 tests |
| M4 Teaching session | Done | Full loop on the fake provider; five cards run live against the real model |
| R1 Feedback round 1 and visual design | Done, checkpoint ready | All sections of `docs/feedback-round-1.md`; 106 tests; owner checkpoint now |
| M5 Practice, scheduler and Today | Done | Scheduler in core, problem generator and grader on the fake provider, practice in sessions and from Today; 125 tests at the time |
| M6 Map, Lookup, Trails, packaging | Done, checkpoint ready | Canvas map (16 ms per frame at 636 ideas in the packaged app), lookup, trails with replay; Linux build packaged and launched; 137 tests |

## Next step

**CHECKPOINT M6 READY.** The MVP (M0–M6) is complete. Waiting for the owner's M6 feedback under "Owner feedback".

Exact steps for the owner, on the Mac:

1. `git fetch && git checkout claude/build-progress-m4-oxebft && git pull && npm install && npm run dev`. Your database migrates on first start (practice sets can now belong to a session).
2. **End session keeps your place.** Start a session, answer a step or two inside an idea, press "End session" and confirm. Start a new session on the same goal: it opens with recall of the ideas you finished, then shows the half-done idea first, with your earlier answers marked "last session" and the same open card (no wait: it is not regenerated). Library shows a new "Session …" source being read, as after a finished session.
3. **Frontier map.** In a session, check the "Your frontier" panel: ideas you own on the left with labels ending at their point, the current idea where the dashed line bends through it, learnable ideas on the right, ideas beyond your edge one step further out. Nothing overlaps; long names end in "…" and show in full on hover.
4. **Today.** It names a mode (Build, Deepen or Consolidate) with a one-line reason and minutes from your pace, then what is fading (recall bars; ideas that would be weak on your exam day say so), your goals with ideas ready and the exam countdown, and on the right the question your last session left, a two-week forecast of ideas falling due and this week's numbers. Ideas start fading a few days after you learn them, so on day one this may say "Build".
5. **Practice.** When something is fading, press "Practise what is fading" (or "Practise these together"). Each problem needs several ideas and never names them; answer once (speak or type), the solution appears at once, the grade and which ideas it drew on follow a few seconds later. Check that problems look like your exercise sheets and past exam if you added them, and that grades read your dictated answers fairly. Go back to Today: the practised ideas are no longer fading.
6. **Mock exam.** If your goal is a written exam less than four weeks away, "Take a mock exam" appears under the goal on Today: five problems the way your exam asks them.
7. **Practice in a session.** If ideas are fading when you finish the last idea of a session, "Before we close: practice" comes before the closing recall (up to two problems).
8. **Map.** Map shows every idea from definitions (left) to results (right). Drag to pan, scroll or pinch to zoom, "Fit" switches between your graph's height and everything. Click an idea: the panel shows its card (your words, depth ladder, built on / leads to, how you get there from what you own, sources, the session where you learned it). "Find an idea" jumps to one; the goal chips outline a goal's targets and dim what it does not need.
9. **Lookup.** Ask a real question ("What is the difference between X and Y?") and check the short answer only uses your ideas and names the ones it rests on; type a half-remembered name or your own handle for an idea. The first search may take a moment while new ideas are embedded.
10. **Trails.** Pick a session on the right; the timeline shows the plan, every card with your answer and grade, finished ideas, practice and the close. Press "Replay" to step through it (Play, Back, Next).
11. **Packaged app (optional).** `npm run build:mac` makes `release/mac-arm64/Frontier.app` (unsigned: right-click → Open the first time).
12. Write what you think under "Owner feedback" (especially the quality of real practice problems and grades, Today's suggestions, and how the Map reads with your real lectures), commit and push.

## Owner feedback

### 2026-10-27, after R1
- **End session must keep my place.** The next session continues a half-done idea at the step where I stopped, shows my earlier answers, and recalls the ideas I finished in the ended session. (Before: `abandonSession` made the next plan start again at Predict, and `previouslyTaughtNodes` and transcript ingestion only looked at sessions with status "done".) Done: see Decisions.
- **"Your frontier" map is messy.** Labels overlapped each other and the dots, and the dashed line ran through the text. Lay it out with no collisions and check it in an Electron screenshot. Done: see Decisions.
- Then continue with M5 and M6, every new screen in the Atlas look and checked in an Electron screenshot; stop at the M6 checkpoint with a short summary at the top of this file.

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
- `npm run build` builds the desktop app for this platform into `release/` (unsigned); `npm run build:mac`, `build:win`, `build:linux` for a specific one.
- `npm run seed [path]` loads the 36-node example graph into a database (default `~/Frontier/frontier.db`).
- `npm run live:session [-- maxCards]` seeds the example graph into a temporary database and walks a few teaching cards with the real model and canned answers; prints every card and grade.
- `npm run live:ingest -- path/to/lecture.pdf [db path]` ingests one real file with the real model and the local embedding model (downloads bge-small-en-v1.5, about 130 MB, on first use), then prints the delta sentence.
- `npm run live:compare -- <file> --a <model>:<effort> --b <model>:<effort> [--role extractor|matcher]` ingests one file twice into temporary databases, once per setting for that role (other roles stay at their defaults), and prints nodes, chains, samples, tokens and cost side by side. Never touches `~/Frontier/frontier.db`; reuses `~/Frontier/models-cache` for the embedding model.
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

- 2026-10-28 — Partial reviews move the review clock too (fixes an M1 choice): a review of weight w (implicit credit, a lookup at 0.2) now moves `lastReview` w of the way from the previous review to now, as it already did for stability and difficulty. Before, any light touch reset the clock to now, so a single lookup made a long-unreviewed idea look freshly reviewed (and owned). Full reviews are unchanged.
- 2026-10-28 — Map: no graph library. A layered layout in `ui/lib/mapLayout.ts` (pure, tested at 600 ideas) and a canvas renderer (`MapCanvas`): column = 1 + the deepest premise of an idea's shortest chain (roots at 0), rows ordered by six barycentre sweeps, ideas with no chains in a grid below. Chains with several premises meet at a small diamond just left of their conclusion (design §8's implication markers). Label boxes end before the next column, so labels never overlap at any zoom; below a legible size only important labels (selected, hovered, goal targets, learnable) are drawn, greedily without overlaps. Links fade with zoom until an idea is selected. The first view fits the graph's height and starts at the roots; "Fit" toggles to the whole graph. Cytoscape.js was in the design's stack table; a layered picture of a prerequisite graph reads better than a force layout and needs no dependency. Design §11.1 updated.
- 2026-10-28 — Map colours follow the frontier panel: owned ivory (radius by depth, opacity by recall), learnable an accent ring (dashed when unverified), beyond small and muted, goal targets an outer ring, the selected idea an accent halo. The Map uses a 400 px side panel so the canvas gets the room.
- 2026-10-28 — Lookup: score = max(semantic cosine over the stored node embeddings, fuzzy match over name, aliases, own words and handle). Fuzzy covers exact and substring matches, word prefixes ("nash eq") and ideas named outright in a question (multi-word names count strongly, one-word names weakly). Before searching, ideas without an embedding are embedded; if the model is unavailable, name matching still works. The librarian is called only for questions (a question mark, a question word, or five or more words) and may cite only the cards it was given (checked in code). Opening a card from Lookup records `lookup` evidence at score 0.6, at most once per idea per day; selecting on the Map does not.
- 2026-10-28 — Derivation path (`core/derivation.ts`): from the idea upward, each step takes the chain with the fewest unowned ideas below it, stopping at owned ideas and roots; listed grounds first. Shown on the node card as "How you get here from what you own".
- 2026-10-28 — Trails are rebuilt from session events (plan, recall, card/answer/grade pairs, finished ideas, practice answers with their solution and grade, pauses, close, end); answer keys never reach them. The open card of a session still in progress is left out. Replay reveals one entry at a time every 1.4 s with Play/Back/Next. Narrating a trail (design §8) is not built.
- 2026-10-28 — Packaging: `npm run build` packages for the current platform (`release/linux-unpacked` here, launched and checked), plus `build:mac`, `build:win` and `build:linux`. Unsigned.

- 2026-10-27 — M5 scheduler (`backend/core/scheduler.ts`, pure). Practice maintains an idea when it has depth ≥ 2, a goal wants depth ≥ 2 and it is not archived; everything else may decay on purpose. An idea is due on its FSRS date or once recall drops below 0.85; within 21 days of an exam it is also due when its predicted recall on the exam day is below 0.9 (unless reviewed in the last day), which is how "plan backwards from the date" works. Due ideas are grouped greedily: the most faded idea seeds a problem and takes up to two more due ideas within three hops along chains, nearest first; at most four problems per set.
- 2026-10-27 — Problem spec: one idea → rung 2 (direct exercise); several → rung 3 (composition); several each practised twice → rung 4 (path-finding). Cue distance = the least practised idea's count of passing practices, capped at 2. Presentation: application for outcome and project goals and for far cues, otherwise alternating by a hash so the subject's own terms stay in the mix.
- 2026-10-27 — Build / deepen / consolidate by expected depth points per minute: consolidating protects Σ (1 − recall) × depth over due ideas at five minutes per problem (×1.5 in the last week before an exam); building gains about two levels per new idea, weighted by leverage relative to the best one, at eight minutes each; deepening one level per idea at six minutes. The mode and a one-sentence reason show on Today and on the goal page. A day is `hoursPerWeek × 60 / 5` minutes (15–120), 40 without a pace.
- 2026-10-27 — "Never names the idea" is enforced in code for rung 3–4: a statement that contains one of its ideas' names (five or more characters) is sent back to the generator as a validation error. Rung 2 problems may name the idea (a direct exercise usually has to). Recent problems on the same ideas are listed for the generator and an exact repeat is rejected.
- 2026-10-27 — Grading: the grader returns a 0–10 score, feedback, a 0–10 score per idea and an optional misconception. Each idea gets its own practice evidence (rung, cue and problem id in the context), so a compound problem can credit one idea and not another; implicit credit to premises follows from the evidence service. An empty answer scores 0 without a model call (the solution is already on screen). Ungraded answers are retried at app start. Answers store the score normalized to 0–1, like probe answers.
- 2026-10-27 — Practice runs in two places: from Today (a practice set or a mock exam, on its own screen that keeps Today selected in the rail) and inside a session after the last idea (design §4.1 step 5), with up to two problems over fading ideas not taught in this session. A failed generation skips practice and goes to the close. Mock exams open in the last four weeks before a written exam: five problems, one per taught target, deepest targets first, rung 3–4.
- 2026-10-27 — Today: the next thing to do (continue the session, continue practice, or the lead goal's mode with its action), what is fading across goals with recall bars (exam-window ideas say what their recall would be on the day), each goal's ideas at depth, skills and exam countdown, and in the side panel the question the last session left, a 14-day forecast of ideas falling due (each idea counted once across goals) and this week's sessions and practised ideas.

- 2026-10-27 — Ending a session early keeps the place (owner, after R1). `abandonSession` now ingests the transcript like a finished session. The next session on the goal: (1) recalls the finished ideas of the most recent ended session (done or ended early) that finished any; (2) if the last ended session stopped inside an idea, that idea is carried over as the first plan step, with its open card, stage, edge counters, pending effort rating and per-idea history (`SessionState.resume`), restored when the step begins, so the same card reappears with no model call; its earlier cards and answers are copied into the new session's events (marked `carriedFrom`) so the conversation shows them with a "last session" caption. The planner plans one fewer idea and its own pick of the carried idea is dropped. Nothing carries once the idea is owned at its target depth. Ending again before reaching the carried idea carries it again.
- 2026-10-27 — Frontier map relaid (owner, after R1): measured in pixels of the panel's real width, two stacks of rows: ideas you own on the left with labels ending at their point, the current idea and learnable ideas on the right with labels starting at their point, ideas beyond your edge one step further out. The dashed edge line runs down the gap and bends only to pass through the current idea. Every label has a fixed box with an ellipsis (the current idea gets two lines), so collisions are impossible by construction; `ui/lib/frontierLayout.test.ts` checks labels, points and the edge line never touch across 800 random maps and four widths. Links touching the current idea are drawn in the accent; rows are ordered by barycentre to keep links short.

- 2026-10-27 — Goals v2 storage: new columns on `goals` (title, kind, assessment, target grade, date, hours per week, exam profile, course plan, which sources the profile and the last compile used, unverified ideas started anyway) and a `goal_materials` table (goal, source, role). Migration 4 links every existing non-session source to every existing goal as teaching material, so old goals keep working.
- 2026-10-27 — Only teaching and reference material is read into ideas. Files added through the goal flow go into the library unread; reading starts when the goal is saved. Library shows such files as "Kept as past exam" etc.
- 2026-10-27 — The role of a dropped file is guessed by a small call on the `extractor` role (Haiku) from its title and first three chunks; the exam profile and upcoming lectures come from one `goalCompiler`-role call over the assessment and scope text. No new Settings roles for these.
- 2026-10-27 — Background goal work (`GoalWorker`): read new teaching material → profile assessment/scope material when that set changed → compile when a newly read teaching source is not yet in the last compile. One run per goal at a time; it is triggered on save, when a source finishes ingesting, and at app start (`nextGoalStep` is the pure decision over stored state).
- 2026-10-27 — Incremental compile output: `title`, new `capabilities`, `extend` (new targets on existing capability ids) and `retire`; a first compile must define at least three capabilities. Existing ids and `mastered_at` are never touched except for retired capabilities. The depth-skew warning is logged when more than half the targets are at depth 3+.
- 2026-10-27 — Unverified ideas are planned only for goals with no material at all, or once the learner presses "Learn it anyway" (stored per goal). A matcher identity with an unverified node marks it verified (part of the merge plan).
- 2026-10-27 — Goal page: a lecture counts as done at 80% of its ideas owned; the current lecture is the first one below that. "This week" shows only today (the first ideas on the goal's fringe) until the M5 scheduler exists. Mock exams are shown starting four weeks before a written exam's date. Skill status: Ready (mastered or all targets at depth), Learning (any evidence), Not started.
- 2026-10-27 — The app runs Chromium with `--lang=en-GB` so native date fields read day/month/year while the UI stays in English.
- 2026-10-27 — The "Outcome" assessment chip reads "An outcome" so the five choices fit on one line of the 720 px column.

- 2026-10-27 — Effort per role: checked the current effort documentation (platform.claude.com/docs/en/build-with-claude/effort) and the installed SDK types. Fable 5.1, Opus 5.5, Sonnet 5.5 and Haiku 5.5 all accept low, medium, high, xhigh and max, so no combination is hidden; a custom model id is offered every level. The API provider sets `output_config.effort` and raises `max_tokens` to 64k at xhigh/max (32k otherwise) because thinking counts toward it. One live connection test at Haiku 5.5 medium passed through the Agent SDK from the cloud session.
- 2026-10-27 — Escalation: a new `reteach` stage. After a worked example (support), the next failure on that idea calls the `tutorEscalation` role once, with the idea's full history, for a re-diagnosis and fresh explanation; then the loop resumes after the stage that failed. Edge flags `supported`/`escalated` persist per idea. Shown to the learner as "Another way in"; the role is labelled "Second opinion" in Settings.
- 2026-10-27 — `live:compare` covers the roles that run during ingestion (extractor, matcher). Other roles would need recorded prompts with their submit schemas; not built, noted as an open question.
- 2026-10-27 — Settings stores model and effort overrides per role; an effort patch of `null` returns that role to its default. The "Default: …" line shows only for roles that differ from their default.

- 2026-10-27 — Fringe rule changed (owner, R1 §4.4): every unowned root is learnable now, goal or not; the `goalNeeded` input is gone. Planning drops unverified roots from the fringe so a compile's guesses are never taught (§5.4, completed with the goal materials rule in Goals v2).
- 2026-10-27 — Worked examples live in an `examples` table written by the merger (part of the merge plan, one writer for the world layer), deleted with their source or node. The tutor receives them for the node it teaches.
- 2026-10-27 — Build-page collapse runs for PDFs only (`collapseBuildPages` before chunking); a page is dropped when its whitespace-normalized text is contained in the next page's.
- 2026-10-27 — Library ideas: one list in source order (first chunk, then extraction order), with an "A to Z" toggle. Each idea shows its citations in this source ("p 12", "pp 7–9"), "Built on" per chain (alternative chains as "Or built on") and "Leads to"; names of ideas in the same source jump to them, others are plain text. The learnability label replaces the old grouping by class.
- 2026-10-27 — Extractor node cap raised from 40 to 60 per chunk now that the prompt asks for full coverage.

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

- Trail narration ("how did I get from linear algebra to attention?", design §8) is not built: it would be one librarian-style call over a trail. Say if you want it.
- Code signing and notarization for macOS need an Apple Developer account (yours); until then the app opens with right-click → Open.

- Model comparison: run `npm run live:compare -- <lecture.pdf> --a claude-haiku-5-5:max --b claude-sonnet-5-5:high` on a lecture to settle the extractor default (the cloud session could not, because the embedding model download is blocked there). Comparing other roles (tutor, prober, planner) would need a set of recorded prompts; say if you want that built.

- The embedding model download (Hugging Face hub) was blocked from the cloud container, so the live embedder is untested here; it follows the documented transformers.js API. If the first ingest fails on the model download, tell me the error.

- The Agent SDK documentation says: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." For personal use on your own machine this is your login and your product; if you later distribute or sell Frontier, the subscription-login path may need Anthropic's approval, and the API-key provider is the clean alternative. Worth reading Anthropic's commercial terms before deciding on distribution.
