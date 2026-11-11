# Improvement plan

Status: 2026-11-11. **The owner approved every item** and set the order below. Built items are ticked in `docs/progress.md`.

## Build order (owner's rule, 2026-11-11)

The owner's rule: first high impact and low time, then high impact and medium time, then medium impact and low time. High impact with high time, and medium impact with medium time, wait for the next session. Low impact is archived in `docs/notes/archived-ideas.md`, not deleted. Impact and time are my judgement.

**This session, in this order**

1. *High impact, low time:* D1, D5, D4, D3, D18, D15, A7, A2, C2, the quick parts of C1 (tutor calls first, lower planner effort), of D16 (pin model calls to the app's tools, a settings file that cannot be lost), of C9 (leave a practice set without a penalty) and of D11 (stuck sources, a message for sources with no text, a clean "Remove from library"), then D8.
2. *High impact, medium time:* D2 with D13, D12, D6 with D10, D7, D9, the rest of D11, D14, C3, B1, B2, A1, B6, C8, B3.
3. *Medium impact, low time:* D26, A5, A6, A10, B12, B14, the first part of C5 (misconceptions get resolved), D25.

**Next session** (high impact and high time; medium impact and medium time): B4, B19, the rest of C1 (no thrown-away cards, explanations shown as they are written, prompt caching), A3, A4, B7, B8, B9, B10, B15, B17, C4, the rest of C5, C6, C10, the rest of D16 (keychain, time limits), D19, D20, D21, D22, D23.

**After that** (medium impact, high time; the rule does not name this case, so it waits): B5.

**Archived** (low impact): A8, A9, A11, A12, A13, A14, B11, B13, B16, B18, C7, C11, D17, D24.

## Decisions (owner, 2026-11-11)

- **D2:** one review per idea per sitting, built from its graded steps, with the prediction left out.
- **D12:** keep only the first tidying rule (drop a chain when another chain to the same idea needs fewer of the same ideas). Update `docs/design.md` §2.1 in the same commit.
- **D13:** the middle way. One failure only lowers freshness; two clear failures on different days drop the idea one level, so it is taught again. Update `docs/design.md` §3.4.
- **B4:** for sources and pages that are mostly images or have little text. The tutor refers to the figures and shows them in the session.
- **B14:** keep it general and simple: a multilingual search model, English for the app and explanations, no language setting.
- **D16:** yes to the check on the Mac.
- **B19:** run code with the Python already on the Mac, only when the learner presses Run. When a library is missing the app installs it; when that is not possible it shows the commands to run in a terminal. The owner gives the app full permission for this. Pyodide (MPL-2.0) is not needed now.

## How this list was made

- Ran the baseline: 309 tests pass, typecheck and lint are clean.
- Ran the app on sandbox data (fake model, no real model calls) and looked at every place in screenshots at 1360 × 880 and 900 × 700.
- Three code reviews read the backend in full: sessions and the model layer, goals and planning, knowledge, flashcards and ingestion. The reviewers confirmed most findings with small scripts.
- I checked the most serious findings myself. "Reproduced" means a script showed the wrong result. "Read" means the code path was traced but not run. "Suspected" means it needs a check on your Mac.

**Not checked.** The review of the UI code stopped early at the usage limit, so UI code bugs are under-represented (see D25). No real model ran, so prompt quality is judged from reading only. Speed was not measured. The macOS build was not run.

Sizes: **S** an hour or two, **M** about half a day, **L** a round of its own.

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
| A10 | **Library.** Drop files anywhere on the window. Show a time estimate and a Cancel while a source is read. Add "Open original". | Files can be dropped only in the goal's material step. A running read cannot be cancelled. | S | — |

---

## B. New features

| ID | Idea | Why | Size | Pick |
| --- | --- | --- | --- | --- |
| B1 | **Ask the tutor a question during a session.** An "Ask" on every card gives a short answer that is not graded and is kept in the trail. On explanations: "Explain it differently", "Simpler", "Show an example". | Today the only thing you can send is an answer. Explanation cards offer only Continue and an effort rating. | M | Yes |
| B2 | **Hints.** "Give me a hint" on a question, up to two. Each hint lowers how much the answer counts, so it is not recorded as unaided. | Today the choices are a full answer or "I have no idea". | M | Yes |
| B3 | **Add from a link.** A web article by its address, and a YouTube video by its transcript. | The design lists both. Today only local files and pasted text work, though the reader for web pages exists. YouTube has no official transcript service, so this part can break; pasting stays as the fallback. | M | Yes |
| B4 | **Read slides and scans properly.** Send pages that are mostly images or have little text to the model as images; text pages stay as now. Keep each such page as a picture, so the tutor can refer to a figure and show it in the session. | PDFs are read as text only. Figures and formulas drawn as images are lost, and a scanned PDF ends as "done, 0 ideas" with no message. Uses more of your plan, once per source. Approved 2026-11-11. | L | Yes |
| B5 | **Source viewer.** Open the PDF at the cited page from any "p 12". Select text to explain it, make a flashcard, or learn it now. | Citations are text only. You cannot see the original. | L | — |
| B6 | **Practice on demand, and a mistakes list.** "Practice this skill now" at a chosen difficulty. Problems you got wrong come back later as variants. | Practice starts only when the scheduler finds fading ideas, or as a mock exam. | M | Yes |
| B7 | **Exam mode.** A timed mock exam from the exam profile, no feedback until the end, then a report per skill that feeds the next sessions. | Mock exams are five problems in the last four weeks, graded one by one. | M | — |
| B8 | **Oral exam and teach-back.** The tutor plays the examiner with "why" and "what if" follow-ups, or a beginner you must teach. Optionally spoken: read aloud with the system voice, dictation with a local speech model. | The design promises the examiner for oral exams. Today "oral exam" only changes a few words in the prompts. | M (text), L (voice) | — |
| B9 | **Real diagrams.** Rendered diagrams and simple plots in explanations. | The tutor may only draw "a diagram in text". | M | — |
| B10 | **Notes and a cheat sheet.** A notes view per goal (your own words, formulas, worked examples), a one-page sheet before an exam, print or PDF, and a free note on each idea. | Notes exist only as a Markdown export. | M | — |
| B12 | **Reminders.** A quiet system notification when reviews are due or at a study time you choose, and the count on the dock icon. | The app says nothing when it is closed or in the background. | S | Yes |
| B14 | **German and English material.** Replace the English-only model for "search by meaning" with a multilingual one of the same size, so a German source matches as well as an English one. The app and all explanations stay in English. No language setting. | The search model is English only, so matching and Lookup are weak on German lectures. The owner's material is in both languages (answered 2026-11-11: keep it general and simple). The new model's licence must be checked first. | S to M | Yes |
| B15 | **Edit your map.** Rename an idea, merge duplicates, correct a statement, and "I know this: test me" from the map or the goal page. | The only edit today is erase. | M | — |
| B17 | **Weekly review.** One page a week: what you learned, what faded, where you were too sure, and one suggested change to the plan. | Stats has the numbers but no summary over time. | M | — |
| B19 | **Code practice.** A code answer field with highlighting, and running the code. | Goals can ask for "practical application, including code", but answers are plain text. The owner wants it (2026-11-11). Open: run it with the Python already on the Mac (no licence question, every installed library, not sandboxed) or inside the app with Pyodide (sandboxed and self-contained, MPL-2.0, fewer libraries). | L | Yes |

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
| C8 | **Goals that use freed time.** When the probe shows you know half, offer the left-out ideas back. Say when a goal has only an exam or a syllabus. Ask "finished?" when the date has passed. | Freed hours stay unused, and the goal page never says so. See D14. | M | Yes |
| C9 | **Practice sets.** Leave a set without a penalty. Retry grading without a restart. Images and quotes in practice answers. | The only way out of a set is "No idea", which records zeros on every idea. | S to M | Yes |
| C10 | **Library.** Watch a course folder so new lectures arrive on their own. Clear messages for scanned, empty or locked PDFs. Readers for Word, PowerPoint, EPUB and notebooks. | Only PDF, Markdown, text and HTML are read. | M | — |

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
| D12 | **Map integrity.** (a) Tidying chains can delete an argument that is not redundant, and an idea drops off your edge. The rule in the design is too loose. (b) Two sources that state a link in opposite directions make both ideas unlearnable for good. (`backend/core/chains.ts`) | Reviewer reproduced, I read (a) | M | Yes |
| D13 | **Review credit.** (a) "Implicit credit" also passes failures to prerequisites, once per idea in the problem: one "No idea" on a three-idea problem cut a prerequisite from 75 days to 11. (b) Opening an idea in Lookup makes a faded idea count as owned again. (c) Practice is dated when it was graded, not when it was answered. (d) Depth never drops after a clear failure, though the design says it does. | (a) (b) reviewer reproduced; (c) (d) read | M | Yes |
| D14 | **Goal edge cases.** A 10-hour goal with its exam in three days shows "70 hours this week". A new time is "behind" at once, because the clock starts at the first approval. A goal with only an exam or syllabus is never mapped and the wizard waits forever. "Map more ideas" during background work writes skills twice. Deleting a goal removes its time from Stats. A waiting "new map" breaks after "Read again". | Reviewer reproduced most | M to L | Yes |
| D15 | **Stats dates are wrong in Germany.** Weeks are labelled with Sunday's date, and one day disappears from the calendar and the streak each spring. (`backend/services/stats.ts`) | Reviewer reproduced | S | Yes |
| D16 | **Model layer safety.** Pin model calls to the app's own tools, so connectors on your Claude account are never visible to calls that read source text. Add a time limit to stuck calls. Store the API key in the system keychain, not in plain text. A settings file with one bad field is silently replaced by defaults. | First point suspected, rest read | M | Yes |

### Code health

| ID | Problem | Size | Pick |
| --- | --- | --- | --- |
| D18 | **No automatic checks on GitHub.** Add tests, typecheck and lint on every push, a licence check that enforces your licence rule, and the dependency audit (it now reports four low-severity notices from KaTeX). | S | Yes |
| D19 | **Tests where the risk is.** None cover the settings path, the real providers, the goal worker, same-day reviews, two sources at once, time zones or upgrading an old database. Add one test that starts the real app on the sandbox. | M | Yes |
| D20 | **Check every input from the UI.** About 12 of 75 commands validate their input, against the project rule. A free-text date gives a broken weekly target. | M | — |
| D21 | **Restore the layer rules.** The transport layer holds logic and calls the database directly (how D11e happened). The "one writer" of the map is six places. | M | — |
| D22 | **Split oversized files.** `services/session.ts` (983 lines, the root of D6), `services/goals.ts`, `GoalPage.tsx` (807), `styles.css` (3,406). | M | — |
| D23 | **Speed as the map grows.** Almost every request rebuilds the whole graph from all evidence, and every card's schedule is replayed on each call. Fine at 36 ideas, not at 2,000. Not measured. | M | — |
| D25 | **Finish the UI code review.** It stopped at the usage limit. What I checked by hand was sound: shortcuts do not fire while typing, buttons have names, the map has a text alternative. | S | Yes |
| D26 | **A log file.** Errors in background work vanish. Write them to a file and add "Show log" in Settings. | S | Yes |

---

## The questions I asked, with the answers

1. **D2, how a sitting counts.** Answered 2026-11-11: yes. One review per idea per sitting, built from its graded steps, with the prediction left out.
2. **D13d, failing a known idea.** Answered 2026-11-11: the middle way. One failure only lowers freshness; two clear failures on different days drop the idea one level.
3. **D12a, tidying chains.** Answered 2026-11-11: yes. Keep an argument unless another one needs strictly fewer of the same ideas. This changes a rule in `docs/design.md`.
4. **B14.** Answered 2026-11-11: the material is in German and English. Keep it general, no language setting, English for the app and explanations.
5. **B4.** Answered 2026-11-11: yes, for sources and pages that are mostly images or have little text; the tutor refers to the figures and shows them in the session.
6. **B19.** Answered 2026-11-11: the Python on the Mac; the app installs what is missing or shows the commands.
7. **D16.** Answered 2026-11-11: yes. The session that builds D16 adds a small script that prints which tools a model call can see; the next local session on the Mac runs it once with the Claude login.
