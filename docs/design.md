# Frontier — Final Design

Status: final design, 2026-10-26. This is the source of truth for what Frontier is. `docs/build-plan.md` says in what order it gets built.

Frontier is a desktop learning app. An AI does all the logistics of learning (what to learn next, from what, in what order, when to practice) so the learner spends effort only on the thinking that builds lasting understanding. It is built around three ideas:

1. **A two-layer knowledge map.** A world layer of true claims connected by reasoning chains, and a "you" layer on top that records what this learner owns, how deeply, and how fresh.
2. **Goals pull the learning.** The learner states goals; the system compiles them into the claims, depth and practice tasks needed, and always works at the edge of what the learner can learn next.
3. **Encode well once, maintain through use.** Teaching front-loads the effort that makes first-pass memory work; retention is mostly maintained by goal-shaped practice that reuses many fading ideas at once, not by flashcards.

---

## 1. The one metric

Frontier optimizes **verified usable understanding gained per unit of learner effort**. "Usable" means the learner can later perform a goal task with it, unaided.

| Kind of effort | Example | Policy |
| --- | --- | --- |
| Germane (builds schemas) | predicting, explaining, connecting, applying | Concentrate on high-leverage ideas |
| Intrinsic (material is hard) | dense proofs, new notation | Dose it: teach at the edge, never past it |
| Extraneous (logistics) | choosing topics, finding sources, planning, re-orienting | Drive to near zero: the system does it |

---

## 2. Knowledge model: two layers

### 2.1 World layer (objective)

What is true, independent of the learner. Never stores learner state.

- **Node** — `{ id, kind, name, statement, aliases[], sources[] }`
  - `kind`: `claim` (a proposition that is true or false), `procedure` (a how-to / skill, statement lists the steps), or `term` (a definition, notation, name or arbitrary fact with no derivation).
  - `sources[]`: citations — source id plus page, slide or timestamp; or the session id where the tutor taught it.
- **Chain** — `{ id, premises[], conclusion, sources[] }`
  - A chain says the premises **jointly** entail (or are required for) the conclusion.
  - Independent arguments for the same conclusion are separate chains. Never union their premises.
  - A conclusion can be a premise in other chains, so chains compose into derivations.
- **Chain simplification** (deterministic, at merge time): drop a chain when a kept chain for the same conclusion has a strict subset of its premises, or when its premises are covered by a kept chain's premises plus their transitive ancestry. Only provable redundancy is removed.
- **Worked example** — `{ id, nodeId, sourceId, locator, title, body }`: a concrete problem with its worked solution from a source, attached to the node it illustrates. Examples are never nodes; the tutor uses them for worked-example cards and to model use tasks on the course's style.
- The world layer is built by the ingestion pipeline (section 7) from sources and from teaching session transcripts.

### 2.2 You layer (personal overlay)

What this learner owns. One record per node the learner has touched, plus an append-only evidence log.

- **NodeState** — `{ nodeId, depth (0–5), targetDepth, tier, ownStatement, handle, fsrs: {stability, difficulty, lastReview, due}, firstSessionId }`
  - `ownStatement`: the learner's own wording (never overwritten by AI; AI may annotate).
  - `handle`: a one-line compression plus optional image, sketch or mnemonic.
  - `tier`: `internalize` | `index` | `archive` (section 6).
- **Evidence** (append-only) — `{ id, nodeId, at, kind, result, effort?, confidence?, context, sessionId }`
  - `kind`: `predict`, `check`, `explain`, `derive`, `use`, `practice`, `recall`, `lookup`.
  - `result`: score 0–1 (grades 0–10 are normalized), plus short reasoning text.
  - All NodeState fields except the learner's own text are **derived** from evidence and can be recomputed.
- **Bug** — `{ id, nodeId, description, firstSeen, lastSeen, resolvedAt? }`. A misconception the learner showed, linked to the node it corrupts. Bugs are personal, so they live here, not in the world layer.

### 2.3 Depth ladder

| Level | Name | Meaning | Typical evidence |
| --- | --- | --- | --- |
| 0 | Unknown | No evidence | — |
| 1 | Recognize | Knows it exists and roughly what it is about | index pass, recognition check |
| 2 | Explain | States it in own words with an example | Compress step, explain check |
| 3 | Derive | Reconstructs it from its premises, says why | derive check along a chain |
| 4 | Apply | Uses it correctly inside tasks | practice rung 2–3 |
| 5 | Transfer | Uses it in far contexts, critiques it, teaches it | practice rung 4, far cue distance |

Goals set `targetDepth` per node. Most nodes need 1–2; core nodes need 4–5.

### 2.4 The edge of knowledge

- A node is **owned** when `depth >= 2` and its current recall probability (from FSRS) is at least 0.8.
- The **fringe** is every node that is not owned but has at least one chain whose premises are all owned. These are learnable now with low intrinsic load. (Adapted from the "outer fringe" of Knowledge Space Theory.)
- A **root** (a node with no chains into it: a definition, a basic claim, a procedure) is on the fringe whenever it is not owned, with or without a goal. Only nodes with unowned premises "need a prerequisite first".
- Unverified nodes (a goal compile's guesses that no source grounds yet) can be on the fringe but are not planned for teaching (section 3).
- The fringe is computed in code, never by the LLM.

### 2.5 Implicit credit

When a node gets `use` or `practice` evidence, its premises get partial review credit along chains, decaying by a factor per hop (default 0.5, max 2 hops). This lets advanced practice pay off reviews of the basics it contains (the idea behind Math Academy's "fractional implicit repetition").

---

## 3. Goals

The learner never picks topics; they state goals.

### 3.1 The goal

A goal has the learner's sentence, a short `title` (set by the compiler), and:

- `kind`: `course` (lectures arriving over a term, plus scripts, exercise sheets, past exams) or `personal` (own resources, or none at all).
- `assessment`: `written_exam` | `oral_exam` | `presentation_or_project` | `outcome` | `none`.
- `targetGrade` (free text, e.g. "1.0"), `date` (exam or deadline) and `hoursPerWeek`, all optional.
- `materials`: sources linked to the goal, each with a **role**:

| Role | Examples | Used for |
| --- | --- | --- |
| `teaching` | lecture PDFs, scripts, book chapters | read into ideas and taught |
| `practice` | homework and exercise sheets | problem style; problems reused in practice (M5) |
| `assessment` | past exams, mock exams, grading criteria | the exam profile: format, duration, aids, question types, difficulty; never taught as content |
| `scope` | syllabus, module description | in or out of scope; the upcoming lectures on the goal page |
| `reference` | own notes, cheat sheets | read into ideas, linked for lookup and anchoring |

Only `teaching` and `reference` material is read into ideas; the rest is kept as text. When a file is added to a goal its role is guessed from its content (a cheap model call) and the learner can change it.

### 3.2 From goal to plan

1. **Goal to capabilities.** The Goal Compiler turns the goal into can-do statements, each testable by a task, shaped by the assessment (below).
2. **Capabilities to target nodes.** Each capability maps to the nodes it needs and the depth each needs. Most targets are depth 1–2 (roughly 50% at 1–2, 35% at 3, 15% at 4–5 for an exam goal); code logs a warning when more than half are at 3 or more. The compiler sees only the goal's own material (plus the premises its ideas are built on), never the whole library.
3. **Unverified ideas.** Ideas the goal needs but no material covers are created as `unverified` and shown as **expected** ("not in your material yet"). They are not taught unless the goal has no material at all (a goal from scratch) or the learner starts one explicitly. When a later source covers one (the matcher links them), it becomes verified.
4. **Incremental compile.** Adding material or editing the goal recompiles incrementally: existing capabilities keep their ids and mastery; the compiler adds capabilities and targets for what is new, extends existing ones, and retires one only when a new one clearly supersedes it. Reading new material, summarizing assessment and scope material, and recompiling run in the background as material arrives.
5. **Exam profile.** Assessment material is summarized once into an exam profile stored on the goal and given to the compiler, prober, planner and (M5) problem generator. Scope material yields the upcoming lectures.
6. **Gap analysis.** Target nodes are diffed against the you layer.
7. **Diagnostic probe.** A short probe tests the highest-information nodes (most dependents). A correct derivation of a node implies its premises at lower depth, so a few questions place the learner across a whole topic. Questions come one at a time; the learner answers in the one answer field (section 4.4), so any reasoning they give is there to diagnose. After submitting, each question shows its score, a one-line rationale and any misconception noted.
8. **Task ladder.** Each capability gets a ladder of authentic tasks from easy to hard (practice rungs, section 5).
9. **Mastery** of a capability = an unaided fresh task at the required rung and cue distance, scored at least 8/10. A capability shows as Ready (mastered, or every target at its depth), Learning or Not started.

Goals have priority weights and can change anytime; recompiling reuses everything already learned.

### 3.3 How the assessment changes behaviour

- **Written exam:** capabilities are what the exam asks on paper; practice is shaped by the exam profile; readiness per lecture; mock exams in the last four weeks (M5).
- **Oral exam:** practice is explaining aloud; the tutor can act as an examiner with follow-up "why" and "what if" questions; explanation depth is weighted up.
- **Presentation or project:** practice is producing the thing (outline, argument, Q&A rehearsal).
- **Outcome:** capabilities are the tasks themselves.
- **None (open-ended):** no endpoint; the planner keeps proposing the next frontier; milestones are checkpoints; it periodically asks where to go next.
- **Date:** the scheduler (M5) plans backwards from it so recall peaks on the date; without a date it paces by `hoursPerWeek`.

In R1 the assessment shapes the compiler (capabilities, depth distribution), the prober and planner (exam style); the rest arrives with M5.

---

## 4. Teaching: the session

A session serves one goal. The learner presses "Start session"; the system has already chosen what to do.

### 4.1 Flow

1. **Reconstruct (2–3 min).** Free recall: the learner sketches or lists last session's ideas from memory. The system diffs against the graph and records `recall` evidence.
2. **Orient.** One screen: today's task and why it matters for the goal.
3. **Plan.** The tutor builds a minimal dependency tree from owned nodes to today's target nodes and shows it as the lesson map. The plan adapts when evidence shows the learner's understanding differs from the estimate.
4. **Teach** each node on the plan with the step loop (4.2), pulling nodes in when the current task needs them.
5. **Compound practice** (if any nodes are due, section 5).
6. **Close.** Free-recall the session as a map; one sentence on what the learner can now do. Evidence and trail are written.
7. **Preview.** Show tomorrow's opening question without asking for an answer.

### 4.2 The step loop (per node)

Teach **one reasoning step at a time**, aiming for each step to feel obviously true, not merely familiar.

1. **Predict.** Before any explanation, pose the problem this node solves or the next move in the derivation. The learner answers in the one answer field with an optional confidence (section 4.4). Records `predict` evidence. Rationale: pretesting effect, prediction error.
2. **Explain (anchored).** Explain the step as the answer to the gap the learner just felt. Anchor it in the learner's own graph: an analogy from a domain they own, premises they already hold. One diagram where useful, minimal text, math in LaTeX. If the learner was confidently wrong, say so explicitly (hypercorrection effect).
3. **Check.** One question that tests the step. The answer key and rubric are written **before** the question is shown (commit-before-pose). Wrong answers are diagnosed from whatever reasoning the answer contains; a misconception becomes a Bug and is repaired before anything builds on it.
4. **Connect.** The learner states at least one link: "this requires…", "this is like … because…", "this differs from … in…". The tutor checks it. Valid links may become chains (via extraction, never written directly).
5. **Compress.** The learner writes the node in their own words (at most two sentences) and optionally picks a handle. The tutor critiques precision but does not replace the wording.
6. **Use.** One small goal-shaped task, including one case where the node does *not* apply. Records `use` evidence.

Index-tier nodes get a 30-second **index pass** instead: gist, where it sits on the map, one recognition check. Depth 3+ targets add a **derive** check: rebuild the node from its chain's premises.

### 4.3 Session rules

- **Stay at the edge.** Three failures in a row → drop a level (worked example, or a prerequisite node). A failure after that worked example → escalate once: a stronger model re-diagnoses the misconception from the idea's whole history and explains afresh. Repeated easy successes → remove support or skip ahead.
- **One goal per session.** Interleaving happens across sessions.
- **Pause, don't lose.** Leaving a session pauses it; it resumes at the same card with nothing regenerated. Ending a session early is a separate, deliberate action. Unsent answers are kept as drafts.
- **Passive reading is never the default.** Reading is raw material for the step loop.
- **Grounding.** Every taught claim cites a source the learner added, a fetched reference, or is marked `unverified` until checked.

### 4.4 Answering

Every answer (probe, session card, practice) goes into **one field**. The learner answers naturally: a bare answer, an answer with reasoning, reasoning without a conclusion, or nothing. An empty field (or the "No idea" button) means "I don't know" and is graded as such, never as an error. Confidence is optional and has three choices: a guess · fairly sure · sure (stored as 0.33 / 0.66 / 0.9). ⌘↵ submits.

Answers are often dictated by a speech-to-text tool that types into the focused field. The field is a plain text input so this works; every model that reads answers is told to read spoken math ("d a i by d x j"), fix obvious transcription slips from context ("Jack's" = JAX) and never penalize notation or spelling. A bare answer means the reasoning is unknown, not absent.

---

## 5. Practice and retention

### 5.1 Problem design

Every practice problem is specified on three discrete axes:

| Axis | Levels |
| --- | --- |
| Rung (support) | 0 Worked example · 1 Completion (finish a half-solved one) · 2 Direct exercise · 3 Composition (several ideas together) · 4 Path-finding (learner must find which ideas apply) |
| Cue distance | 0 Lesson context (same framing as taught) · 1 Adjacent context · 2 Far context (new situation, idea must still genuinely apply) |
| Presentation | Theory (the subject's own terms) · Application (a concrete real-world situation, ideally from the learner's goals) |

Rules:
- **Never announce** which node a problem needs. Retrieval must happen without the cue.
- **Commit before pose.** Solution and rubric are generated together with the problem, before it is shown.
- **One attempt.** The learner submits once, in the one answer field. Then the solution is revealed immediately; grading follows.
- **Grading.** Score 0–10 plus one or two sentences naming which rubric points were met or missed and which idea failed to come to mind. The grade becomes `practice` evidence on each node the problem targets (normalized), with implicit credit to premises.

### 5.2 Retention without flashcards

Target: under 10% of learning time feels like review.

1. **Implicit credit** (section 2.5).
2. **Compound practice sets.** When nodes drift toward their FSRS due date and no upcoming task uses them, the scheduler groups them into sets whose problems each need several fading nodes together (rung 3–4). One problem refreshes several nodes and builds links between them.
3. **Goal tasks double as review.** As a capability matures, its problems move toward rung 3–4, cue 2, Application: the learner's actual goal tasks.
4. **Reconstruction warm-ups** (session start).
5. **Bugs** get targeted contrast problems until they stop reappearing.
6. **Micro-cards** only for `term` nodes with nothing to hang on (vocabulary, constants): short, mnemonic-encoded, FSRS-scheduled.
7. **Let go deliberately.** Nodes that no active goal needs are allowed to decay to the index tier instead of being maintained.

---

## 6. Effort economics

```
leverage(n) = goalRelevance(n) × centrality(n) × depthGap(n) / expectedEffort(n)
```

- **goalRelevance**: sum over active capabilities needing n, weighted by goal priority.
- **centrality**: number of nodes that depend on n through chains (transitively, with decay).
- **depthGap**: max(0, targetDepth − depth).
- **expectedEffort**: estimated from premise states and the learner's history with similar nodes.

| Tier | What | Treatment | Typical share |
| --- | --- | --- | --- |
| Internalize | high-leverage claims and procedures | full step loop, maintained by practice | 10–20% |
| Index | must know it exists and roughly what it says | index pass, no maintenance | 30–50% |
| Archive | details, exact formulas, edge cases | stored only, attached to parent node | rest |

Each session the scheduler chooses between **build** (new fringe nodes), **deepen** (raise depth), and **consolidate** (compound practice) by expected leverage per minute.

---

## 7. Ingestion and delta reading

Sources: PDFs, slides, Markdown notes, web pages, YouTube transcripts, exercise notebooks, and the system's own teaching session transcripts.

1. **Chunk** the source (token-budgeted, respecting headings/pages). Slide PDFs that export every animation build as a page are collapsed first: consecutive pages whose text is contained in the next page's are dropped, the fullest page keeps the whole page range.
2. **Extract.** The extractor reads one chunk plus a digest of what this source already produced ("graph so far", ids verbatim) and submits nodes, chains and worked examples with citations. It references existing ids instead of restating them. It covers every distinct idea, always including the source's headline ideas (titles, section names, summary claims); summary and recap slides never create nodes; worked examples are attached to the node they illustrate.
3. **Match.** For each new node, embedding search finds candidates in the world layer; an LLM judge decides identity only (same claim or not), with a bias toward merging paraphrases. It never edits the extracted content.
4. **Merge.** Deterministic code writes nodes and chains, resolves ids, dedupes chains by (premises, conclusion), runs chain simplification, records coverage. A failed stage writes nothing; the next run retries.
5. **Delta view.** Each extracted node is classified for this learner: `known` (at target depth), `deeper` (known, source adds depth), `new-fringe`, `new-beyond` (needs a prerequisite first), `conflict` (contradicts the graph or another source). The learner sees: "Of 42 ideas in this lecture, 28 you have; 9 are new and learnable now; 3 need a prerequisite; 2 conflict." New nodes are queued by leverage.
6. **Conflicts** become short investigations in a session: which is right, under what conditions, why.

Per-source chunks run in order (each extractor sees the digest); different sources may run in parallel under a global concurrency limit.

---

## 8. Lookup, trails and the map

- **Lookup.** A question ("difference between SPE and Nash?") returns node cards: (1) the learner's own statement and handle, (2) neighbourhood via chains, (3) the derivation path from solidly owned nodes down to this one, (4) the trail of the session where it was learned. Archive details hang under their parent node. Search is semantic (local embeddings) plus fuzzy name match. A lookup records `lookup` evidence (a weak retrieval signal).
- **Trails.** Every session is stored as a timeline: predictions, answers, think-aloud text, errors, explanations that landed, nodes created. Browsable by date, goal or node; the system can narrate a trail ("how did I get from linear algebra to attention?").
- **Map.** Zoomable graph of the world layer, coloured by the learner's depth, faded by FSRS freshness, goals outlined, fringe highlighted. Chains render as small implication markers (premises → ⟹ → conclusion).
- **Bridges** (post-MVP). A background agent proposes structural analogies between distant areas; accepted bridges become explicit `analogous` notes the tutor uses for anchoring.

---

## 9. Self-tuning (post-MVP)

Measured: depth gained per session (verified by later unaided performance), minutes and 1–5 effort ratings per step, retention to next real use, efficiency per mode/topic/variant. Tuned: analogy domains that work for this learner, session length, predict-step length, personal FSRS parameters, recurring misconception patterns. Small A/B experiments on the learner's own data; a monthly one-page report.

---

## 10. The app

A desktop app (macOS first, then Windows/Linux) with seven screens:

| Screen | Purpose |
| --- | --- |
| Today | Start session, goal progress, what's fading, tonight's preview question |
| Session | The teaching UI: the session as a scrollable conversation of structured cards (predict, explanation with Markdown + KaTeX + diagrams, check, connect, compress, use), each answered in the one answer field, and the frontier map side panel |
| Map | The knowledge graph view |
| Goals | New goal as a short guided flow (sentence, kind, assessment, date, grade, pace, material with roles) with a live summary; a goal page with the lecture timeline, the skills the assessment asks for, expected ideas, the probe, this week's plan, the exam style and the material by role; Edit goal reopens the flow |
| Lookup | Search, node cards, derivation path |
| Trails | Past sessions, replay |
| Library | Add sources, see the delta view and every idea in source order with its page citation and its chains (built on / leads to), ingestion progress |
| Settings | Model provider and models, data folder, preferences |

The interface uses cards and controls, not a raw chat log, wherever the step loop has structure.

---

## 11. Architecture

### 11.1 Stack (all permissive licenses)

| Part | Choice | License |
| --- | --- | --- |
| Desktop shell | Electron | MIT |
| UI | React + TypeScript, built with Vite | MIT |
| Styling | Tailwind CSS | MIT |
| Local backend | Node (in Electron main process or a child process), TypeScript | — |
| Database | SQLite via Node's built-in `node:sqlite` (better-sqlite3 as fallback) | Node: MIT |
| Vector search | cosine similarity over embeddings stored in SQLite; sqlite-vec (MIT / Apache-2.0) if the graph outgrows that | — |
| Local embeddings | transformers.js with a small model (e.g. bge-small-en-v1.5) | Apache-2.0 (check model license) |
| Spaced-repetition math | ts-fsrs | MIT |
| Graph view | Cytoscape.js (or sigma.js + graphology) | MIT |
| Math rendering | KaTeX | MIT |
| Markdown | react-markdown + remark/rehype plugins | MIT |
| PDF text | pdfjs-dist | Apache-2.0 |
| Validation | zod | MIT |
| Tests | vitest | MIT |
| LLM (default) | Claude Agent SDK, authenticated with the learner's Claude login (subscription) | Anthropic terms — isolated behind the provider interface |
| LLM (alternative) | Anthropic API via @anthropic-ai/sdk with an API key | MIT |

Electron was chosen over Tauri because the backend and the Agent SDK are TypeScript/Node; a Tauri version would need a Node sidecar.

### 11.2 Layers

```
ui/          React screens and components (render only, talks to backend over IPC)
backend/
  api/       IPC handlers (transport only)
  agents/    one module per role; prompts in prompts/*.md
  core/      pure domain logic: fringe, leverage, scheduler, FSRS wrapper,
             implicit credit, chain simplification, merger, delta classification
  services/  orchestration that combines core and store: evidence service (the one
             evidence writer), knowledge view, ingestion pipeline, session runner
  store/     SQLite access; the only code that touches the database
  llm/       provider interface + AgentSdkProvider + AnthropicApiProvider + FakeProvider
  ingest/    file readers (pdf, md, html, transcript) and chunking
prompts/     all prompts, written from scratch for this project
```

Rules:
- **LLMs judge, code mechanizes.** Fringe, scheduling, FSRS, merging, dedupe, tiering and scoring arithmetic are deterministic code. LLMs extract, match, teach, generate and grade.
- **One writer per store.** Only the merger writes the world layer. Only the evidence service writes evidence. NodeState is derived from evidence.
- **Append-only evidence.** Never edit evidence; correct by appending.
- **Structured outputs via submit tools.** Each agent ends by calling a `submit_*` tool whose input is validated with zod; validation errors go back to the model for a retry (max 3).
- **Provider interface.** Every model call goes through `llm/` with a role name; settings map each role to a model and an effort level (`low` … `max`, passed as the Agent SDK `effort` option or the API's `output_config.effort`). Defaults: goal compiler and the escalation tutor Opus 5.5 at extra high; tutor and prober Opus 5.5 at medium; problem generator and grader Sonnet 5.5 at high; extractor, matcher and planner Haiku 5.5 at max; librarian and connection test Haiku 5.5 at medium.

### 11.3 Agent roles

| Role | Input | Output (submit tool) |
| --- | --- | --- |
| Goal Compiler | goal, kind, assessment, exam profile, the goal material's ideas, existing capabilities | title, new capabilities, extensions, retirements, target nodes with depths |
| Material classifier | a file's title and opening text | its role for the goal |
| Course profiler | assessment and scope material | exam profile, upcoming lectures |
| Prober | target subgraph, you-layer state | probe questions; then assessment updates |
| Planner | owned nodes, targets, fringe | lesson map (DAG of nodes for this session) |
| Tutor | lesson map, node, learner's neighbourhood, bugs, sources | the next step card (predict / explain / check / connect / compress / use) |
| Tutor escalation | the whole history of one idea after a worked example did not help | a re-diagnosis and a fresh explanation (once per idea) |
| Extractor | chunk + graph-so-far digest | nodes and chains with citations |
| Matcher | extracted node + candidates | identity links |
| Problem Generator | target nodes and chains, rung, cue, presentation, recent problems | statement, solution, rubric |
| Grader | problem, solution, rubric, learner answer | score 0–10 + reasoning |
| Librarian | query, matched node cards | short synthesized answer citing node ids |

### 11.4 Data folder

```
~/Frontier/            (configurable)
  frontier.db          SQLite: world layer, you layer, evidence, sessions, goals, sources, practice
  sources/             original files the learner added
  exports/             optional Markdown export of nodes (Obsidian-readable)
```

---

## 12. What is proven and what is a bet

| Component | Status | Basis |
| --- | --- | --- |
| Retrieval beats rereading | Strong | Roediger & Karpicke 2006; Dunlosky et al. 2013 |
| Predict first (pretesting) | Strong | Richland, Kornell & Kao 2009; Kornell, Hays & Bjork 2009 |
| Correcting confident errors | Solid | Butterfield & Metcalfe 2001 |
| Fast learning when a schema exists | Strong in animals, consistent in humans | Tse et al. 2007; van Kesteren et al. |
| Elaboration and self-explanation | Moderate | Dunlosky et al. 2013 |
| Worked examples with fading | Strong | Sweller; Kalyuga (expertise reversal) |
| Whole-task, goal-driven design | Good for complex skills | van Merriënboer, 4C/ID |
| Edge of knowledge as outer fringe | Established | Doignon & Falmagne, Knowledge Space Theory |
| FSRS forgetting model | Well validated | FSRS on large Anki datasets |
| Implicit review credit | Production use, little peer review | Math Academy |
| Compound practice replacing most review | Bet | Plausible, untested as replacement |
| Analogies picked from the learner's own graph | Bet | Analogy aids learning (Gentner); personal selection untested |
| Self-tuning per learner | Bet | Needs weeks of data |

If compound practice lets nodes decay, the scheduler will see it in the evidence and fall back to more explicit retrieval for those nodes.

---

## 13. Prior art and provenance

Frontier's design draws ideas from published learning science and from LearnHarness (github.com/amosblomqvist/learnharness, AGPL-3.0): knowledge as propositions plus reasoning chains, teaching one reasoning step at a time with think-aloud fields, and the rung / cue distance / presentation axes for practice. **Only ideas are used.** No LearnHarness code, prompt text or assets may be copied or adapted into this repository. All code and prompts here are written from scratch.
