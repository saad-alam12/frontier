# Frontier visual design: "Atlas"

The owner chose this direction from three explored ones. It is dark by default, warm, calm and precise, with one cool accent. Reference mockups (static HTML, exact values) are in `docs/mockups/`:

- `Atlas.dc.html`: the Session screen (Predict step) with the frontier map
- `GoalCreate.dc.html`: creating a goal
- `GoalPage.dc.html`: a course goal's page

The mockups are the source of truth for look and spacing; this file states the system behind them. The `.dc.html` files use a design-canvas format (`<x-dc>`, `{{accent}}` holes); read them for markup and values, do not ship them.

The owner's taste: Apple (macOS), Claude and Codex/OpenAI apps and their ads. **Details and consistency matter to them**: alignment, spacing and one coherent type system are reviewed closely.

---

## 1. Principles

1. **One thing in focus.** The current question or step is the centre; everything else supports it.
2. **The frontier is visible.** The learner's edge (owned, learnable now, beyond) is drawn, not listed, and uses the same visual language everywhere (map, step path, lecture path).
3. **Quiet chrome, strong content.** Large, confident type for questions; small, muted type for everything around them.
4. **Precise alignment.** Every column has one shared left edge; rows that span the column also share its right edge. Nothing is centred unless the whole layout is.
5. **Not a clone.** Warmth like Claude, precision like Codex and Apple, but its own accent and typeface.

## 2. Colour (dark theme, default)

| Token | Value | Use |
| --- | --- | --- |
| `bg` | `#141311` | app background, main column |
| `bg-panel` | `#171613` | right side panel |
| `surface` | `#1C1B18` | answer surface, list cards |
| `surface-raised` | `#1E1C19` | "why this now" card |
| `surface-selected` | `#24221E` | selected nav item, role tags |
| `chip-selected` | `#2C2A25` | selected confidence chip |
| `border` | `#262420` | panel dividers, nav border |
| `border-strong` | `#2E2B26` | card outlines (as inset 1px), connector lines |
| `ring` | `#3A3732` | outline buttons, inputs, inactive chip borders |
| `node-muted` | `#4A463F` | upcoming step rings, path separators, map edges |
| `text` | `#EEEAE2` | primary text (ivory) |
| `text-soft` | `#E4DFD5` | secondary body text in cards |
| `text-secondary` | `#ADA79B` | labels, nav items, metadata |
| `text-muted` | `#8C877C` | hints, placeholders, small metadata |
| `text-faint` | `#6F6A60` | map labels beyond the edge only |
| `accent` | `#8EA4FF` | periwinkle: current step, current node, learnable rings, listening, progress |
| `accent-text` | `#B4C2FF` | accent used as text (links, "learnable" labels, highlighted math) |
| `accent-halo` | `rgba(142,164,255,0.18)` | 4px halo around current dots |

- Primary buttons are **ivory** (`text` on `bg` inverted), not accent. The accent marks state, not actions. The one exception is the danger button, used only to confirm erasing data.
- Only one accent colour. Success/warning/danger are not part of the palette yet; if needed, use muted versions that pass contrast and never compete with the accent.
- All text meets WCAG AA on its background (the values above do).
- A light theme is not required for R1. Keep all colours in tokens (CSS variables) so one can be added.

## 3. Typography

- **Geist** (Vercel, SIL OFL 1.1, bundled locally from the `@fontsource/geist` and `@fontsource/geist-mono` packages so the app works offline; OFL allows bundling the font with software that is sold, it only forbids selling the font on its own) for everything. No serif, no monospace in the UI. Code blocks inside explanations may use Geist Mono.
- Weights: 300 (learner's own text, long secondary text), 400 (body), 500 (headings, emphasis, primary buttons), 600 (brand mark only).

| Style | Size / line height | Weight | Letter spacing | Use |
| --- | --- | --- | --- | --- |
| Display | 36 / 1.22 | 500 | -0.025em | page titles (screen names, goal titles, "What do you want to achieve?") |
| Question | 24 / 1.45 | 400 | -0.012em | every question the learner answers (session cards, probe), rendered as Markdown with KaTeX math |
| Title | 24 / 1.3 | 500 | -0.02em | side panel titles |
| Heading | 18 / 1.35 | 500 | -0.01em | section headings in the main column |
| Learner text | 19 / 1.55 | 300 | 0 | the answer field and the learner's past answers |
| Breadcrumb | 15 / 1.5 | 400 | 0 | path at the top of the main column |
| Body | 14 / 1.5 | 400 | 0 | default |
| Small | 13 / 1.45 | 400 | 0 | metadata, statuses |
| Caption | 12 / 1.4 | 400 (500 when current) | 0 | step labels, nav labels, hints |
| Map label | 11–12 | 400 | 0 | map node labels (current node: 15) |

- Math renders with KaTeX inline in any of these styles, at 1.1em of the surrounding text (KaTeX's default 1.21em is sized for serif text and looks oversized next to Geist). Math keeps the text colour; it is never set in accent.
- **Owner change (R1):** the mockups set the question in Display (36/500) with hand-typed Unicode math. That was too big and too heavy, and the math was not real LaTeX. Questions use the Question style above instead, and all math goes through KaTeX, so questions, explanations, statements and answers share one look.
- Sentence case everywhere; no exclamation marks.

## 4. Spacing, radius, layout

- Spacing steps (px): 4, 6, 8, 10, 12, 14, 16, 18, 22, 24, 28, 32, 36, 40, 48, 56, 72. Do not invent in-between values.
- Radius: 10 (nav items), 12 (inputs), 14 (small cards), 18 (answer surface, list cards), 999 (buttons, chips, pills), 50% (dots).
- **App shell** (R4):
  - Sidebar: 220 px, border-right `border`. On macOS the window has an inset title bar (traffic lights at 18/18 inside the sidebar) and the sidebar shows the system sidebar material under `rgba(24,22,19,0.62)`, so it stays warm; the rest of the window is opaque `bg`. Windows and Linux keep the standard frame and an opaque `#181715` sidebar. The theme is forced dark (`nativeTheme.themeSource`).
  - Sidebar content, top to bottom: the brand (22 px mark + "Frontier" 15 px weight 600), the live Session entry while a session is open or being planned (its 12 px hint on the right says "Thinking…" while the tutor works, "Your turn" when a card arrived while you were elsewhere, otherwise "Continue" or "Open now"), the places you work in (Today, Goals, Map, Cards, Stats), a "Look back" group (Lookup, Trails, Library) under an 11 px `text-muted` heading, and Settings at the bottom. Items: 32 px high, radius 8, 16 px Lucide icon (stroke 1.75, `text-muted`) + 13 px label (`text-secondary`); hover `rgba(238,234,226,0.05)`; selected `rgba(238,234,226,0.09)` with `text` label and accent icon. Each item has a hover hint saying what the place is for. A place can carry a quiet count at its right edge (12 px `text-muted`, tabular figures): Cards shows how many flashcards are to review.
  - Below 1024 px window width the sidebar is 64 px, icons only.
  - Main column: padding 56 top, 64 sides, 48 bottom; vertical gap 36 between blocks. Content max width **720 px**, left-aligned (not centred). Every screen title has a one-line `t-lead` under it saying what the screen is for.
  - Right panel: 420 px (at least 340), padding 48 / 36, `bg-panel`, border-left `border`, vertical gap 22–28.
  - Below 1100 px window width the right panel moves under the main column. No horizontal scrolling. The default window is 1360 × 880.
- **Alignment rules** (the owner checks these):
  - Breadcrumb, step path, question, answer surface and buttons share the main column's left edge exactly.
  - The step path spans the full column width: first point on the left edge, last label ending on the right edge, points evenly spaced, labels left-aligned under their points.
  - Grids of label/value pairs use fixed label columns (e.g. 120 or 150 px) so values align.
  - Lists inside cards: 14 px vertical / 20 px horizontal padding, 1px `border-strong` dividers.

## 5. Components

### Background work (R5)
- **Planning a session**: the Session screen shows the goal as a caption, "Planning your session" in Display and one lead line saying the learner can leave, then three 8 px accent dots in a slow wave (1.6 s, staggered 0.2 s; still at 60% with reduced motion).
- **An answer being judged**: the answer stays in the conversation as sent, with a thinking row under it: "Judging…" for answers to questions (graded cards, free recall), "Thinking…" for everything else, then Stop and "Esc to stop and edit" while it can still stop. The same shows when the learner comes back to the screen.
- **A failed answer**: one error notice above the conversation ("Your answer did not go through. … It is still in the field to send again.") and the answer back in the field.

### Choose what to learn (R5)
- A 620 px sheet (the shared sheet style) whose content scrolls between the fixed title and button row when the window is short. Top to bottom, 22 px apart: a small segmented control (Pick ideas · Describe it); the "what"; a settings group (rows like Settings) with Goal (a quiet select, "No goal" first) and, with a goal, "Count this in the goal's time" with a switch and a 12 px muted line saying where the time goes; the missing background; notices.
- **Pick ideas**: a 40 px search field with a quiet goal filter beside it (same height), then the ideas as a 196 px scrolling list card (rows 10/16 padding, a native checkbox in the accent, the name in 14 px `text-soft`, `text` once chosen, and on the right the idea's state in 12 px `text-muted` after the map's own mark: ivory dot for yours, accent ring for learnable now, small `node-muted` dot for needs something first). Ideas chosen when the sheet opened lead the list. Under it in 12 px: how many ideas, "N chosen · Clear", and "In this order: A → B" once two are chosen.
- **Describe it**: a 15 px question, a three-line field, and one muted line on what happens. While the session maker works: three 6 px accent dots and "Making your session. You can close this; it keeps going." The result is a `surface` card: the title (16 px, 500), the summary (12 px muted), and the ideas, each with a small accent-tint "New" tag when new to the map and its aim and minutes on the right.
- **Missing background**: a `surface` card, one row per group: "Nash equilibrium builds on **Best response**, which you have not learned yet." (14 px `text-soft`, the missing ideas in bold, the session maker's reason under it in 12 px muted) with "Add it first" (or "Add them first") as a link on the right; three rows at most, then "N more"; a last muted line: "Or start anyway: the tutor explains what it needs as it goes."
- The button row: the estimate on the left ("About 40 minutes · 3 ideas", 13 px `text-secondary`), Cancel, and one primary action that moves the flow on ("Plan the session" for a description not yet planned, then "Start session").
- **Switch**: a 38 × 22 px track, `ring` when off and the accent when on, an 18 px ivory knob that slides 150 ms.
- **Entry points** are one quiet control each: a secondary button on the Session screen, a quiet button beside the planned start on Today, "Learn this now" as a link under the statement on the map's idea card, and "Learn these now" as a link at the right of an open skill's pip legend on the goal page.
- A session the learner chose shows "You chose this · free study" (or "· it counts toward <goal>") as a caption over its title before it begins; with no goal its breadcrumb starts with "Free study". Trails show the learner's words under "You asked" (the list shows them in quotes, two lines at most).

### Brand mark (R4)
A 24-unit circle: the left half filled `text` (what you know), the right half a dashed 1.6 accent arc (what lies beyond), and a 2.5 accent dot in the centre on a 4-unit gap in the background colour (you, on the edge). 22 px in the sidebar, 56 px on the welcome screen.

### Sheets (R4)
Every confirmation is a modal sheet on the native `<dialog>`: 440 px, radius 18, `surface-raised` with an inset `border-strong` and a soft shadow, a blurred 60% backdrop, fading in over 200 ms. 18 px title, 14 px `text-secondary` body, buttons at the bottom right (cancel left of the action). Actions that erase data use the danger button (`#E3A59B` fill, dark text) and, for erasing everything, a typed confirmation word. Esc or a click on the backdrop cancels.

### Buttons: press and hover (R4)
Buttons scale to 0.97 while pressed; secondary buttons take the hover fill. Inputs show an accent border and a 3 px `accent-halo` ring while focused. Clickable rows in list cards take the hover fill.

### Breadcrumb
`Course / Lecture 5 / Jacobian of a composition`. Readable names, not folder slugs. Separators `/` in `node-muted`, earlier items `text-secondary` and clickable, current item `text`. 15 px.

### Step path (horizontal)
The six session steps (Predict, Explain, Check, Connect, Own words, Use). Each point 11 px: done = filled `text`; current = filled `accent` + 4 px `accent-halo`; upcoming = 1.5 px ring `node-muted`. Connectors 1 px `border-strong` with 8 px gaps to each point. Labels 12 px below the point (10 px gap), current label `text` weight 500, others `text-muted`. Clicking a done point scrolls the session history to it.

### Vertical path
Same point styles, connector running down. Used for the lecture timeline on the goal page and anywhere a sequence is shown. The final milestone (exam) is an accent ring.

### Question
Question style (24/1.45, weight 400), Markdown with KaTeX. One sentence of framing ("Before I explain anything:") is part of the question, not a separate label.

### Answer surface
`surface`, radius 18, inset 1px `border-strong`, padding 22/24/18. Learner text style, no visible field border inside. Footer row above a 1px divider: left a listening/hint area, right the confidence chips (A guess · Fairly sure · Sure; selected = `chip-selected` + `text`). Placeholder: "Say it or type it, however it comes. Leave it empty if you have no idea." When text is arriving from dictation, five 3 px accent bars animate (scaleY 0.45→1, staggered 0.9–1.3 s) with the word "Listening"; otherwise show the hint "Speak or type, however it comes".

### Attachments and quotes (R4)
Above the answer text: image thumbnails (64 px, radius 10, a remove button each) and at most one quote block (2 px accent bar on the left, `text-soft`, three lines at most, a remove button). A paperclip icon button in the answer footer opens the file picker; paste and drop work anywhere on the answer surface. Selecting text in an earlier message shows the selection bar just above it (see Flashcards): Reply, while an answer box takes quotes, and Make a flashcard. In the history, a sent quote shows above the learner's answer and its images below it.

### Buttons
Primary: ivory pill, `bg` text, 44 px high, 22 px side padding, weight 500. Secondary: transparent pill, 1px `ring` border, `#D8D3C8` text. Keyboard hint beside, 12 px `text-muted` ("⌘↵ to submit").

### Chips and role tags
Choice chips: pills, 9/16 padding, 14 px; selected = ivory fill with `bg` text, unselected = 1px `ring` border. Role tags (Teaching content, Practice, Past exam, Scope, Reference): small pills, 12 px, `surface-selected`; "Past exam" uses the accent tint (`rgba(142,164,255,0.14)` + `accent-text`) because it changes how everything is practised.

### Session history (new in R1)
Past steps render above the current one in the same column: the card text in body style, the learner's answer in learner text style on a `surface` block, then the score and rationale (score as "8/10" in `text`, rationale in `text-soft`). Completed ideas collapse to one row: idea name, score, a chevron. Expanded sections keep the same alignment as the current step.

### Side panel: "Your frontier" map
- Nodes: owned = 8 px filled `text`; learnable now = 12 px 1.5 px accent ring on `bg-panel`; current = 14 px filled accent with a soft pulse (box-shadow 0 → 14 px, 2.4 s, only on this one element); beyond the edge = 7 px `node-muted` fill.
- Edges: 1 px `node-muted`. The edge of knowledge: a dashed accent line (opacity 0.45, dash 4/6) between owned and beyond.
- Labels: owned 11 px `text-muted`, learnable 12 px `accent-text`, current 15 px `text`, beyond 11 px `text-faint`.
- Legend below: Yours · Learnable now · Beyond your edge.
- Then a "Why this now" card (`surface-raised`, radius 14): 12 px label, 16 px weight 300 sentence.
- In the side panel the map shows the neighbourhood of the current idea (about 10–15 nodes) in two stacks of rows, laid out deterministically so it does not jump between steps: ideas you own on the left with labels ending at their point, the current and learnable ideas on the right with labels starting at their point, ideas beyond the edge one step further out. The dashed edge line runs down the gap and bends only to pass through the current idea. Labels have fixed boxes with an ellipsis (two lines for the current idea), so nothing ever overlaps; links touching the current idea are drawn in the accent at low opacity. The Map screen uses the same node styles.

### Map screen (new in R3)
- The graph fills the content area on `bg` (in full screen, the whole screen). Everything else floats over it: the title, counts and search top left; View, Replay how it grew and Full screen as quiet pills top right (`map-button`: `bg-panel` at 90%, inset 1px `border-strong`, 13 px `text-secondary`); Fit, + and − bottom right; the legend bottom left in 12 px.
- Ideas: radius 3 px plus 1.6 px per √(ideas built on it), owned ones a little larger by depth, scaled gently with zoom. Links 1 px `node-muted` at 18–43% opacity by zoom; junctions are 5 px diamonds. A simplified idea has a 6 × 1.6 px `text-secondary` bar under it.
- Hover lens: the hovered (or selected) idea, its neighbours and their links stay at full strength, links in the accent; everything else drops to about 14% (links 5%). The selected idea gets a 7 px accent halo; search matches a 1.5 px accent ring.
- Labels: 12 px, placed to the right of the idea, most important first and never overlapping each other or an overlay. Ordinary labels fade in over 35% of the zoom threshold; the lens and matches are always labelled on an 80% `bg` plate.
- Colour by goal or topic uses the Stats series colours in their fixed order, with `node-muted` for the rest; by depth, a ramp from `node-muted` to `text`.
- Tooltip and idea card: the tooltip is the shared chart tooltip (`surface-selected`, radius 10, at most 260 px). The idea card is a 380 px floating panel on the left (`bg-panel` at 95%, radius 18, inset `border-strong`, blur 10 px, a soft shadow) with the neighbourhood chips (Off, 1 step, 2 steps, 3 steps) above the card content. The view panel floats top right, 300 px, in the same style, with four folding groups (Filters, Colour, Display, Forces), mini-chip switches, accent sliders and "Reset to defaults".

### Flashcards (R5)
- **Review card**: `surface`, radius 18, inset `border-strong`, padding 32/36, at least 260 px tall. A 12 px `text-muted` line on top (the card's ideas on the left, its goal on the right), the front in the Question style, and once shown the answer under a 1 px `border-strong` divider in 17 px `text-soft`. The queue above the card in 13 px `text-muted` ("5 to review · 3 new"). Under the card: Show answer (primary) with a `Space` key cap; once the answer shows, four rating buttons fill the row (Again, Hard, Good, Easy: 64 px high, radius 14, inset 1 px `ring`, the label 15 px weight 500 with its key cap at the right, and below it in 13 px `text-secondary` when the card comes back). A quiet line under them says what to do, with Edit card. The card fades in over 200 ms.
- **Finished queue**: a `surface` card with a 40 px accent-ring check, an 18 px line ("Done for now") and one plain sentence (cards reviewed today, when the next one comes back, new cards waiting for tomorrow), then See all cards and Write a card.
- **Key cap**: 11 px `text-muted` on `surface-selected`, radius 5, a 1 px `ring` bottom edge.
- **Card list** (All cards): a list card. Each row: the front (15 px, two lines at most), when it is due at the right (13 px `text-muted`, `accent-text` when due now), and a 12 px `text-muted` line (ideas · goal · how it was made). A row opens to its answer on `bg` (radius 12, inset `border-strong`) and quiet actions: Edit, Suspend, Show on map, Delete (which asks first).
- **Flashcard sheet**: the sheet at 600 px, one for every way a card is made or edited. Front and Back are card faces that show as they will in review (front 18 px, back 15 px `text-soft`, on `surface`, radius 14, inset `border-strong`); a click or Tab turns a face into plain text with the accent focus ring, and its math is previewed under it. The ideas are tags (13 px `surface-selected` pills with a remove button) with "Add an idea", whose matches list inside the sheet. While the card writer drafts, the faces show shimmer lines. The actions row has a quiet text action on the left (Write it myself, Draft it for me) and Cancel and Save on the right. ⌘↵ saves, Esc cancels.
- **Selection bar** (session messages): an ivory pill just above the selection (`text` fill, `bg` text, 13 px weight 500) holding Reply and Make a flashcard, divided by a 1 px line; it fades in over 120 ms.
- **Cards line** (Today, goal page): a 52 px `surface` row, radius 14, inset `border-strong`: a 16 px stack icon, "**23 flashcards** · 5 to review" in 14 px `text-secondary`, and a small Review button at the right. On Today it becomes the next card ("Flashcards") only when nothing else is due.
- **Switch** (on/off settings): a 38 × 22 track, `ring` when off and accent when on (the accent marks state), with an 18 px ivory knob that slides over 180 ms. Used for "Make flashcards for me" and in Settings.
- **Map**: the idea card lists its flashcards in a small list card (front, when it is due; a click shows the answer) under "Flashcards" with Add a card; the tooltip counts them; the view panel has "Only ideas with flashcards".

### Empty states
One plain sentence in `text-secondary` and, where useful, one action. No dashed boxes.

### Time and plans (new in R2)
- **Segmented control**: one pill track (`surface`, inset `border-strong`), the chosen segment an ivory pill with `bg` text. Used for how time is given (In total · Per week · Per day · Per lecture) and the Stats range.
- **Time picker**: a stepper (−, the number at 34 px weight 500, +) beside its unit in `text-soft`; a log-scale slider in the accent; quick picks as outlined mini chips ("2 hours · an article or a video"); then the true total in `accent-text` 22 px, the one number the plan is made for.
- **Budget bar**: a 10 px track (6 px compact). Spent in ivory, the time the plan holds ahead in accent stripes (135°), the rest empty; a 2 px `text-secondary` tick where the budget's rhythm puts you by now. Legend below in 13 px.
- **Idea field**: the plan as 16 px dots on a `surface` card: in depth = filled accent with halo, overview = 2 px accent ring, already yours = filled ivory, left out = dashed `node-muted` ring at 80%; a 7 px amber dot on an idea another goal shares. Dots ease between states as the time changes. Hovering or focusing a dot shows a 288 px tip centred above it (so it never covers the row): the state with its dot, the idea's name, its statement (four lines at most) and one plain sentence on what the plan does with it.
- **Depth pips**: five 8 px dots per idea: filled ivory up to what you know, accent ring up to the planned depth, dashed up to what the goal asks beyond the time. Shown with a one-line legend.
- **Progress panel** (goal page): a raised card with up to four figures (30 px number, the target after a slash in `text-muted`, a 13 px label), the budget bar, a pace sentence (amber `#E8C27A` only when it needs attention, accent when ahead, `text-secondary` when on track), then the primary action.
- **Wizard**: the horizontal step path on top with "Cancel"/"Finish later" on the right, one question group per step, Back (quiet) and the primary action at the bottom right above a 1 px divider. Questions are 15 px `text` with a 13 px `text-muted` hint underneath.
- **Welcome**: a 56 px brand mark, a 44 px headline, one lead paragraph, three numbered step cards, one large primary button.
- **Radio cards** (R5): a grid of equal cards (`surface`, radius 14, inset `border-strong`, 16/18 padding; at least 180 px each, wrapping) with a 15 px weight 500 title and a 13 px `text-secondary` line under it, indented to the title. A 14 px radio dot sits before the title: a 1.5 px `node-muted` ring, or, when chosen, filled accent with a 4 px `accent-halo`; the chosen card is `surface-raised` with an inset 1 px `text-secondary` outline. Arrow keys move the choice. Used for sizing a goal: "Fit it to a time" or "No time limit", and under the latter the wanted depth (Big picture, Working knowledge, In full).
- **Estimate** (R5): with no time limit, the plan step's time box holds a 12 px caption ("No time limit · Working knowledge", with Change on the right), the estimate in `accent-text` 22 px ("About 14 hours · about 19 sessions") and one 13 px line. On the goal page the figures show "studied" and "about … left, estimated" instead of time against the budget; the budget bar's second segment reads "about … left", and the idea field drops "Left out" from its legend.
- **Addition panel** (R5): the goal page's "Add to this goal" swaps the progress panel for one question ("What else do you want to learn here?", 18 px) with a line on breadth and depth, the goal-sentence field and "See what it adds" (⌘↵). The request then lives in a panel above the progress panel, styled like the re-map panel (`surface-raised`, radius 22, inset `ring`): an accent caption "Adding to this goal" and the request in quotes; while it is worked out, five loading dots, one line and Cancel on one row; when ready, a 13 px line on its shape (broad or focused), the new skills as a list with 6 px accent bullets, their ideas as an idea field, the change in `accent-text` 22 px ("+5 ideas · your 10 hours stay" or "+5 ideas · about +2.5 hours") with one 13 px line and a "Which ideas make room" disclosure, then Add / Cancel. A request that does not fit leads with the reason on a muted amber card (`rgba(232,194,122,0.08)`, inset amber at 22%) and offers "Make it a new goal" (primary), "Add it anyway" and Cancel. An added skill shows "You added this · “request”" in 12 px `text-muted` under its statement.
- **Goal context** (R5): in the goal step and Edit goal, a multi-line input (at least 96 px, growing with the text up to 320 px) under "Anything the plan should know?", with a 12 px hint that says what happens on save when it changed; a character count appears on the right only in the last 500 of 4,000 characters. On the goal page the context sits under the goal's sentence: 14 px `text-secondary` with a 2 px `border-strong` bar on the left, two lines with a More / Less link.

### Stats (new in R2)
Cards on `surface` with an 18 px heading and a 13 px muted note saying how to read the chart. Charts are SVG drawn at their real width: 11 px `text-muted` axis text, 1 px `border-strong` grid, bars with 4 px rounded data ends and 2 px gaps between stacked segments, 2 px lines with direct labels at their ends, a crosshair and tooltip on hover (`surface-selected`, radius 10). Goal colours in fixed order (`#7489E6`, `#D95926`, `#199E70`, `#C98500`, `#D55181`, `#9085E9`, then `#5A554C` for the rest), validated for colour-vision deficiency on the dark surface; a goal keeps its colour under every filter. Free study (sessions the learner chose, booked to no goal) is a warm light grey `#A8A294`, apart from every goal's colour, with its own line under the budgets. Sequential data (the calendar) uses the accent at four opacities. "Worth knowing" is an accent-tinted card with 16 px weight 300 sentences.

## 6. Motion
- Default transitions 150–200 ms ease-out (hover, selection, expanding history).
- The only looping animations: the current map node's pulse, the listening bars, the live Session dot in the rail, the dots while a goal is being mapped and the dots while a session is planned. The Map's layout moves while it settles (a second or two after a change, or while an idea is dragged), the camera glides 360 ms to a chosen idea, and Replay how it grew runs about 6 s when asked; with reduced motion the layout settles at once and the camera jumps. Steps of the goal wizard and the welcome fade in once (260–400 ms). Respect `prefers-reduced-motion` (disable all of them).

## 7. Accessibility
Real buttons, links, inputs and labels; visible focus rings (2 px accent outline, 2 px offset); icon-only controls get labels; all text AA; the map has a text alternative (the ideas shown, listed by state, each one selectable), and the search reaches any idea by name.
