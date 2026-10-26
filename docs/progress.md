# Progress

## Status

| Milestone | Status | Notes |
| --- | --- | --- |
| M0 Skeleton and model provider | Done | Live connection test passed through the Agent SDK in the cloud session |
| M1 Knowledge store and core logic | Not started | |
| M2 Ingestion and Library | Not started | Owner checkpoint after |
| M3 Goals, probe and plan | Not started | |
| M4 Teaching session | Not started | Owner checkpoint after |
| M5 Practice, scheduler and Today | Not started | |
| M6 Map, Lookup, Trails, packaging | Not started | Owner checkpoint after |

## Next step

Start M1.

## Commands

- `npm install` then `npm run dev` opens the app in development.
- `npm test` runs unit and integration tests with the fake provider (no network).
- `npm run typecheck`, `npm run lint`.
- `npm run build` builds the desktop app into `release/`.
- `npm run live:connection` runs the connection test against the real model (uses the Claude login on this machine; set `FRONTIER_PROVIDER=anthropicApi` and `ANTHROPIC_API_KEY` for the API provider).

## Owner checkpoints to review

Collected here because the owner was asleep while the build continued.

### After M0

- Run `npm install` and `npm run dev`. The window should open with the sidebar and eight screens.
- In Settings, press "Test connection". With the Claude login on this Mac it should report "Connected via agentSdk" with one attempt. If it fails, try `npm run live:connection` in a terminal for the full error.

## Decisions

Record choices the design did not settle, newest first: date, decision, reason.

- 2026-10-26 — Agent SDK calls are stateless: a multi-message conversation is flattened into one prompt because `query()` takes a single prompt. Every agent builds its full context per call, so nothing is lost; the API provider sends real multi-turn messages.
- 2026-10-26 — Default models: `claude-opus-5-5` for tutor, goal compiler, prober, planner, problem generator, grader; `claude-sonnet-5-5` for extractor, matcher, librarian and the connection test. Editable per role in Settings.
- 2026-10-26 — Settings (provider, models, data folder, concurrency) live in `settings.json` under Electron's userData folder, not in the database, because the data folder path must be known before the database can open. The `settings` table in the DB (M1) is for in-app preferences.
- 2026-10-26 — Prompts are read from `prompts/*.md` at runtime (bundled with the app) instead of being inlined by the bundler, so the same code runs under vitest, tsx scripts and Electron.
- 2026-10-26 — SQLite through Node's built-in `node:sqlite` (available in Node 22+ and in Electron 45's Node 24) instead of better-sqlite3. Same synchronous API, no native module to rebuild for Electron, tests and app share one driver. Design table updated. better-sqlite3 remains the fallback if `node:sqlite` proves limiting.
- 2026-10-26 — Build tooling: electron-vite (MIT) with Vite 7, React 19, Tailwind 4, vitest 5, electron-builder for packaging. Layout: `backend/` for main-process code with `backend/main.ts` as the entry, `backend/api/preload.ts` as the preload, `ui/` as the renderer root.
- 2026-10-26 — The IPC transport is one `invoke` channel carrying a method name plus input, typed by `backend/api/contract.ts`; the UI imports only types from the backend. Events flow back over one event channel.

## Open questions for the owner

- The Agent SDK documentation says: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." For personal use on your own machine this is your login and your product; if you later distribute or sell Frontier, the subscription-login path may need Anthropic's approval, and the API-key provider is the clean alternative. Worth reading Anthropic's commercial terms before deciding on distribution.
