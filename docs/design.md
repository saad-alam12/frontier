# Frontier — Final Design

Status: final design, 2026-10-26. This is the source of truth for what Frontier is. `docs/build-plan.md` says in what order it gets built.

Frontier is a desktop learning app. An AI does all the logistics of learning (what to learn next, from what, in what order, when to practice) so the learner spends effort only on the thinking that builds lasting understanding. It is built around three ideas:

1. **A two-layer knowledge map.** A world layer of true claims connected by reasoning chains, and a "you" layer on top that records what this learner owns, how deeply, and how fresh.
2. **Goals pull the learning.** The learner states goals; the system compiles them into the claims, depth and practice tasks needed, and always works at the edge of what the learner can learn next.
3. **Encode well once, maintain through use.** Teaching front-loads the effort that makes first-pass memory work; understanding is maintained by goal-shaped practice that reuses many fading ideas at once, and flashcards are kept only for the hard facts that must be known by heart.

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
- **Chain simplification** (deterministic, at merge time): drop a chain when a kept chain for the same conclusion has a strict subset of its premises. Nothing else is redundant: a route that runs through ideas another route is built on is kept, because a learner who owns the premises of either route can learn the idea. A new chain that would close a circle (its conclusion is already something one of its premises is built on) is not stored, since two ideas that each wait for the other could never be learned.
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
  - **From evidence to freshness.** Answers on one idea that follow each other within four hours are one **sitting**, and a sitting is one review, scored by the mean of its graded answers. The prediction is left out: it is made before the idea is taught, so missing it is expected. The memory model (FSRS) is given the real time since the last review, not calendar days. A sitting below the pass mark (0.7) is a failed recall and never lengthens the time until the idea comes back: below 0.4 it is a full lapse, from 0.4 it hits an idea reviewed before half as hard. A lookup shows the answer, so it is never a review.
  - **Losing depth.** Depth is the highest level a passing answer certified. One clear failure (a sitting below 0.4) only lowers freshness. Clear failures in two sittings in a row, at least twelve hours apart, lower the depth one level, so the idea goes back into the plan and is taught again; a passed sitting in between starts the count again, and a later pass earns the depth back.
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

When a node gets passing `use` or `practice` evidence, its premises get partial review credit along chains, decaying by a factor per hop (default 0.5, max 2 hops). A failed task gives none: it says nothing about which premise failed. Several tasks in one sitting that used the same premise are one light review, at the strongest link. This lets advanced practice pay off reviews of the basics it contains (the idea behind Math Academy's "fractional implicit repetition").

### 2.6 Flashcards (you layer)

Flashcards hold the hard facts that must be known by heart because they cannot be worked out on the spot: formulas, exact definitions, notation, constants, names, dates, numbers. Understanding, reasoning and "why" never become cards; sessions and practice build those.

- **Card**: `{ id, front, back, ideas[], goalId?, origin, sessionId?, suspended }`. The front is the question and the back the answer, both Markdown with KaTeX. `ideas[]` (one or more) are the ideas the card is about. `goalId` is the goal it was made in: the session's goal, none for a session without a goal, and for a card written by hand the one active goal that holds its first idea (when exactly one does). `origin`: `auto` (written after a session finished an idea), `selection` (from selected text), `request` (from "What should the card ask?") or `hand`.
- **Review** (append-only): `{ cardId, at, rating, source }`, rating Again, Hard, Good or Easy; `source`: `review` (the Cards screen), `session` or `practice`. A card's FSRS schedule is derived by replaying its reviews (`ts-fsrs` with its short learning steps, so a card missed in review comes back within minutes in the same sitting). Editing a card keeps its schedule.
- **Automatic cards.** When a session finishes an idea (it reached its aim or wrapped up), the card writer reads the idea, what the session taught about it, the learner's answers, the goal's level and the idea's existing cards, and writes 0–3 cards in the background; zero is a normal answer. Each goal says whether it makes cards and at most how many (on and 40 by default; only automatic cards count). Code asks only for what is left, counts again when the cards arrive, and drops a card that asks what an existing card of the idea already asks. A session without a goal makes cards when Settings allow it (on by default), with no total limit.
- **Use counts as review.** When the tutor or the practice grader judges an answer, it sees the cards of the idea (and of the ideas it builds on) and names those whose fact the answer stated correctly and unaided (the question did not give it). Code records a Good review for each, at most once per card in twelve hours, so one session asking for a fact on several steps counts once. A wrong answer never counts against a card.
- **Review queue.** Due cards still in their learning steps first, then due reviews (most overdue first), then new cards (oldest first). At most 20 new cards a day enter the queue; a card first recalled in a session does not use up a place. When nothing else is due, a card in its learning steps due within 20 minutes comes early, so a sitting can finish.
- Erasing an idea removes it from its cards, and a card with no idea left is deleted. Reading a source again keeps the ideas that have cards. A suspended card stays but is never reviewed or judged.

---

## 3. Goals

The learner never picks topics; they state goals.

### 3.1 The goal

A goal has the learner's sentence, a short `title` (set by the compiler), and:

- `kind`: `course` (lectures arriving over a term, plus scripts, exercise sheets, past exams) or `personal` (own resources, or none at all).
- `assessment`: `written_exam` | `oral_exam` | `presentation_or_project` | `outcome` | `none`.
- `targetGrade` (free text, e.g. "1.0") and `date` (exam or deadline), both optional.
- `budget`: the time the learner gives the goal (section 3.4), or **no time limit** with a `wantedLevel` instead: how deep they want it (Big picture, Working knowledge or In full; stored as `intuition`, `working`, `rigorous`). A goal has one or the other, never both; goals from before time budgets have neither and keep working as before.
- `focus`: what kind of understanding they want: conceptual understanding, mathematical rigour, practical application (including code), any mix; none means balanced.
- `coverage`: whether the goal's material covers the goal (`complete`, `partial`, `fragment`), judged by the compiler on the first compile with material.
- `background`: what the learner says they already know about it, in a line ("Python yes, never seen a matrix"); optional.
- `context`: anything else that shapes the goal, in the learner's words and as many lines as it takes (up to 4,000 characters): why they want it, what it is for, constraints, areas to focus on, what to skip; optional. The compiler reads it on every compile, re-map and addition and treats it as the learner's brief; the prober and the tutor see it too, so purpose and constraints shape questions and examples. The goal page shows it under the goal's sentence, two lines with More.
- `level` and `scope`: what the goal means for its time, judged by the compiler. The same sentence is a different goal at different times: "understand how LLMs work" in 10 hours for a learner without linear algebra is the big picture in plain words; in 200 hours it is the machinery. `level` is `intuition` (plain words and pictures, no formulas), `working` (the key notation and formulas, explained and used) or `rigorous` (definitions, derivations, proofs), chosen from the time, the purpose (an exam needs what the exam asks) and the background; `scope` says in one or two plain sentences what the learner will be able to do and what is left out. Both show on the plan step and the goal page. With no time limit the level is the learner's wanted level; the compiler decides what it means for this goal, read with its sentence, context, focus, assessment and background (the big picture of a subject for a talk to one's team is not the big picture for an exam), and the scope says what that depth gives.
- `status`: `draft` while it is set up and its plan previewed, then `active` once the learner approves the plan (or `paused`, `done`).
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

1. **Goal to capabilities.** The Goal Compiler reads the goal for its time, purpose, context and the learner's background (level and scope, section 3.1) and turns it into can-do statements, each testable by a task, shaped by the assessment (below) and the focus. The map is sized to the time: about one idea per half hour of budget, plus a fifth so the plan can choose (4–80 per compile), each idea whole and learnable in one sitting of at most half an hour, written at the chosen level. It sees the goal's material, the premises it builds on, and the ideas the learner already knows or another goal holds, so overlap is targeted rather than re-created.
2. **Capabilities to target nodes.** Each capability maps to the nodes it needs and the depth each needs. Fewer ideas understood beat many recognized: most targets are depth 2 (explain), depth 1 is for names, facts and context, depth 3 for the results the goal turns on (at the working or rigorous level), 4–5 for the few procedures every task uses. About a third at most are marked **core** (the goal fails without them); core ideas are planned first. Code logs a warning when more than half are at 3 or more. The compiler sees only the goal's own material (plus the premises its ideas are built on), never the whole library.
3. **Unverified ideas.** Ideas the goal needs but no material covers are created as `unverified` and shown as **expected** ("not in your material yet"). They are not taught unless the goal has no material at all (a goal from scratch), the goal is a personal one whose material covers only part of it (`partial` or `fragment` coverage: the compiler built the rest of the map, and the material grounds the parts it covers), or the learner starts one explicitly. A course's expected ideas wait for its lectures. When a later source covers one (the matcher links them), it becomes verified.
4. **Incremental compile.** Adding material or editing the goal recompiles incrementally: existing capabilities keep their ids and mastery; the compiler adds capabilities and targets for what is new, extends existing ones, and retires one only when a new one clearly supersedes it. Reading new material, summarizing assessment and scope material, and recompiling run in the background as material arrives.
5. **Exam profile.** Assessment material is summarized once into an exam profile stored on the goal and given to the compiler, prober, planner and (M5) problem generator. Scope material yields the upcoming lectures.
6. **Gap analysis.** Target nodes are diffed against the you layer.
7. **Diagnostic probe.** A short probe tests the highest-information nodes (most dependents). A correct derivation of a node implies its premises at lower depth, so a few questions place the learner across a whole topic. Questions come one at a time; the learner answers in the one answer field (section 4.4), so any reasoning they give is there to diagnose. After submitting, each question shows its score, a one-line rationale and any misconception noted.
7a. **Re-maps.** The probe and the tutor note **missing background**: a foundation the goal's ideas rest on that the learner plainly lacks (not a slip), with rough hours to learn it. Under an hour, the tutor handles it idea by idea (section 4.3). More than that, and the goal's map is drawn again in the background as a **proposal**: when the missing background fits in a quarter of the time left, the new map adds it as core ideas first; when it does not, the new map is gentler (usually the intuition level), chosen to give a usable understanding without it, and suggests a separate goal for the background. The learner can also ask for a new map (goals mapped before levels existed offer it), and changing a mapped goal's context asks for one ("Your context changed"). A draft has nothing approved yet, so a changed context simply maps it again, with its last map as a guide. A request made while a map is being drawn is drawn after it, never lost. The proposal is never applied on its own: the goal page and Today show it next to the current plan (same time, sessions and ideas each gives, the new scope and dots), and the learner uses it or keeps their map; gaps already proposed are not proposed again. Using it replaces the goal's capabilities, and its plan becomes the approved one.
7b. **Adding to a goal.** On the goal page the learner can add to a goal in their own words ("What else do you want to learn here?"). The goal compiler runs in an **addition** mode in the background (the goal worker; leaving the page does not stop it, and the page shows that it is working). It reads the request with the goal (sentence, context, level, scope, assessment, focus), its current map, its ideas and the library ideas that match the request (by meaning and name, as Lookup finds them), and judges whether the request belongs to the goal (when not, it says why in one sentence) and, from the wording, whether it asks for breadth (how the goal relates to a field: several broad ideas) or depth (one aspect: fewer, deeper ideas), at the goal's level. It writes one to five capabilities that keep the learner's words, targeting existing ideas where they exist and new (unverified) ideas where not. Nothing changes until the learner says yes: the preview shows the new skills, their ideas as dots and what the addition does to the plan. A fixed time stays, so the plan makes room ("+5 ideas · your 10 hours stay: to fit them, 2 ideas become overviews and 1 is left out"); with no time limit the estimate grows ("+5 ideas · about +2.5 hours"). Adding keeps the existing capabilities and their approved depths; the new targets join the approved plan at the depth the plan gives them, and the new ideas are taught from the model's knowledge at once (started, as in a goal from scratch). Added skills carry a quiet "You added this" with the request. A request that is not a fit offers "Make it a new goal" (the new-goal flow opens with the request as its sentence) or "Add it anyway". One proposal at a time: a goal waiting on a new map takes no additions, and a re-map waits while an addition is open.
8. **Task ladder.** Each capability gets a ladder of authentic tasks from easy to hard (practice rungs, section 5).
9. **Mastery** of a capability = an unaided fresh task at the required rung and cue distance, scored at least 8/10. A capability shows as Ready (mastered, or every target at its depth), Learning or Not started.

Goals have priority weights and can change anytime; recompiling reuses everything already learned.

A new goal is set up in four steps, one decision each: the goal (sentence, kind, assessment, date and grade, focus, background, context), its material (optional), its time (fit it to a time, or no time limit at a chosen depth), and the plan that time or depth buys (with whether it makes flashcards and at most how many, section 2.6; Edit goal has the same). After the time step the goal exists as a draft and is compiled in the background; the plan step shows how many sessions and ideas the plan comes to, the ideas as a field of dots (in depth, overview, already yours, left out, shared with another goal; hovering or focusing a dot names the idea, its skill and what the plan does with it) or, with one click, as a list: every idea by name in an order it can be learned in (what it is built on first), with what the plan does with it, its minutes and the sessions it would fall in, then what is already known and what is left out. The sessions in the list are a rough guide; each real session is chosen when it starts, and the time control, which re-plans live. The learner approves the plan, or maps more ideas when the time holds more than the map. With no time limit the time control's place shows the estimate instead ("About 14 hours · about 19 sessions"), and nothing is left out.

### 3.3 How the assessment changes behaviour

- **Written exam:** capabilities are what the exam asks on paper; practice is shaped by the exam profile; readiness per lecture; mock exams in the last four weeks (M5).
- **Oral exam:** practice is explaining aloud; the tutor can act as an examiner with follow-up "why" and "what if" questions; explanation depth is weighted up.
- **Presentation or project:** practice is producing the thing (outline, argument, Q&A rehearsal).
- **Outcome:** capabilities are the tasks themselves.
- **None (open-ended):** no endpoint; the planner keeps proposing the next frontier; milestones are checkpoints; it periodically asks where to go next.
- **Date:** the scheduler (M5) plans backwards from it so recall peaks on the date; the daily minutes come from the budget's weekly rhythm (section 3.4).

The assessment shapes the compiler (capabilities, depth distribution), the prober and planner (exam style), the problem generator (exam style and the goal's exercise sheets) and the scheduler (the exam date pulls reviews forward so recall peaks on the day; mock exams open four weeks before a written exam).

### 3.4 Time budgets

The time a goal gets decides its plan. 80/20 is the rule: with little time, the few ideas that matter most, learned properly; with more, more ideas and deeper. The time is respected: the plan never holds more than the time left.

**Giving time.** Three forms, each resolving to one true total:

| Form | Example | Total |
| --- | --- | --- |
| Total | "20 hours" | 20 h |
| Rate for a length | "10 h a week for 6 months", "6 h a day for 2 weeks" | rate × length (a rate needs a length: 2 h a week for a month and for a year are different plans) |
| Per teaching resource | "2 h per lecture" | hours × teaching resources (at least one), growing as lectures arrive |

A rate (or a total with a date) also gives a weekly rhythm, which sets the scheduler's daily minutes and the "this week" target. The rhythm counts from when it began: the goal's approval, a new time, or the goal being taken up again after a pause. For a total with a date it is what was left then, spread to the date, never more than what is left; once the date has passed there is no rhythm. The budget can change at any time (a course that turns into cramming: 6 h a day for two weeks); the plan follows at once.

**Cost of an idea.** Minutes of goal time to raise an idea one level, all in (the session's cards, a share of the practice that keeps it, some slack): 7, 18, 5, 8, 8 for depths 1–5, so recognizing costs 7 minutes (an index pass), explaining 25 in all and deriving 30 in all; applying and transferring come from practice over time. Terms cost half. A first-level surcharge covers premises no plan holds that have to be owned first (25 minutes each, charged once however many planned ideas rest on the premise). A learner speed factor (session time ÷ the model's estimate for what was learned in it, within 0.6–2.5, after an hour of sessions) scales every cost, so plans adapt to how fast this learner learns. It is one number over every goal that is not a draft, so pausing or finishing a goal does not change it. Practice and flashcard time keep what is known and do not count toward it, and what a probe shows the learner already knew joins the goal's baseline instead of counting as learned.

**Spending the budgets** (`core/budget.ts`, deterministic). Every active goal's remaining budget (total minus time already spent on it) is spent on idea levels, best value per minute first. A level's value is the sum over the goals that want it of goal priority × part weight × core weight (2 for core targets) × requested weight (1.5 for ideas the learner asked to add, on top of core), × (1 + log(1 + centrality)), × the level's value (0.35, 1, 0.45, 0.25, 0.15 for depths 1–5). Explaining is worth more per minute than recognizing, so an idea climbs to the depth the goal asks once its first level is bought: the most useful ideas (core, and foundations many ideas build on) are learned properly before more ideas join, and what the time cannot buy is left out rather than skimmed. An idea several goals want is paid once, its cost split between the goals that can afford their share; a goal with no time left still gets an idea another goal pays for. What the learner already knows is free. Each target's **planned depth** (its ideal depth trimmed to what the time buys; 0 when left out) is stored with the target, and everything downstream (planner, probe, scheduler, tiers) works from planned depths. The compiler's ideal depths are kept, so more time later restores them. Goals without a budget get every target at its full depth. A part the learner keeps adding material on weighs more (1 + 0.15 per extra source covering an idea, up to 1.6), so the plan drifts toward the learner's interest without a rebuild.

**No time limit.** A goal can be sized by depth instead of time (section 3.1). The compiler then maps every idea the wanted level needs for this goal, no fewer and no more (still 4–80, each whole and at most half an hour), and does not size the map by time. Every target is planned at its full depth (no budget trims it; simplified ideas keep their caps), and the plan's minutes, the sum of the costs at the learner's speed, are an **estimate**: the goal page shows time studied and about how much is left instead of time against a budget, sessions left and ideas ready as usual, and no pace verdict. It has no weekly rhythm, so the scheduler gives it the plain 40-minute day and Today no weekly target; it still gets sessions and reviews. "Change the time" switches between a time and no time limit: a new amount of time re-plans the same map, while a switch (either way) or another wanted level re-plans at once and asks for a new map to approve, as a context change does (section 3.2, step 7a).

**Shared ideas.** One idea is one idea everywhere. Calculus needed by a physics course and a deep learning goal is learned once, in whichever session gets to it first, and costs each goal half. Once owned, other goals assume it: the planner never re-teaches it and the probe does not ask it again; sessions and problems for those goals build on it as known. If the learner clearly fails it in two sittings on different days, anywhere, its depth drops one level for every goal that uses it, and it is taught again (section 2.2); a single failure only brings it back sooner in practice.

**Re-planning.** The plan is recomputed after compiles, merges, goal edits, probes, finished sessions and practice sets. It always fits the time that is left, so time spent slower than planned trims the plan. It never goes deeper than the plan the learner **approved**: each target keeps the depth it had when the learner approved a plan (approving a draft, changing the time, a new map), and automatic re-plans stay at or under it. Learning faster finishes the goal early; going deeper is the learner's choice (changing the time, or going deeper on an idea). When the approved plan no longer uses its time (the learner knew part of it already, or learned it faster), the goal page says what the same time would now hold ("4 more ideas and 2 in more depth") and offers "Use the time": the plan is approved again from the goal's ideal depths, so ideas it had left out or kept shallow come back as far as the time reaches. Nothing changes until the learner says so.

**Simplified ideas and going deeper.** An idea simplified in a session (section 4.3) keeps its ideal depth; the plan holds it at what was learned. It is marked wherever the idea shows (plan dots, the goal's skills, the map card, Today for its goal), with why. At any time the learner can **go deeper** on one idea or all of a goal's simplified ideas: the minutes it takes (the cost model from the current depth to the ideal, at the learner's speed, rounded up to five) are added to the goal's time as extra minutes, on top of the time as they gave it, so the rest of the plan stays; the mark is cleared and a session on those ideas opens (its plan is chosen, not planned: the ideas at the depth the goal asks, after any premises they still need; like any chosen session it has no recall from last time and no practice at the end, and the goal's planned sessions do not carry from it). For an assessed goal the goal page says how many ideas are simpler than the exam asks.

**Progress and pace.** Each goal shows ideas ready against its plan, time spent against its total, this week against its rhythm, time per lecture against a per-lecture budget, and sessions left (planned minutes ÷ 45). Time on an idea held by several goals is split between them. The goals a span of time belongs to are stored with it when it is logged, so minutes already spent do not move when a goal is added, paused, finished or removed later; Stats keeps the time of removed goals under "Removed goals". The pace verdict says something only when it is clear: behind on hours (two weeks in, under half of what the rhythm asked), slow (after an hour and a fifth of the budget, learning takes more than twice the estimate), fast (under half), otherwise on track or nothing. When the plan is trimmed, the goal says how much more time would cover it fully.

**Activity log.** Time is logged as the learner works: the renderer ticks every 15 seconds while the window has focus and there was input in the last three minutes (60 seconds at most per tick), and each tick is booked to what they are doing (the session's goal and current idea, the practice set, the probe's goal, the goal of the flashcard being reviewed, or a screen that is not study). Continuous ticks become one span. Time in a session the learner chose (section 4.5) and did not count toward a goal is booked as **free study**: it belongs to no goal's time, not even through the goal's ideas it touched, and Stats shows it as its own line. Events go into the same log: goals created and approved, budget changes, material added, sessions started and ended, practice sets done, lookups, and every change of an idea's depth. Stats (section 10) is built from this log and the evidence.

---

## 4. Teaching: the session

A session serves at most one goal. A planned session serves its goal: the learner presses "Start session" and the system has already chosen what to do. The learner can also choose what to learn themselves, with or without a goal (section 4.5).

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

The loop is fitted to the idea's **aim**, the depth the plan asks of it, and stops there: an idea planned only to be recognized gets a short **index pass** instead (gist, where it sits on the map, one recognition check); one planned to be explained runs predict, explain, check, compress; one planned to be derived adds a **derive** check (rebuild it from its chain's premises) and connect; apply adds use. An idea the learner already explains, taken deeper, goes predict, explain, then the deeper check. The tutor is told the aim, the goal's level and scope, and never goes deeper because there is time.

**Asking the tutor.** While a card is open the learner can ask the tutor something: a question in their own words on any card, and on a card that explains (an explanation, a worked example, "another way in") also "Explain it differently", "Simpler" and "Show an example". The answer appears under the card, short, at the goal's level, anchored in what the learner holds. It is not graded and writes no evidence; the card and an unsent answer stay as they are. When the open card is a question the learner has not answered, the tutor is told not to answer it or settle it, only to clarify. What was asked and answered stays in the conversation and the trail, and the tutor's words count as taught material (the transcript, the card writer).

**Hints.** On a question (check, derive, use) the learner can take up to two hints instead of giving up: the first points the way (which idea or premise to reach for), the second gives the first step of the reasoning; neither states the answer. An answer given with hints is not an unaided one, so it counts for less: its score times 0.85 with one hint and 0.7 with two, in the evidence and in what the loop does next. The conversation keeps the tutor's own score for the answer and says what it counts as.

### 4.3 Session rules

- **Stay at the edge.** A missed prediction is no failure: it is a guess made before the idea is taught. A missed question (check, derive, use; anything below a pass) is asked again once in a fresh version, after the feedback has said what was missing, before the loop moves on. Three failures in a row → drop a level (worked example, or a prerequisite node). A failure after that worked example → escalate once: a stronger model re-diagnoses the misconception from the idea's whole history and explains afresh.
- **Check off what is known.** A strong answer is a high score (0.85+) given as at least fairly sure. A strong prediction, or two strong answers in a row, jump to the one question that shows the aim (a test-out); passing it strongly ends the idea. "I know this, test me" on a prediction or explanation does the same. A failed test-out goes back to teaching where the jump left off, once: a later miss on the same question is an ordinary miss and counts toward the worked example.
- **Half an hour per idea.** Each idea gets at most 30 minutes (what the plan prices it at for this learner, at least 10), measured from the activity log. When the learner is clearly missing what the idea needs (the tutor names a missing prerequisite, not a slip; or two failures in a row or a worked example, past 60% of the time), the idea is **simplified**: its aim drops to explaining, the tutor re-teaches its core intuition in plain words with no formulas, and the goal's ideas built directly on it that were planned to be derived or deeper are capped at explaining too ("Simplified with …"). When the time is up, the idea wraps up: one last step in the learner's own words, then on. An idea that ends below its aim is kept at the depth it reached and marked simplified with why; only the idea itself, not the ideas built on it, and only when the session's own goal asked for more than was reached. A session's steps certify up to applying, so an idea planned for transfer is not short of its aim when it ends at applying: transfer is shown in practice. Simplified ideas keep their ideal depth, so the learner can go deeper later.
- **Sessions fit 45 minutes.** The planner sees each candidate's minutes and the session's length; code adds the ideas a chosen idea is built on that the learner does not own yet, orders everything by what builds on what, and keeps the ideas in order while they fit (always at least one).
- **At most one goal per session.** Interleaving happens across sessions.
- **Pause, don't lose.** Leaving a session pauses it; it resumes at the same card with nothing regenerated. Ending a session early is a separate, deliberate action that still keeps the learner's place: the next session on the goal recalls the ideas finished in it and continues a half-done idea at the step where it stopped, with the earlier answers shown. Unsent answers are kept as drafts.
- **Work goes on when you leave.** Planning a session, starting it and judging an answer run in the background: going to another place never stops them. Coming back shows the true state: the answer as it was sent with "Judging…" (Esc or Stop still works while the answer can be stopped), the new card once it is there, or the error with the answer still in the field. The sidebar's Session entry says "Thinking…" while work runs and "Your turn" when a card arrived (or an answer failed) while the learner was elsewhere. A second answer is refused while one is judged, and the first is never lost. A failure is kept until the next answer replaces it or the session ends; a failed start is shown once on the Session screen, then dropped. When the answer was already judged and saved and only the call after it failed (the next card, or the next idea's first card), the session keeps the answer and owes the card: "Try again" writes it, and nothing is graded twice. The session is saved as owing that card before the call is made, so quitting the app or a crash during the call ends in the same place. Ending a session while its work runs stops that work: nothing more is written to it. The answer's draft is deleted only when the answer is accepted; quitting mid-way keeps it.
- **Passive reading is never the default.** Reading is raw material for the step loop.
- **Grounding.** Every taught claim cites a source the learner added, a fetched reference, or is marked `unverified` until checked.

### 4.4 Answering

Every answer (probe, session card, practice) goes into **one field**. The learner answers naturally: a bare answer, an answer with reasoning, reasoning without a conclusion, or nothing. An empty field (or the "No idea" button) means "I don't know" and is graded as such, never as an error. Confidence is optional and has three choices: a guess · fairly sure · sure (stored as 0.33 / 0.66 / 0.9). ⌘↵ submits. While an answer is being judged ("Judging…"), Esc (or Stop) stops the model and puts the answer back in the field to edit and send again; nothing about the answer is written until the model has judged it. This covers session cards, free recall and the probe; practice shows its solution on submit, so it has nothing to stop.

Answers are often dictated by a speech-to-text tool that types into the focused field. The field is a plain text input so this works; every model that reads answers is told to read spoken math ("d a i by d x j"), fix obvious transcription slips from context ("Jack's" = JAX) and never penalize notation or spelling. A bare answer means the reasoning is unknown, not absent.

In a session (teaching steps and the start and end recall) an answer may also carry **images** (pasted, dropped or picked: png, jpeg, gif or webp, at most 4 of 5 MB each) and **one quote**: the learner selects text in any earlier message and presses Reply, and the quote shows above the field. The same selection always offers **Make a flashcard**: the card writer drafts a card from the selection and its message, deciding whether the selection is the question or the answer (a selected formula becomes the answer to "State the ... formula and define its terms"), and the learner edits it before saving (section 2.6). A Make a flashcard button in the session asks "What should the card ask?" first. The tutor sees the images of the answer it judges and is told which part the learner replies to. An answer that is only images is an answer, not "no idea". Images are stored once each in the data folder's `attachments/` folder, named by their content hash; the session keeps only their names. Practice answers do not take images or quotes yet.

---

### 4.5 Sessions you choose

Besides the planned session, the learner can choose what a session teaches: from the Session screen when no session is open, beside the planned start on Today, with "Learn this now" on an idea's card on the Map, and with "Learn these now" on a goal's skill. A sheet, "Choose what to learn", asks:

1. **What.** **Pick ideas**: search the map's ideas, filter by goal, and choose up to six; each shows whether it is yours, learnable now or needs something first. Or **Describe it**: a sentence or two on what the learner wants to learn, which the **session maker** turns into a session (below).
2. **Goal** (optional): none, or one goal, filled in when the sheet opens from a goal or from an idea only one goal holds.
3. **Count this in the goal's time** (with a goal; on by default). Counted, the session's time is the goal's (section 3.4); otherwise, and always with no goal, it is free study.
4. **Missing background.** What the chosen ideas build on that the learner does not own and the session does not teach, computed in code from the chains (for each idea that no chain makes learnable, the premises of the chain with the fewest missing; an idea taught only as an overview needs none), plus what the session maker names: "Nash equilibrium builds on Best response, which you have not learned yet", with **Add it first** (it joins the session before the ideas that need it) or start anyway.
5. **Start**, with the estimate shown first ("About 40 minutes · 3 ideas").

**The session maker** reads the description, the goal (its sentence, level, scope, focus and the background the learner gave), the ideas on the map that match by meaning and name (and the goal's ideas), and what the learner owns. It returns the session's ideas in teaching order: existing ideas by id where the map has them, new lesson-sized ideas (name, statement, kind, premises among existing ideas or each other) where it does not, each with an aim (overview, explain, derive, apply) and a one-line why; together about one session of 45 minutes, at most six ideas; a title and a short summary; the level of the session (intuition, working, rigorous); and up to three pieces of missing background. The call runs in the background: the sheet can close and shows the result when it opens again; a changed description or goal asks for a new one. The result is kept until the learner starts it or asks again (not across a restart).

**Starting.** The plan is chosen, not planned: the ideas in dependency order, each at its aim (a picked idea goes as deep as the goal asks, or any active goal with no goal chosen, else to owning it; an idea the learner already has goes one level further). The session maker's new ideas join the world layer through the merger (the one writer), as `unverified` ideas taught from the model's knowledge and cited to the session ("From your session of 7 November"); a new idea with the same name as one on the map is that idea. Then the session runs the normal step loop. With no goal the tutor's goal is what was asked, studied for its own sake, at the session's level; with a goal it is the goal's frame plus what was asked. A chosen session has no recall from last time and no practice at the end, does not simplify the goal's ideas or note gaps for its map, and its half-done idea is never carried into the goal's planned sessions; a planned session recalls and carries from the goal's last planned session, skipping chosen sessions in between, even counted ones. What is learned lands on the map like any session: evidence, and the transcript read into ideas and chains. Ideas learned in a chosen session do not become a goal's targets on their own; goals that need them see them as already yours. Trails show what was asked.

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

### 5.2 Retention: practice first, flashcards for hard facts

Target: under 10% of learning time feels like review.

1. **Implicit credit** (section 2.5).
2. **Compound practice sets.** When nodes drift toward their FSRS due date and no upcoming task uses them, the scheduler groups them into sets whose problems each need several fading nodes together (rung 3–4). One problem refreshes several nodes and builds links between them.
3. **Goal tasks double as review.** As a capability matures, its problems move toward rung 3–4, cue 2, Application: the learner's actual goal tasks.
4. **Reconstruction warm-ups** (session start).
5. **Bugs** get targeted contrast problems until they stop reappearing.
6. **Practice you ask for.** On a goal's page a skill offers "Practise this skill now": new problems on the ideas of that skill you have already learned, whether or not they are fading, at a level you choose. "As planned" is what the schedule would write. "Easier" keeps the lesson's own framing and gives a single idea as a half-solved problem to finish (rung 1). "Harder" moves to a far, real-world setting and makes several ideas a path-finding problem (rung 4). Ideas not learned yet are for a session.
7. **Missed problems come back.** An idea whose latest practice answer scored below the pass mark is listed on the goal's page ("N ideas from problems you missed") with "Practise again". That writes new problems on those ideas, never the old ones again, and a pass takes the idea off the list.
8. **Flashcards for hard facts** (section 2.6): formulas, definitions, notation, constants, names and dates, written after an idea is learned, reviewed on their own (FSRS, a few minutes a day) and counted as reviewed when a session or practice answer recalls them. Never understanding.
9. **Let go deliberately.** Nodes that no active goal needs are allowed to decay to the index tier instead of being maintained.

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
| Internalize | planned at depth 2 or more (explained, derived, applied) | full step loop, maintained by practice | most of the plan |
| Index | planned at depth 1: must know it exists and roughly what it says | index pass, no maintenance | a few |
| Archive | details, exact formulas, edge cases | stored only, attached to parent node | rest |

Each session the scheduler chooses between **build** (new fringe nodes), **deepen** (raise depth), and **consolidate** (compound practice) by expected leverage per minute.

`targetDepth` is the deepest planned depth any active goal holds for a node: the time budgets (section 3.4) decide it, not the compiler alone.

---

## 7. Ingestion and delta reading

Sources: PDFs, slides, Markdown notes, web pages, YouTube transcripts, exercise notebooks, and the system's own teaching session transcripts.

1. **Split into parts.** A paper, lecture or set of notes is read whole: one part, with each page, slide or heading marked (`[p12]`) so ideas can cite where they are taught. Only book-length sources are split, into parts of about 40,000 tokens (some 80 pages). Slide PDFs that export every animation build as a page are collapsed first: consecutive pages whose text is contained in the next page's are dropped, the fullest page keeps the whole page range.
2. **Extract.** The extractor reads a part, plus the ideas earlier parts of the same source produced ("graph so far", ids verbatim), and submits ideas, chains and worked examples with citations. **An idea is one lesson: about half an hour to understand** (section 3.4 plans time in these units). It absorbs its parts: definitions, notation, settings, numbers and variants that only matter inside a bigger idea go into its statement, not into ideas of their own. The extractor is asked for a range set by the text's length: about one idea per 1,250–1,700 tokens of text, so 6–8 for a 15-page paper, 2–3 for a short article, at most 40 per part. The source's headline ideas (title, abstract, headings, conclusion) always come first, then what it actually teaches; background it only uses is left to other sources and the goal compiler. Results, tables, hyperparameters, related work, references, summaries and recaps never become ideas; worked examples are attached to the idea they illustrate.
3. **Match.** For each new idea, embedding search and fuzzy name matching find candidates in the world layer; one LLM call per part decides identity only (same idea or not), with a bias toward merging paraphrases. It never edits the extracted content.
4. **Merge.** Deterministic code writes ideas and chains, resolves ids, dedupes chains by (premises, conclusion), runs chain simplification, records coverage. A failed part writes nothing; the next run retries it.
5. **Delta view.** Each extracted node is classified for this learner: `known` (at target depth), `deeper` (known, source adds depth), `new-fringe`, `new-beyond` (needs a prerequisite first), `conflict` (contradicts the graph or another source). The learner sees: "Of 42 ideas in this lecture, 28 you have; 9 are new and learnable now; 3 need a prerequisite; 2 conflict." New nodes are queued by leverage.
6. **Conflicts** become short investigations in a session: which is right, under what conditions, why.

So a paper costs one extractor call and at most one matcher call. Parts of one source run in order (each sees the ideas of the parts before it); different sources may run in parallel under a global concurrency limit.

**Reading a source again.** Sources read before lesson-sized extraction (many small ideas from small chunks) are marked in the Library and can be read again. Reading again splits the source afresh and retires the ideas only it gave that nothing depends on: no evidence, no other source, not in any session, open practice or probe. Studied and shared ideas stay and are matched again like any other. Goals that use the source compile it afresh and drop capabilities left with no ideas (unless mastered).

---

## 8. Lookup, trails and the map

- **Lookup.** A question ("difference between SPE and Nash?") returns node cards: (1) the learner's own statement and handle, (2) neighbourhood via chains, (3) the derivation path from solidly owned nodes down to this one, (4) the trail of the session where it was learned. Archive details hang under their parent node. Search is semantic (local embeddings) plus fuzzy name match. A lookup records `lookup` evidence, a trace that the idea was needed; the card shows the answer, so it never counts as a review.
- **Trails.** Every session is stored as a timeline: predictions, answers, think-aloud text, errors, explanations that landed, nodes created. A session the learner chose shows what they asked (their words, or the ideas they picked). Browsable by date, goal or node; the system can narrate a trail ("how did I get from linear algebra to attention?").
- **Map.** The world layer as a living graph that fills the window, in the manner of Obsidian's graph view. A force layout pulls ideas together along their chains and pushes them apart, so related ideas settle into clusters; foundations (ideas many others are built on) draw larger, and chains with several premises meet at a small implication marker before their conclusion. By default ideas are coloured by the learner's edge (yours in ivory, faded by FSRS freshness; learnable now ringed; beyond your edge muted), with simplified ideas underlined.
  - **Reading it.** Hovering an idea lights it, its neighbours and their links and fades the rest, with a tooltip (name, where it stands, its goals, simplified, how many flashcards). Labels fade in as you zoom and never overlap; the hovered, selected, neighbouring and searched ideas are always labelled, and the most connected ideas keep a label at any zoom as landmarks. Dashed rings are ideas taught from the model's knowledge, not read from the learner's material; the legend says so. Ideas can be dragged.
  - **Finding and focusing.** Search by name (Enter goes to the first match). Clicking an idea opens its card (statement, Learn this now, depth, built on, leads to, the path from what you own, its flashcards with Add a card, Go deeper) beside the graph, and "Only its neighbourhood" shows just the ideas 1–3 chain steps away (the local graph).
  - **View panel.** Filters: yours, learnable now, beyond your edge; one goal (its targets and everything they are built on); only simplified ideas; only ideas with flashcards; hide ideas with no links. Colour by your edge, goal, topic (clusters from the chains) or depth. Display: when labels appear, idea size, link thickness, arrows. Forces: centre, repel, link strength, link distance, and "Prerequisites left to right", which pulls each idea to a column by how far it sits from a root. The settings are remembered on this device.
  - **Full screen** (button or F) covers the screen; Esc leaves it. **Replay how it grew** shows ideas appearing in the order they were first learned.
  - The camera stays where the learner left it when the data refreshes; it fits the map when a filter or the flow changes and follows it while it settles. With reduced motion the layout settles at once and nothing glides.
- **Bridges** (post-MVP). A background agent proposes structural analogies between distant areas; accepted bridges become explicit `analogous` notes the tutor uses for anchoring.

---

## 9. Self-tuning (post-MVP)

Measured: depth gained per session (verified by later unaided performance), minutes and 1–5 effort ratings per step, retention to next real use, efficiency per mode/topic/variant. Tuned: analogy domains that work for this learner, session length, predict-step length, personal FSRS parameters, recurring misconception patterns. Small A/B experiments on the learner's own data; a monthly one-page report.

---

## 10. The app

A desktop app (macOS first, then Windows/Linux). The rail has the five places you work in (Today, Goals, Map, Cards, Stats), then the three you look things up in (Lookup, Trails, Library), and Settings; Session appears at the top while a session is open. Clicking the place you are already on opens it at its top level (a goal page goes back to the Goals list). **Search** (⌘K, or at the top of the rail) is one box for everything: places, goals, ideas on the map by name, the common actions (Choose what to learn, New goal, Review flashcards) and "Ask", which opens Lookup with what was typed. ⌘1 to ⌘8 open the rail's places in order and ⌘, opens Settings. An empty app opens on a welcome that explains the three steps (say what you want, give it time, learn at your edge) and offers one action: set your first goal.

| Screen | Purpose |
| --- | --- |
| Today | One next action (session, practice, or a draft plan to approve), "N cards to review" when there are some (the main action only when nothing else is due), goals with their time bars and pace, what's fading (three shown, the rest on request), the preview question, the two-week forecast and the last seven days against the goals' rhythm |
| Session | The teaching UI: the session as a scrollable conversation of structured cards (predict, explanation with Markdown + KaTeX + diagrams, check, connect, compress, use), each answered in the one answer field, and the frontier map side panel.; selected text offers Reply and Make a flashcard, and a Make a flashcard button opens the flashcard sheet. With no session open: the goals' planned sessions and "Choose what to learn" (section 4.5) |
| Map | The knowledge graph as a living, full-window graph: hover to see what an idea connects to, search, a card per idea with its local neighbourhood and its flashcards, a view panel (filters, colour, display, forces), full screen and a replay of how it grew (section 8) |
| Cards | Flashcards for hard facts (section 2.6). Review: the due cards of all goals or one; the front, then Show answer (Space), then Again, Hard, Good or Easy (keys 1–4), each saying when the card comes back; a plain line when nothing is left. All cards: search, filter by goal and idea, edit, suspend, delete, show on map, and write a card by hand or have it drafted |
| Goals | New goal as a four-step flow (goal, material, time, plan to approve; section 3.2; the assessment starts as Written exam for a course and Not assessed for a goal of your own); a goal page that leads with where it stands (ideas ready, time against budget, this week, sessions left, a time bar with a marker where the rhythm puts you, pace) and one action, then the probe, the lecture timeline with time per lecture, the skills (each opening to its ideas with depth pips: known, planned, asked beyond the time), skills left out for this time and expected ideas behind disclosures; a quiet line with its flashcards and how many are to review; the time can be changed in place with the plan re-computed live (or switched to no time limit); "Add to this goal" adds skills in the learner's words after a preview; Edit goal has every field on one page "Export notes" saves the goal as Markdown (skills, ideas, own words, handles, flashcards) |
| Stats | How you learn, filtered by time range, goal and topic (ideas clustered by chains): a few plain sentences on what stands out, then time per week by goal (free study as its own series) against the budgets' rhythm, every day for twelve weeks, what you know over time, what you keep (projected recall), how sure against how right, when you study, hardest ideas, shared ideas and the time they saved, misconceptions that came back, and time against each budget, with free study as its own line |
| Lookup | Search, node cards, derivation path |
| Trails | Past sessions (a chosen one with what was asked), replay |
| Library | Add sources (files, or pasted text: notes, an article, a transcript, read like a file), see the delta view and every idea in source order with its page citation and its chains (built on / leads to), ingestion progress |
| Settings | Model provider and models, flashcards in sessions without a goal, data folder, backups (make one, restore one), preferences |

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
| Graph view | d3-force for the layout (with d3-dispatch, d3-quadtree, d3-timer) and an own canvas renderer | ISC |
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
- **Append-only evidence.** Never edit evidence; correct by appending. The one exception: when the learner erases ideas from their map (Settings, "Erase from your map"), the evidence on those ideas is deleted with them. Flashcard reviews are append-only too, and a card's schedule is derived from them; only the cards service writes cards and reviews.
- **Structured outputs via submit tools.** Each agent ends by calling a `submit_*` tool whose input is validated with zod; validation errors go back to the model for a retry (max 3).
- **Provider interface.** Every model call goes through `llm/` with a role name; settings map each role to a model and an effort level (`low` … `max`, passed as the Agent SDK `effort` option or the API's `output_config.effort`). Defaults: goal compiler and the escalation tutor Opus 5.5 at extra high; tutor, prober and session maker Opus 5.5 at medium; problem generator and grader Sonnet 5.5 at high; card writer Sonnet 5.5 at medium; matcher Haiku 5.5 at max; extractor, planner, librarian and connection test Haiku 5.5 at medium. Model calls run in two lanes: background work (reading sources, mapping goals, grading practice, writing cards) runs at most the number of calls set in Settings (3 by default), and calls the learner is waiting on (tutor, second opinion, planner, session maker, prober, problem generator, librarian) run beside it, at most two at once, so an answer never waits behind a lecture being read. A change in Settings applies to later calls; work in flight finishes untouched, and only another data folder opens another database.

### 11.3 Agent roles

| Role | Input | Output (submit tool) |
| --- | --- | --- |
| Goal Compiler | goal, kind, assessment, exam profile, focus, background, context, its time or (no time limit) wanted level, the goal material's ideas, existing capabilities; in addition mode the learner's request and the library ideas that match it | title, new capabilities, extensions, retirements, target nodes with depths; in addition mode whether it fits (and why not), breadth or depth, the new capabilities and nodes |
| Material classifier | a file's title and opening text | its role for the goal |
| Course profiler | assessment and scope material | exam profile, upcoming lectures |
| Prober | target subgraph, you-layer state, the goal's context | probe questions; then assessment updates |
| Planner | owned nodes, targets, fringe | lesson map (DAG of nodes for this session) |
| Tutor | lesson map, node, learner's neighbourhood, bugs, sources, the goal's level, scope and context, the flashcards of the node and its premises | the next step card (predict / explain / check / connect / compress / use), and with a grade the flashcards the answer recalled |
| Tutor (asked) | the same context as a step, the open card and whether it is an unanswered question, the learner's question or the form they asked for | a short answer in Markdown (`submit_answer`); no grade, no card |
| Tutor escalation | the whole history of one idea after a worked example did not help | a re-diagnosis and a fresh explanation (once per idea) |
| Extractor | chunk + graph-so-far digest | nodes and chains with citations |
| Matcher | extracted node + candidates | identity links |
| Problem Generator | target nodes and chains, rung, cue, presentation, recent problems | statement, solution, rubric |
| Grader | problem, solution, rubric, learner answer, the flashcards of its ideas | score 0–10 + reasoning, and the flashcards the answer recalled |
| Librarian | query, matched node cards | short synthesized answer citing node ids |
| Session maker | what the learner wants to learn, the goal (if any: level, scope, focus, background, context), the map's matching ideas, what the learner owns, minutes per aim | the session's ideas in order (existing ids or new ideas with premises), an aim and a why each, title, summary, level, missing background |
| Card writer | a finished idea (what the session taught, the learner's answers, the goal's level, existing cards); or a selection with its message; or a request | 0–3 flashcards (front, back), or one draft |

### 11.4 Data folder

```
~/Frontier/            (configurable)
  frontier.db          SQLite: world layer, you layer, evidence, sessions, goals, sources, practice, activity log
  backups/             copies of frontier.db: one for each day the app is used (seven kept), one before
                       every schema upgrade and every restore, and those made with "Back up now"
  sources/             original files the learner added
  attachments/         images attached to session answers, named by their content hash
  models-cache/        the local embedding model
  agent/               working folder of the model process (nothing is read from it)
  exports/             optional Markdown export of nodes (Obsidian-readable)
```

**Keeping the data safe.** Everything the learner has built lives in `frontier.db`, so: a copy is made each day the app is used and before every schema upgrade (`VACUUM INTO`, consistent while the app runs); Settings lists the copies, makes one on request and restores one (the data as it is now is copied first, so a restore can be undone); when the file opens it is checked, and data that is damaged or was written by a newer version of the app is refused with a message that names the file and the backups, instead of starting on an empty database; only one copy of the app runs per data folder.

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
