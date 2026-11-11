# Archived ideas

Ideas from the review of 2026-11-11 (`docs/improvement-plan.md`) that the owner approved but set aside: low impact, so not built now. Nothing here is rejected. Bring one back by naming its ID.

| ID | Idea | Why | Size |
| --- | --- | --- | --- |
| A8 | **Light theme and text size.** Light and "follow the system", and ⌘+ / ⌘− for text size. | The app is dark only and has no zoom. | M |
| A9 | **Lookup.** Make the example questions clickable, keep recent lookups, and fill the empty page with something useful (ideas that are fading). | The examples are plain text. The page is empty until you type. | S |
| A11 | **Trails.** Search and filter by goal. Give sessions with the same title a second line with the ideas they covered. | The list showed four sessions all named "Profiles, best responses and equilibrium". | S |
| A12 | **First run.** "Try with an example" (the 36-idea example map already exists) and a connection check before the first goal. | A new user sees an empty app until their first goal is mapped. | S |
| A13 | **Shortcut sheet and menu bar.** ⌘/ lists the shortcuts. A native menu with New goal, Search, Review flashcards. | Shortcuts exist but are listed nowhere. The app has the default menu. | S |
| A14 | **Map.** Stronger links at the default zoom, and "Show the path to this idea" drawn on the graph. | Links are very faint. The path exists only as a list in the idea's card. | S |
| B11 | **Anki import and export.** Review your cards on the phone, and bring in decks you already have. | Cards live only in Frontier. | M |
| B13 | **Week plan.** Which days and how long, days off, days to the exam, calendar export. | The weekly rhythm is split over five days with no say from you. | M |
| B16 | **Conflicts between sources.** Show them and resolve each in a short investigation. | The design describes it. Today a conflict is stored but never shown, and a single-part source can never report one. | M |
| B18 | **Tell the story of a trail.** "How did I get from linear algebra to attention?" | An open question in `docs/progress.md`. One model call over a trail. | S |
| C7 | **Flashcards.** Fill-in-the-gap cards, reversed cards, daily limits in Settings, and "problem cards": a card missed many times is rewritten or its idea is taught again. | New cards are fixed at 20 a day. A card that keeps failing is just repeated. | M |
| C11 | **A list beside the map.** Ideas in a sortable table: state, depth, due, goal. | The graph is good for shape, poor for "what is due". | M |
| D17 | **Smaller.** The Cards queue fails if the clock was set back. Usage from the Claude login always reads 0. | Reproduced / read | S |
| D24 | **Remove dead code and fix the docs.** An unused command that costs a model call, unused helpers, an empty `exports/` folder, and three places where `docs/design.md` no longer matches the code. | — | S |

Note on D17: the usage figure that always reads 0 with the Claude login has to be fixed before the usage display in A3 can work.
