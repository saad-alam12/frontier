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

- Primary buttons are **ivory** (`text` on `bg` inverted), not accent. The accent marks state, not actions.
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
- **App shell** (desktop, ≥ 1200 px wide):
  - Left nav rail: 96 px, border-right `border`. Brand mark (28 px ring with an accent dot) then text items 72 px wide, 12 px, radius 10; selected = `surface-selected` + `text`. Settings sits alone at the bottom of the rail.
  - Main column: padding 56 top, 72 sides, 48 bottom; vertical gap 36 between blocks. Content max width **720 px**, left-aligned (not centred).
  - Right panel: 520–560 px, padding 48 / 40, `bg-panel`, border-left `border`, vertical gap 22–28.
  - Below 1200 px the right panel moves under the main column; below 700 px the nav becomes a top bar. No horizontal scrolling.
- **Alignment rules** (the owner checks these):
  - Breadcrumb, step path, question, answer surface and buttons share the main column's left edge exactly.
  - The step path spans the full column width: first point on the left edge, last label ending on the right edge, points evenly spaced, labels left-aligned under their points.
  - Grids of label/value pairs use fixed label columns (e.g. 120 or 150 px) so values align.
  - Lists inside cards: 14 px vertical / 20 px horizontal padding, 1px `border-strong` dividers.

## 5. Components

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
- In the side panel the map shows the neighbourhood of the current idea (about 10–15 nodes) in two stacks of rows, laid out deterministically so it does not jump between steps: ideas you own on the left with labels ending at their point, the current and learnable ideas on the right with labels starting at their point, ideas beyond the edge one step further out. The dashed edge line runs down the gap and bends only to pass through the current idea. Labels have fixed boxes with an ellipsis (two lines for the current idea), so nothing ever overlaps; links touching the current idea are drawn in the accent at low opacity. The full Map screen (M6) uses the same node styles.

### Empty states
One plain sentence in `text-secondary` and, where useful, one action. No dashed boxes.

### Time and plans (new in R2)
- **Segmented control**: one pill track (`surface`, inset `border-strong`), the chosen segment an ivory pill with `bg` text. Used for how time is given (In total · Per week · Per day · Per lecture) and the Stats range.
- **Time picker**: a stepper (−, the number at 34 px weight 500, +) beside its unit in `text-soft`; a log-scale slider in the accent; quick picks as outlined mini chips ("2 hours · an article or a video"); then the true total in `accent-text` 22 px, the one number the plan is made for.
- **Budget bar**: a 10 px track (6 px compact). Spent in ivory, the time the plan holds ahead in accent stripes (135°), the rest empty; a 2 px `text-secondary` tick where the budget's rhythm puts you by now. Legend below in 13 px.
- **Idea field**: the plan as 16 px dots on a `surface` card: in depth = filled accent with halo, overview = 2 px accent ring, already yours = filled ivory, left out = dashed `node-muted` ring at 80%; a 7 px amber dot on an idea another goal shares. Dots ease between states as the time changes.
- **Depth pips**: five 8 px dots per idea: filled ivory up to what you know, accent ring up to the planned depth, dashed up to what the goal asks beyond the time. Shown with a one-line legend.
- **Progress panel** (goal page): a raised card with up to four figures (30 px number, the target after a slash in `text-muted`, a 13 px label), the budget bar, a pace sentence (amber `#E8C27A` only when it needs attention, accent when ahead, `text-secondary` when on track), then the primary action.
- **Wizard**: the horizontal step path on top with "Cancel"/"Finish later" on the right, one question group per step, Back (quiet) and the primary action at the bottom right above a 1 px divider. Questions are 15 px `text` with a 13 px `text-muted` hint underneath.
- **Welcome**: a 56 px brand mark, a 44 px headline, one lead paragraph, three numbered step cards, one large primary button.

### Stats (new in R2)
Cards on `surface` with an 18 px heading and a 13 px muted note saying how to read the chart. Charts are SVG drawn at their real width: 11 px `text-muted` axis text, 1 px `border-strong` grid, bars with 4 px rounded data ends and 2 px gaps between stacked segments, 2 px lines with direct labels at their ends, a crosshair and tooltip on hover (`surface-selected`, radius 10). Goal colours in fixed order (`#7489E6`, `#D95926`, `#199E70`, `#C98500`, `#D55181`, `#9085E9`, then `#5A554C` for the rest), validated for colour-vision deficiency on the dark surface; a goal keeps its colour under every filter. Sequential data (the calendar) uses the accent at four opacities. "Worth knowing" is an accent-tinted card with 16 px weight 300 sentences.

## 6. Motion
- Default transitions 150–200 ms ease-out (hover, selection, expanding history).
- The only looping animations: the current map node's pulse, the listening bars, the live Session dot in the rail and the dots while a goal is being mapped. Steps of the goal wizard and the welcome fade in once (260–400 ms). Respect `prefers-reduced-motion` (disable all of them).

## 7. Accessibility
Real buttons, links, inputs and labels; visible focus rings (2 px accent outline, 2 px offset); icon-only controls get labels; all text AA; the map has a text alternative (the list of nodes by state).
