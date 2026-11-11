# Improvement plan (proposals to approve)

Status: 2026-11-11, cloud session. **Nothing here is built.** Approve items by their ID (for example "D1 to D8, A2, B1") and a later session builds only those.

## How this list was made

- Ran the baseline: 309 tests pass, typecheck and lint are clean.
- Ran the app on sandbox data (fake model, no real model calls) and looked at every place in screenshots at 1360 × 880 and 900 × 700.
- Three code reviews read the backend in full: sessions and the model layer, goals and planning, knowledge, flashcards and ingestion. The reviewers confirmed most findings with small scripts.
- I checked the most serious findings myself. "Reproduced" means a script showed the wrong result. "Read" means the code path was traced but not run. "Suspected" means it needs a check on your Mac.

**Not checked.** The review of the UI code stopped early at the usage limit, so UI code bugs are under-represented (see D25). No real model ran, so prompt quality is judged from reading only. Speed was not measured. The macOS build was not run.

Sizes: **S** an hour or two, **M** about half a day, **L** a round of its own.

## What I would do first

1. **Fix what gives wrong results or can lose data:** D1 to D8, D15, D18. Mostly small.
2. **Fix what makes the plan and the review schedule inaccurate:** D9 to D14. Some need a decision from you (see "Decisions").
3. **Make the session better:** B1, B2, C1, C2, C3, A2. This is where learning time is spent.
4. **Material in, practice out:** B3, B4, B6, C9, C10.
5. **Comfort:** A1, A3, A4, A5, A6, B12.

---

## A. Better UI and UX

| ID | Idea | What I saw | Size | Pick |
| --- | --- | --- | --- | --- |
| A1 | **The plan as a list.** A "Show as list" switch on the plan step and the goal page: every idea by name, grouped by skill, with in depth, overview or left out, its minutes, and a rough order by session. | The plan shows only dots. To read 24 ideas you hover 24 dots. | M | Yes |
| A2 | **A session header that stays.** Keep the step path (Predict, Explain, Check, Own words) pinned, with "idea 1 of 3" and the minutes used of the idea's half hour. Remove the doubled hint under the answer field. | The step path scrolls away as the conversation grows. The placeholder and the line under the field say the same thing. | S | Yes |
| A3 | **Model presets in Settings.** Three choices (Best quality, Balanced, Light on my plan). The per-job rows move behind "Advanced". Show usage: calls and tokens today and this week. | Settings shows 13 jobs with 2 dropdowns each and internal names (Prober, Matcher, Librarian). Usage is collected per call but shown nowhere. | M | Yes |
| A4 | **Today: "I have 15, 30, 45 or 60 minutes".** The app fills that time with cards, a session or practice. Show the streak and this week's target in the side panel. Add a legend to the two-tone goal bars. | Today's side panel says only "57 min studied, 3 sessions". The bars are explained only on the goal page. | M | Yes |
| A5 | **Flashcard review comfort.** Undo the last rating (⌘Z), show "3 of 12", and end with one summary line. | A mis-pressed key cannot be taken back. No progress is shown. | S | Yes |
| A6 | **Stats tidy-up.** Stop the "Recognize" and "Own" labels overlapping. Hide rows with 0 answers. Show a chart only when it has enough data, otherwise one quiet line. | Seen in the screenshot: overlapping labels, three confidence rows of which two are empty, a one-bar chart. | S | Yes |
| A7 | **Pause and finish a goal.** Add "Pause" and "Mark as finished" to the goal page. Group the Goals list: active, drafts, paused, finished. Show days to the exam. | The backend supports paused and finished goals, but the UI can only delete a goal, and deleting drops its time from Stats. | S | Yes |
| A8 | **Light theme and text size.** Light and "follow the system", and ⌘+ / ⌘− for text size. | The app is dark only and has no zoom. | M | — |
| A9 | **Lookup.** Make the example questions clickable, keep recent lookups, and fill the empty page with something useful (ideas that are fading). | The examples are plain text. The page is empty until you type. | S | — |
| A10 | **Library.** Drop files anywhere on the window. Show a time estimate and a Cancel while a source is read. Add "Open original". | Files can be dropped only in the goal's material step. A running read cannot be cancelled. | S | — |
| A11 | **Trails.** Search and filter by goal. Give sessions with the same title a second line with the ideas they covered. | The list showed four sessions all named "Profiles, best responses and equilibrium". | S | — |
| A12 | **First run.** "Try with an example" (the 36-idea example map already exists) and a connection check before the first goal. | A new user sees an empty app until their first goal is mapped. | S | — |
| A13 | **Shortcut sheet and menu bar.** ⌘/ lists the shortcuts. A native menu with New goal, Search, Review flashcards. | Shortcuts exist but are listed nowhere. The app has the default menu. | S | — |
| A14 | **Map.** Stronger links at the default zoom, and "Show the path to this idea" drawn on the graph. | Links are very faint. The path exists only as a list in the idea's card. | S | — |

---

## B. New features

| ID | Idea | Why | Size | Pick |
| --- | --- | --- | --- | --- |
| B1 | **Ask the tutor a question during a session.** An "Ask" on every card gives a short answer that is not graded and is kept in the trail. On explanations: "Explain it differently", "Simpler", "Show an example". | Today the only thing you can send is an answer. Explanation cards offer only Continue and an effort rating. | M | Yes |
| B2 | **Hints.** "Give me a hint" on a question, up to two. Each hint lowers how much the answer counts, so it is not recorded as unaided. | Today the choices are a full answer or "I have no idea". | M | Yes |
| B3 | **Add from a link.** A web article by its address, and a YouTube video by its transcript. | The design lists both. Today only local files and pasted text work, though the reader for web pages exists. YouTube has no official transcript service, so this part can break; pasting stays as the fallback. | M | Yes |
| B4 | **Read slides and scans properly.** Send image-heavy and scanned pages to the model as images. | PDFs are read as text only. Figures and formulas drawn as images are lost, and a scanned PDF ends as "done, 0 ideas" with no message. Uses more of your plan, so it needs a setting. | L | Yes |
| B5 | **Source viewer.** Open the PDF at the cited page from any "p 12". Select text to explain it, make a flashcard, or learn it now. | Citations are text only. You cannot see the original. | L | — |
| B6 | **Practice on demand, and a mistakes list.** "Practice this skill now" at a chosen difficulty. Problems you got wrong come back later as variants. | Practice starts only when the scheduler finds fading ideas, or as a mock exam. | M | Yes |
| B7 | **Exam mode.** A timed mock exam from the exam profile, no feedback until the end, then a report per skill that feeds the next sessions. | Mock exams are five problems in the last four weeks, graded one by one. | M | — |
| B8 | **Oral exam and teach-back.** The tutor plays the examiner with "why" and "what if" follow-ups, or a beginner you must teach. Optionally spoken: read aloud with the system voice, dictation with a local speech model. | The design promises the examiner for oral exams. Today "oral exam" only changes a few words in the prompts. | M (text), L (voice) | — |
| B9 | **Real diagrams.** Rendered diagrams and simple plots in explanations. | The tutor may only draw "a diagram in text". | M | — |
| B10 | **Notes and a cheat sheet.** A notes view per goal (your own words, formulas, worked examples), a one-page sheet before an exam, print or PDF, and a free note on each idea. | Notes exist only as a Markdown export. | M | — |
| B11 | **Anki import and export.** Review your cards on the phone, and bring in decks you already have. | Cards live only in Frontier. | M | — |
| B12 | **Reminders.** A quiet system notification when reviews are due or at a study time you choose, and the count on the dock icon. | The app says nothing when it is closed or in the background. | S | Yes |
| B13 | **Week plan.** Which days and how long, days off, days to the exam, calendar export. | The weekly rhythm is split over five days with no say from you. | M | — |
| B14 | **Teaching language and non-English material.** A setting for the language of explanations, and a multilingual model for "search by meaning". | The search model is English only, so matching and Lookup are weak on German lectures. The prompts never state a language. | M | Ask |
| B15 | **Edit your map.** Rename an idea, merge duplicates, correct a statement, and "I know this: test me" from the map or the goal page. | The only edit today is erase. | M | — |
| B16 | **Conflicts between sources.** Show them and resolve each in a short investigation. | The design describes it. Today a conflict is stored but never shown, and a single-part source can never report one. | M | — |
| B17 | **Weekly review.** One page a week: what you learned, what faded, where you were too sure, and one suggested change to the plan. | Stats has the numbers but no summary over time. | M | — |
| B18 | **Tell the story of a trail.** "How did I get from linear algebra to attention?" | An open question in `docs/progress.md`. One model call over a trail. | S | — |
| B19 | **Code practice.** A code answer field with highlighting, and running the code. | Goals can ask for "practical application, including code", but answers are plain text. Running Python in the app needs a library under MPL-2.0, which is not on your licence list. | L | Ask |

---

## C. Improving existing features

| ID | Idea | Why | Size | Pick |
| --- | --- | --- | --- | --- |
| C1 | **Faster sessions.** (a) Tutor calls go ahead of background reading. (b) Stop writing cards that are thrown away. (c) Lower the planner's effort. (d) Cache the fixed part of prompts on the API provider. (e) Show explanations as they are written. | (a) All calls share one queue, so an answer can wait minutes behind lectures being read. (b) A strong prediction costs four tutor calls for two cards shown. (c) The planner runs at max effort on the "Start session" path. | M to L | Yes |
| C2 | **Give the tutor the right passage.** Send the page that teaches the idea, and prefer your material over session transcripts. Also send the idea's own words and today's plan. | The tutor gets the first 1,800 characters of the whole source, which is the title page or abstract, and is told to cite it. | S to M | Yes |
| C3 | **Ask again after a miss.** After a failed check: a short targeted explanation and a fresh version of the question. Leave predictions out of the failure count. | One failed check moves straight on to "own words". A wrong prediction, which is expected, counts toward "three failures". | M | Yes |
| C4 | **A session that adapts.** Pull in a missing prerequisite mid-session. Open the next session with the question the last one left. | The design says both. The plan is fixed at the start, and the preview question is shown but never used. | M | — |
| C5 | **Misconceptions that end.** Mark one resolved after a few clean answers. Recognize a repeat by meaning. Add a Misconceptions view. Schedule a contrast problem because of one. | They are never resolved (the code for it is never called) and are matched by exact sentence, so the tutor's list only grows. | M | Yes |
| C6 | **Lookup that reads your sources.** Search the source text too, with page citations. Allow follow-up questions. Match idea names inside a question when the search model is missing. | Lookup answers only from idea cards. Without the model, "difference between SPE and Nash" finds nothing. | M | — |
| C7 | **Flashcards.** Fill-in-the-gap cards, reversed cards, daily limits in Settings, and "problem cards": a card missed many times is rewritten or its idea is taught again. | New cards are fixed at 20 a day. A card that keeps failing is just repeated. | M | — |
| C8 | **Goals that use freed time.** When the probe shows you know half, offer the left-out ideas back. Say when a goal has only an exam or a syllabus. Ask "finished?" when the date has passed. | Freed hours stay unused, and the goal page never says so. See D14. | M | Yes |
| C9 | **Practice sets.** Leave a set without a penalty. Retry grading without a restart. Images and quotes in practice answers. | The only way out of a set is "No idea", which records zeros on every idea. | S to M | Yes |
| C10 | **Library.** Watch a course folder so new lectures arrive on their own. Clear messages for scanned, empty or locked PDFs. Readers for Word, PowerPoint, EPUB and notebooks. | Only PDF, Markdown, text and HTML are read. | M | — |
| C11 | **A list beside the map.** Ideas in a sortable table: state, depth, due, goal. | The graph is good for shape, poor for "what is due". | M | — |

---

## D. Bugs, errors and code to clean up

### Wrong results or data at risk

| ID | Problem | How sure | Size | Pick |
| --- | --- | --- | --- | --- |
| D1 | **Changing one setting resets the others.** Changing "Model calls at once" switched the provider back to the Claude login, wiped the API key and reset the data folder. The API-key provider cannot be set up at all. (`backend/settings/schema.ts:60`) | Reproduced | S | Yes |
| D2 | **A wrong first guess makes a new idea count as forgotten the next day.** Answers on the same day do not lengthen an idea's memory, so the first answer decides it, and that is the prediction, which is meant to be hard. Wrong prediction then three good answers: 0.21 days. Right prediction: 8.3 days. The "same day" is cut at midnight UTC, 01:00 in Germany. (`backend/core/fsrs.ts`) | Reproduced | M | Yes |
| D3 | **A failed answer can lengthen the review interval.** Scores from 0.40 to 0.69 fail the idea but are booked as "hard" or "good": 8.3 days became 41.5 after a score of 0.45. | Reproduced | S | Yes |
| D4 | **A link in an explanation replaces the app with the website.** There is no way back, and that page can use the app's internal commands (read the API key, erase the map). (`backend/main.ts`, `ui/components/Markdown.tsx`) | Read | S | Yes |
| D5 | **Changing a setting while something runs breaks that work.** The database is closed under it: a source stays "running" forever with no retry button, or a grade is lost. (`backend/context.ts:120`) | Reviewer simulated, I read it | S | Yes |
| D6 | **An answer can be graded twice.** Quit while the next card is being written, restart, and the old card is asked again and recorded again. (`backend/services/session.ts`) | Reviewer reproduced | S to M | Yes |
| D7 | **No backup of your data.** One database file, no copies, no check at start. A damaged file stops the app before the window opens. Two copies of the app can open the same database. Add daily copies, a copy before each upgrade, Restore, and a single-instance lock. | Read | M | Yes |
| D8 | **Approving an older "new map" deletes newer skills.** Skills from a lecture that arrived after the proposal was drawn are removed and never mapped again. (`backend/services/remap.ts`) | Reviewer reproduced | S to M | Yes |

### Plans, time and review schedule

| ID | Problem | How sure | Size | Pick |
| --- | --- | --- | --- | --- |
| D9 | **Time and speed bookkeeping.** (a) Finishing or pausing one goal makes every other plan up to 2.5 times more expensive. (b) Logged time is split again whenever goals change, so a new goal starts with time "spent" and a "slow" verdict. (c) What the probe finds counts as fast learning, so plans then hold about 1.7 times too much. (d) Stats shows a different speed than the planner uses. (`backend/services/budget.ts`) | Reviewer reproduced | M | Yes |
| D10 | **Session logic.** (a) An idea planned at "transfer" always ends marked simplified and caps the ideas built on it, because a session can certify at most "apply". (b) After a failed test-out the session loops explain, check, explain, check until the time is up, with no worked example. (c) The planner can pick an idea without the prerequisites you lack. (d) "End session" while an answer is judged does not stop the work. | (a) (c) (d) reviewer reproduced; (b) simulated, I read it | M | Yes |
| D11 | **Reading sources.** (a) Two sources read at the same time create duplicate ideas. (b) Sources get stuck in "running" after a failure or a quit. (c) Changing the search model silently turns off matching by meaning. (d) Scanned or empty PDFs end as "done, 0 ideas" with no message. (e) "Remove from library" skips the clean-up: dead citations and an orphaned file. (`backend/services/ingestion.ts`, `backend/api/handlers.ts:119`) | (a) to (d) reviewer reproduced; (e) read | M | Yes |
| D12 | **Map integrity.** (a) Tidying chains can delete an argument that is not redundant, and an idea drops off your edge. The rule in the design is too loose. (b) Two sources that state a link in opposite directions make both ideas unlearnable for good. (`backend/core/chains.ts`) | Reviewer reproduced, I read (a) | M | Decide |
| D13 | **Review credit.** (a) "Implicit credit" also passes failures to prerequisites, once per idea in the problem: one "No idea" on a three-idea problem cut a prerequisite from 75 days to 11. (b) Opening an idea in Lookup makes a faded idea count as owned again. (c) Practice is dated when it was graded, not when it was answered. (d) Depth never drops after a clear failure, though the design says it does. | (a) (b) reviewer reproduced; (c) (d) read | M | Decide |
| D14 | **Goal edge cases.** A 10-hour goal with its exam in three days shows "70 hours this week". A new time is "behind" at once, because the clock starts at the first approval. A goal with only an exam or syllabus is never mapped and the wizard waits forever. "Map more ideas" during background work writes skills twice. Deleting a goal removes its time from Stats. A waiting "new map" breaks after "Read again". | Reviewer reproduced most | M to L | Yes |
| D15 | **Stats dates are wrong in Germany.** Weeks are labelled with Sunday's date, and one day disappears from the calendar and the streak each spring. (`backend/services/stats.ts`) | Reviewer reproduced | S | Yes |
| D16 | **Model layer safety.** Pin model calls to the app's own tools, so connectors on your Claude account are never visible to calls that read source text. Add a time limit to stuck calls. Store the API key in the system keychain, not in plain text. A settings file with one bad field is silently replaced by defaults. | First point suspected, rest read | M | Yes |
| D17 | **Smaller.** The Cards queue fails if the clock was set back. Usage from the Claude login always reads 0. | Reproduced / read | S | — |

### Code health

| ID | Problem | Size | Pick |
| --- | --- | --- | --- |
| D18 | **No automatic checks on GitHub.** Add tests, typecheck and lint on every push, a licence check that enforces your licence rule, and the dependency audit (it now reports four low-severity notices from KaTeX). | S | Yes |
| D19 | **Tests where the risk is.** None cover the settings path, the real providers, the goal worker, same-day reviews, two sources at once, time zones or upgrading an old database. Add one test that starts the real app on the sandbox. | M | Yes |
| D20 | **Check every input from the UI.** About 12 of 75 commands validate their input, against the project rule. A free-text date gives a broken weekly target. | M | — |
| D21 | **Restore the layer rules.** The transport layer holds logic and calls the database directly (how D11e happened). The "one writer" of the map is six places. | M | — |
| D22 | **Split oversized files.** `services/session.ts` (983 lines, the root of D6), `services/goals.ts`, `GoalPage.tsx` (807), `styles.css` (3,406). | M | — |
| D23 | **Speed as the map grows.** Almost every request rebuilds the whole graph from all evidence, and every card's schedule is replayed on each call. Fine at 36 ideas, not at 2,000. Not measured. | M | — |
| D24 | **Remove dead code and fix the docs.** An unused command that costs a model call, unused helpers, an empty `exports/` folder, and three places where `docs/design.md` no longer matches the code. | S | — |
| D25 | **Finish the UI code review.** It stopped at the usage limit. What I checked by hand was sound: shortcuts do not fire while typing, buttons have names, the map has a text alternative. | S | Yes |
| D26 | **A log file.** Errors in background work vanish. Write them to a file and add "Show log" in Settings. | S | Yes |

---

## Decisions I need from you

1. **D2, how a sitting counts.** My proposal: one review per idea per sitting, built from its graded steps, with the prediction left out. Agree?
2. **D13d, failing a known idea.** The design says its depth drops. The code only lowers its freshness. Which do you want?
3. **D12a, tidying chains.** Keep an argument unless another one needs strictly fewer of the same ideas. This changes a rule in `docs/design.md`.
4. **B14.** Is your course material in German?
5. **B4.** Reading pages as images uses more of your plan. Acceptable as an option?
6. **B19.** Running Python needs an MPL-2.0 library. Allow it, or leave code running out?
7. **D16.** One check on your Mac: which tools a model call can see with your Claude login.
