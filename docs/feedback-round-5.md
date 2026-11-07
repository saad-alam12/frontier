# Round 5: work in the background, goals by depth, your own sessions, flashcards

The owner's request at the R4 checkpoint (2026-11-07), with the choices made in planning. Built locally on the owner's Mac, one commit per section (`R5 §n: <title>`). Every section must also leave the UI clear and pleasant: the owner asked for very good UI/UX, and for existing screens to be improved where it makes sense (section 7).

Choices the owner made in planning:
- Build here on the Mac, with helper agents.
- A goal without a time limit: the learner picks a level, and the model reads that level together with the goal's context to decide what it means and plans from both.
- Adding ideas to a goal: a fixed time is always kept (the plan makes room). A goal without a time limit grows its estimate instead.
- A free session may have no goal.
- Flashcards are written after an idea is learned in a session, from what the session taught.
- Changing a mapped goal's context proposes a new map to approve (the existing re-map flow).

Rules for everyone building this: read `CLAUDE.md`, `docs/design.md` and `docs/visual-design.md` first. No em dashes anywhere (code, comments, UI copy, docs, commits); use a colon, comma, parentheses or `·`. UI copy is sentence case, plain words, no exclamation marks. No AI attribution in commits. Tests never call a real model (use `FakeProvider`). Never run the app or a script against the owner's data folder (`~/Frontier`, which is this repository folder): use a sandbox (see "Running the app safely" in `docs/progress.md`).

---

## 1. Sessions keep working when you leave

**Problem.** After sending an answer, going to another place in the sidebar (Map, Goals, ...) and coming back loses the "Thinking…" state: the answer looks unsent and sending it again fails with "Still working on your last answer".

**Wanted.**
- Leaving the Session screen while the tutor is thinking, judging, planning the session or starting it never stops that work. It finishes in the background.
- Coming back shows the true state: if the work is still running, the sent answer with "Thinking…" / "Judging…" (and Esc / Stop still works); if it finished, the new card; if it failed, the error and the answer back in the field.
- The sidebar's Session entry shows that work is running (a quiet "Thinking…") and that a new card is ready while you are elsewhere ("Your turn").
- Starting a session (planning can take a while) behaves the same: leave and come back to the session once it is planned.
- Nothing about an answer is written before the model has judged it (as today). Quitting the app mid-way keeps the answer as a draft (as today).

**Acceptance.** Tests: a respond still running is visible in the snapshot with its response; a finished respond emits an event; a failed respond keeps its error for the next read; a second send while one runs is refused without losing the first. Screenshot: send, go to Map, come back, see "Thinking…", then the card.

## 2. Goal context

**Wanted.** An optional free-text **context** on every goal, in the new-goal flow (goal step) and in Edit goal: anything that shapes the goal (reasons, purpose, constraints, focus areas, what to skip). A multi-line field with a plain hint, up to 4,000 characters. The existing one-line "What do you already know about it?" stays.

- The goal compiler reads it on every compile (first compile, incremental compile, re-map, additions in §4). The prober and tutor see it too (one short section in their prompts), so purpose and constraints shape questions and examples.
- Changing the context of a goal that is already mapped asks for a new map: the existing re-map flow (design §3.2 step 7a) with the reason "Your context changed". The learner sees the proposal next to the current map and uses it or keeps theirs. A draft (not yet approved) simply compiles again.
- The goal page shows the context under the goal's sentence (short, expandable).

**Acceptance.** Tests: the compiler prompt contains the context; editing it on an active mapped goal sets a re-map request with that reason; editing a draft recompiles. Screenshot of the goal step and the goal page.

## 3. Goals without a time limit

**Wanted.** A goal can be fitted to a time (as today) or have **no time limit**, where depth matters and time does not.

- The time step in the new-goal flow starts with a choice of two: "Fit it to a time" (today's controls) or "No time limit". With no time limit the learner picks how deep: **Big picture**, **Working knowledge** or **In full** (stored as the goal's wanted level: `intuition`, `working`, `rigorous`), each with one plain line on what it means.
- The compiler gets the wanted level, the goal, its context, assessment, focus and background, and decides what that level means for this goal (the owner: "what big picture or in full means changes with the context, so the model must take both into account"). It maps every idea that understanding needs, no fewer and no more (still 4–80, each idea whole and at most half an hour), and does not size by time. The goal's `level` is the wanted level.
- Every target is planned at its full depth (no budget trims it). The plan step shows the estimate in place of the time control: "About 14 hours · about 19 sessions", with the dots (no "left out").
- The goal page shows time spent and the estimated time left instead of time against a budget; no pace verdict about the budget; ideas ready against the plan as today. "Change the time" becomes a control that can switch between a time and no time limit. Changing the wanted level of a mapped goal asks for a new map (re-map flow), like a context change.
- Adding ideas (§4) adds their estimated time.
- The scheduler and Today handle a goal with no rhythm sensibly (no weekly target; it still gets sessions and reviews). Old goals with no budget (from before R2) are not "no time limit" goals unless the learner chooses it.

**Acceptance.** Tests: budget spending plans no-limit targets at full depth; compile input carries the wanted level and no time section; the estimate is the sum of the costs at the learner's speed. Screenshots of the time step (both choices), the plan step and the goal page of a no-limit goal.

## 4. Add to a goal

**Wanted.** On the goal page, **Add to this goal**: one field, "What else do you want to learn here?". Examples: "How deep learning relates to classical machine learning", "How image generation works".

- The goal compiler runs in an **addition** mode. It reads the request with the goal (sentence, context, level, scope, assessment, focus), its current map, and matching ideas from the library, and judges:
  - **Fit.** Whether it belongs to this goal thematically. If not, it says why in one sentence; the learner can make it a new goal (the new-goal flow opens with the request filled in) or add it anyway.
  - **Breadth or depth, from the wording.** A request about how the goal relates to a whole field gives several broad ideas (each conceptual). A request about one specific aspect gives fewer ideas, each deeper. Both in line with the goal's level.
  - Output: one or more new capabilities (each remembers the learner's words), targeting existing ideas where they exist and new ideas where not. New ideas are teachable at once (like a goal from scratch: added to the goal's started unverified ideas).
- **Preview before anything changes.** What joins (the new skills and their ideas as dots), and what it does to the plan:
  - Fixed time: the time stays. The plan re-fits, and the preview says what changes elsewhere ("To fit your 10 hours, 2 ideas become overviews and 1 is left out"). Ideas the learner asked for weigh more in the budget (× 1.5 on top of core), so the request is not itself left out.
  - No time limit: "+5 ideas · about +2 h 30".
  - Buttons: Add / Cancel. The model call runs in the background with a visible status on the goal page; leaving and coming back keeps it.
- Added skills show a quiet mark "You added this" with the request.

**Acceptance.** Tests: addition input and schema (fit verdict, capabilities with request text, new nodes); applying an addition keeps existing capabilities and approved depths, adds the new targets, marks new ideas started; the preview's diff for a fixed time; requested targets get the extra weight. Screenshots of the field, the waiting state, the preview (fixed and no-limit) and the not-a-fit message.

## 5. Choose what to learn

**Wanted.** Besides the planned session, the learner can **choose what to learn** in a session.

- Entry points: the Session screen when no session is open, Today (next to the planned start), the Map's idea card ("Learn this now") and a goal's idea list.
- A sheet "Choose what to learn":
  1. **What.** Two ways: **Pick ideas** (search the map's ideas, filter by goal, multi-select; each shows yours / learnable now / needs something first) or **Describe it** (free text: "What do you want to learn?").
  2. **Goal (optional).** None, or one goal (pre-filled when started from a goal or an idea of one goal).
  3. **Count this in the goal's time** (a switch, only with a goal; on by default).
  4. **Missing background.** For picked ideas whose premises the learner does not own: "Attention builds on Dot product, which you have not learned yet", with "Add it first" or carry on anyway. For a description, the same warning for the background the model names.
  5. Start. An estimate of the time shows before starting ("about 40 minutes").
- **Describe it** calls a new role, `sessionPlanner` (Session maker), with the description, the goal (if any: its level, context, focus), what the learner owns and the library ideas that match. It returns the session's ideas: existing ideas by id where the map has them, new ideas (name, statement, kind, premises among existing ideas or each other) where not, each lesson-sized, together about one session (45 minutes), each with an aim (depth), plus the level for the session and any missing background. New ideas join the world layer through the merger (the one writer) as unverified ideas taught from the model's knowledge, cited to the session. The session then runs the normal step loop on them.
- **Time.** Counted: the session's time is booked to the goal (it counts as spent on it). Not counted or no goal: booked as **free study**; Stats shows free study as its own line.
- What is learned lands on the map like any session (evidence, the transcript read into ideas and chains). Ideas learned in a free session do not become targets of a goal on their own (that is what §4 is for); goals that need them see them as already yours. A half-done idea of a free session is not carried into a goal's planned sessions.
- Trails show free sessions with what was asked.

**Acceptance.** Tests: a session with no goal starts, teaches and ends; picked ideas with unowned premises produce the warning list; the planner's output is merged as unverified ideas and taught; activity is booked to the goal or to free study as chosen. Screenshots of the sheet (both ways, with a warning), a free session in progress and Stats with free study.

## 6. Flashcards

**Wanted.** Flashcards for **hard facts that must be memorized**, and only those: formulas, exact definitions, notation, constants, names, dates, numbers. Never understanding, reasoning or "why": sessions and practice build those. This changes design §5.2 ("retention without flashcards"); the design is updated to say flashcards are kept for hard facts.

- **Per goal settings** (new-goal flow and Edit goal): "Make flashcards for me" (on by default) and "At most N cards" (default 40). Free sessions with no goal use a default in Settings (on).
- **Automatic cards.** When a session finishes an idea (it reaches its aim or wraps up), a background call (`cardWriter`, Card writer) reads the idea, what the session taught about it and the learner's answers, the goal's level, and the idea's existing cards, and writes 0–3 cards for its hard facts. Zero is a normal answer. Code enforces the goal's maximum (it asks for at most what is left and never stores more).
- **A card**: front (the question) and back (the answer), Markdown with KaTeX; tagged with one or more ideas; the goal it was made in (if any); its origin (automatic, from a selection, from a request, written by hand). Scheduling is FSRS (`ts-fsrs`); reviews are append-only.
- **Cards** becomes a place in the sidebar (with Today, Goals, Map, Stats).
  - **Review**: the due cards, of all goals or one goal. Front, then Show answer (Space), then Again / Hard / Good / Easy (keys 1–4), each showing when the card comes back. New cards enter at most 20 a day. A plain finish line when the queue is empty.
  - **All cards**: browse and search by goal and idea; edit, delete, suspend; "Show on map".
  - Today shows "N cards to review" when there are some (not the main action unless nothing else is due).
- **Sessions count as practice.** When the tutor judges an answer, it sees the cards of the current idea and of the ideas the step builds on. A card whose fact the learner recalled correctly and unaided (not shown on the card being answered) gets a "Good" review (source: session). The practice grader does the same. Wrong answers do not count against a card.
- **Making cards in a session.**
  - Selecting text in any message shows a small bar: **Reply** (when an answer box is open) and **Make a flashcard** (always). Make a flashcard opens a sheet: the card writer drafts a card from the selection and its message, deciding whether the selection is the question or the answer (a selected attention formula becomes the answer to "State the attention formula and define its terms", with short definitions). The learner edits front and back (with a preview), sees and changes the idea tags (default: the current idea) and saves. Esc cancels.
  - A **Make a flashcard** button in the session opens the same sheet with "What should the card ask?" first.
  - In the Cards screen and on an idea's card: write a card by hand (or "Draft it for me").
- **Map.** An idea's card on the Map lists its flashcards (front; back on click; when due) with "Add a card". The view panel gets a filter "Only ideas with flashcards", and the tooltip counts an idea's cards.
- **Goal page**: a quiet line "23 flashcards · 5 to review", with Review.
- **Erasing** an idea from the map removes it from its cards' tags; a card left with no idea is deleted.
- Review time is logged as activity (booked to the card's goal when it has one) and shows in Stats.

**Acceptance.** Tests: FSRS scheduling of reviews; the goal's maximum is never exceeded; the card writer's schema (0–3 cards, front/back, tags); session judgement marks recalled cards as reviewed; erasing an idea removes tags and orphan cards; the new-cards-per-day limit. Screenshots of the Cards screen (review front and back, empty queue, all cards), the make-a-flashcard sheet from a selection, the map card with flashcards, the goal settings.

## 7. A finished, clear app

After the sections above, one pass over every screen in the running app (sandbox data): consistent spacing, type and controls (`docs/visual-design.md`), clear purpose for every control, good empty and loading states, keyboard and focus, and nothing rough. Fix what is unclear or unfinished in existing screens too. Update `docs/visual-design.md` for new components, `docs/design.md` for every behaviour change, and `docs/progress.md` with the R5 summary and "CHECKPOINT R5 READY" with exact steps for the owner.
