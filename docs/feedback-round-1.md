# Feedback round 1 (owner checkpoint after M4, 2026-10-27)

The owner tested M0–M4 live on a Mac: connection test, ingesting two real lectures (TUM "Modern Deep Learning in Physics", lectures 4 and 5), goal compile, the probe and part of a teaching session. Everything below is what to change. It is milestone **R1** in `docs/build-plan.md` and comes **before M5**.

Work through the sections in order. Each item has an acceptance check. When an item changes the product, update `docs/design.md` in the same commit (CLAUDE.md rule). The visual side is specified separately in `docs/visual-design.md`, with reference mockups in `docs/mockups/`.

What already works and must keep working: Settings connection test, ingesting a PDF end to end (including the local embedding model), duplicate-file detection on re-upload, goal compile, probe questions, the teaching loop's explanations and grading quality (owner: "reasonable"), app restart with all data intact. Usage per session is acceptable.

---

## 1. Bugs

### 1.1 Probe questions disappear when leaving the Goals screen
Probe questions are stored in the backend, but the Goals screen holds them only in React state; switching screens loses them.
- Open probes reload when the Goals screen (or the goal page) is opened, including partly typed answers (save drafts locally, debounced).
- **Accept:** start a probe, type an answer, go to Library and back, quit and reopen the app: the probe and the draft are still there until submitted.

### 1.2 "Leave session" ends the session for good
The button calls `session.abandon`. The owner expected to continue later and lost the generated cards.
- "Leave session" becomes **Pause**: the session stays active and resumes at the same card with nothing regenerated.
- A separate, less prominent **End session** (with a one-line confirmation) ends it.
- **Accept:** pause mid-session, start nothing else, reopen Session: same card, same history, no model calls on resume.

---

## 2. Answering: one field, voice-first

### 2.1 One answer field everywhere
Replace the separate "answer" and "think aloud" fields (probe, session cards, later practice) with **one field**. The learner answers naturally: just an answer, an answer with reasoning, reasoning without a conclusion, or nothing.
- Empty field = "I don't know". Also a **No idea** button that submits empty.
- Confidence: replace the 0–100 slider with three choices, **A guess · Fairly sure · Sure** (optional; default none). Map to 0.33 / 0.66 / 0.9 internally.
- Tutor, prober and grader prompts: the single field may contain answer and reasoning mixed; a bare answer means reasoning unknown, not reasoning absent; empty means no idea. Grade the answer, diagnose from any reasoning given.
- **Accept:** probe and session cards show one field; submitting empty works and is graded as "no idea" without an error.

### 2.2 Answers are often dictated
The owner dictates with Handy (local speech-to-text that types into the focused field). No dictation feature is needed in the app, but:
- All answer fields must work with text pasted or typed in by another app (no custom input handling that breaks this).
- Tutor, prober and grader prompts state that answers are often dictated: read spoken math ("d a i by d x j", "two by three", "n3 by n0"), fix obvious transcription slips from context ("Jack's" = JAX, "vgps" = VJPs, "atom" = Adam), and never penalize notation or spelling.
- Show a small hint under the field: "Speak or type, however it comes." No microphone button.
- **Accept:** a fake-provider test feeds a dictated-style answer through the grader prompt builder and the prompt contains the dictation instructions.

### 2.3 ⌘↵ submits everywhere an answer is given.

---

## 3. Session: history and layout

### 3.1 The session is a scrollable conversation
The owner wants to see their own answers and previous steps during a session.
- Every step stays on the page in order, like a chat: the card (question or explanation), **the learner's answer exactly as given**, then the rating and rationale, then the next card.
- Completed ideas collapse into one line each ("Jacobian matrix · 8/10"); clicking expands everything from that idea.
- The current step is in focus at the bottom; earlier content is reachable by scrolling up.
- Clicking a done point on the step path, or a node in the lesson map panel, scrolls to that part of the session.
- Session events already exist; render from them so the history also survives restarts.
- **Accept:** after three ideas, all earlier questions, answers, scores and rationales are visible or expandable; restart keeps them.

### 3.2 One thing at a time
- Probe: one question at a time with a progress indicator ("2 of 8"), back/next, not a long scrolling form.
- Session: only the current step is expanded and active.

### 3.3 Leaking internals
The Explain card header showed a truncated internal "why" text ("The Jacobian unlocks 12 targets…"). Show only learner-facing copy. The "why this now" sentence belongs in the side panel (see mockups).

---

## 4. Library and extraction

### 4.1 Render math and Markdown everywhere
Library lists show raw `$...$` LaTeX. Use the same Markdown + KaTeX renderer as the Session screen for every statement anywhere in the app.
- **Accept:** no raw `$` delimiters visible on any screen with the seed graph or an ingested lecture.

### 4.2 Show the reasoning chains
The Library idea list shows no chains, so the owner cannot check the derivations. Each idea shows "built on: A, B" (its chains' premises, each clickable), and ideas that are only premises show "leads to: …".

### 4.3 Order and citations
- Default order: order of appearance in the source, not alphabetical. Keep alphabetical as an option.
- Each idea shows its page or slide citation (e.g. "p 42"), clickable later in M6.

### 4.4 The delta view is misleading before goals exist
"0 are new and learnable now; 22 need a prerequisite first" for a fresh lecture. Change the rule (core, with tests): a node with no chains into it (a root claim, term or procedure) is **learnable now** whether or not a goal targets it. Only nodes with unowned premises "need a prerequisite first".
- **Accept:** ingesting lecture 5 into an empty you-layer reports roots (e.g. "Jacobian matrix") as learnable now.

### 4.5 Things that are not ideas
Observed: "Gradient descent and structure summary" (a summary slide stored as a claim) and "Reverse-mode example: z = x1x2 + sin x1" (a worked example stored as a claim).
- Extractor prompt: summary/recap/outline slides restate ideas, never create new nodes; worked examples are attached to the node they illustrate as an `example` (new field on the node or a separate `examples` table, cited), not stored as claims.
- Teaching uses stored examples (worked example cards, use tasks).
- **Accept:** fixture test with a summary chunk and a worked-example chunk yields no summary node and one example attached to its node.

### 4.6 Missing headline ideas
"Automatic differentiation" itself was not extracted from lecture 5, nor "a reverse-mode gradient costs about one forward pass". Extractor prompt: always extract the source's headline concepts (titles, section names, summary claims) as nodes if they are ideas, and prefer coverage of every distinct idea on the slides over brevity. Remove the "fewer good nodes beat many thin ones" bias; keep the quality rules.

### 4.7 Repeated animation slides (low priority)
Some slide PDFs export each animation build as its own page (lecture 5: 115 pages, about 35 distinct slides; one slide repeated 25 times). Before chunking, collapse consecutive pages whose text is contained in the next page's text; keep the last, keep the page range for citations. Clean script PDFs are unaffected. Skip if short on time.

### 4.8 Page images for slide decks (optional, post-R1)
For slide decks where much is drawn (equations as images, diagrams), an optional mode sends page images to a vision-capable model. Not the default; the owner mostly gets clean script PDFs.

---

## 5. Goals v2 (the largest item)

The current goal is one sentence compiled once against the whole library. The owner's real cases: a **course** (lectures arriving weekly, plus scripts, exercise sheets, past exams), a **personal goal** with own resources (a book, notes), or a personal goal **from scratch** (the agent builds the roadmap from probes). Targets vary: a grade in a written exam, an oral exam, a presentation or project, a concrete outcome, or nothing defined at all.

### 5.1 The goal model
A goal has:
- `kind`: `course` | `personal`.
- `assessment`: `written_exam` | `oral_exam` | `presentation_or_project` | `outcome` | `none`.
- `targetGrade` (free text, e.g. "1.0", German scale allowed) — optional.
- `date` (exam or deadline) — optional.
- `hoursPerWeek` — optional.
- `materials`: sources linked to the goal, each with a **role**:

| Role | Examples | Used for |
| --- | --- | --- |
| `teaching` | lecture PDFs, scripts, book chapters | extracted and taught (as today) |
| `practice` | homework and exercise sheets | problem style; problems reused in practice (M5) |
| `assessment` | past exams, mock exams, grading criteria | exam style, difficulty and format; never taught as content |
| `scope` | syllabus, module description | in/out of scope; predicts upcoming lectures |
| `reference` | own notes, cheat sheets | linked to nodes, for lookup and anchoring |

- Goals with no materials: the compiler builds a roadmap from the goal text and probes; nodes are `unverified` until grounded (as today).

### 5.2 Creating and editing
- **New goal** is a short guided flow (see `docs/mockups/GoalCreate.dc.html`): one sentence, then only the questions it needs (kind, assessment, date, target grade, hours per week, materials with role tags), and a live summary on the right. The role of an added file is guessed by the extractor from its content (exam-like → assessment, exercises → practice) and editable.
- **Edit goal**: a button on the goal page reopens the same flow with current values. Saving recompiles **incrementally** (5.3) and never loses progress.

### 5.3 Incremental compile
- Recompiling must not wipe capabilities and their mastery. When a new teaching source is added to a course goal, the compiler **adds** capabilities and targets for the new material and leaves existing ones (and `mastered_at`) untouched unless they are clearly superseded.
- The compiler sees only the goal's own materials' nodes (plus their premises), not the whole library. Remove the 400-node cut by using the goal's scope.
- `assessment` materials are summarized once into an **exam profile** (format, duration, aids, question types, difficulty) stored on the goal and given to the compiler, prober, planner and (M5) problem generator.
- **Accept:** add lecture 4 to the goal after lecture 5: capabilities from lecture 5 keep their ids and mastery; new ones appear for lecture 4.

### 5.4 Unverified guesses are not taught
The compile invented a generic deep learning syllabus (MLPs, Adam, CNNs, attention) because only one lecture existed; the real course is "Deep Learning in Physics" and may differ.
- Unverified nodes are shown as **expected** ("not in your material yet") and are **never planned for teaching** unless the goal has no materials at all (from-scratch goals) or the learner explicitly starts them.
- When a later source grounds an unverified node (the matcher links them), it becomes verified and normal.

### 5.5 Depth targets
Almost every target came out at depth 3–4. The design says most ideas need 1–2. Compiler prompt: state the expected distribution (roughly 50% at 1–2, 35% at 3, 15% at 4–5 for an exam goal; adjust by assessment: oral exams push explanation depth up, written exams push apply depth up). Add a code-side sanity check that logs a warning when more than 50% of targets are ≥ 3.

### 5.6 How the assessment changes behaviour
Record in `docs/design.md`; implement what touches R1 (prompts, profile) now and the rest in M5:
- **Written exam:** practice shaped by the exam profile; readiness per lecture; mock exams in the last weeks (M5).
- **Oral exam:** practice is explaining aloud; the tutor can act as an examiner with follow-up "why" and "what if" questions; explanation depth weighted up.
- **Presentation or project:** practice is producing the thing (outline, argument, Q&A rehearsal).
- **Outcome:** capabilities are the tasks themselves.
- **None (open-ended):** no endpoint; the planner keeps proposing the next frontier; milestones are checkpoints; periodically asks where to go next.
- **Date:** M5's scheduler plans backwards from it so recall peaks on the date; without a date it paces by `hoursPerWeek`.

### 5.7 The goal page
See `docs/mockups/GoalPage.dc.html`: kind · assessment · date · pace; for courses a lecture timeline (uploaded lectures with ideas owned, the current lecture, expected upcoming lectures from the scope document, the exam); the skills the assessment asks for with Ready / Learning / Not started; this week's plan with "Start today's session"; the exam profile; materials grouped by role; Edit goal.

---

## 6. Probe flow
- One question at a time (3.2), one field (2.1), persisted (1.1).
- After submit, show per question: the score, the one-line rationale, and any misconception noted.

---

## 7. Settings: models and effort

### 7.1 Model picker
Each role field becomes a dropdown of the available models (`claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, plus "Custom…" for free text). The default is shown by name ("Default: Opus 5.5, medium"), never just "default".

### 7.2 Effort per role
Add an effort setting per role: `low` | `medium` | `high` | `xhigh` | `max` (as supported by the provider; check the current Agent SDK and API documentation for how effort/thinking is set and which models accept which levels; hide unsupported combinations). Thread it through `backend/llm/`.

### 7.3 New defaults
Chosen by the owner from a cost/intelligence analysis (Sonnet at low/medium effort is dominated by Haiku at max; Opus at xhigh only for rare, high-stakes calls):

| Role | Model | Effort |
| --- | --- | --- |
| goalCompiler | claude-opus-5-5 | xhigh |
| tutor | claude-opus-5-5 | medium |
| prober | claude-opus-5-5 | medium |
| problemGenerator | claude-sonnet-5-5 | high |
| grader | claude-sonnet-5-5 | high |
| extractor | claude-haiku-5-5 | max (to be confirmed by 7.4) |
| matcher | claude-haiku-5-5 | max |
| planner | claude-haiku-5-5 | max |
| librarian | claude-haiku-5-5 | medium |
| connectionTest | claude-haiku-5-5 | medium |

New role **tutorEscalation** (claude-opus-5-5, xhigh): used once when the edge rules have already dropped a level for an idea and the learner still fails; it re-diagnoses the misconception from the whole history of that idea and writes a fresh explanation.

### 7.4 Model comparison script
`npm run live:compare -- <file> --a <model>:<effort> --b <model>:<effort> [--role extractor]` runs one source (or a fixed set of recorded prompts for other roles) through two settings into temporary databases and prints side by side: node count, chain count, a sample of nodes and chains, input/output tokens, and estimated cost. Used to settle the extractor default. No changes to the owner's real database.

---

## 8. Visual design
Implement `docs/visual-design.md` across all existing screens (Today, Session, Map, Goals, Lookup, Trails, Library, Settings): the Atlas look, dark by default, Geist, the periwinkle accent, the layout grid and the alignment rules. Placeholders for M5/M6 screens use the same layout with a short, plain empty state.

---

## 9. Order of work and done criteria for R1
1. Bugs (1)
2. One answer field and dictation (2)
3. Visual design foundation: tokens, fonts, layout shell, components (8) — before reworking screens, so new UI is built once
4. Session history and one-at-a-time (3, 6)
5. Library and extraction (4.1–4.6, then 4.7 if time)
6. Settings (7.1–7.3), then the comparison script (7.4)
7. Goals v2 (5)

R1 is done when every acceptance check above passes, tests/typecheck/lint are clean, `docs/design.md` reflects the changes, and `docs/progress.md` has a "CHECKPOINT R1 READY" section listing exactly what the owner should try. Then stop for the owner; M5 starts after their feedback.
