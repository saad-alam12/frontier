# Frontier — project instructions for Claude Code

Frontier is a local desktop learning app. Read these before doing anything:

- `docs/design.md` — what the product is (source of truth)
- `docs/build-plan.md` — milestones M0–M6 and their acceptance checks
- `docs/progress.md` — what is done, what is next, open questions

## How to work

- Build milestones in order. Do not start a milestone until the previous one passes its acceptance checks.
- At the end of each milestone: all tests pass, typecheck and lint are clean, `docs/progress.md` is updated, and the work is committed as `M<n>: <title>`.
- When working autonomously, keep going milestone by milestone. Stop and ask the owner only for: decisions the design does not settle and that are expensive to reverse, anything needing their accounts or logins, and the manual checkpoints after M2, M4 and M6.
- When the design is silent on a detail, choose the simplest option consistent with it, record the choice under "Decisions" in `docs/progress.md`, and continue.
- If you change the design, update `docs/design.md` in the same commit.

## Licensing rules (strict)

The owner wants to keep every option open, including selling or distributing this app later.

- Dependencies must use permissive licenses only: MIT, Apache-2.0, BSD-2/3-Clause, ISC, 0BSD, or similar. Check the license of every new dependency (and of any ML model weights) before adding it. Never add GPL, LGPL, AGPL, SSPL or "non-commercial" dependencies.
- The Claude Agent SDK is the one allowed non-open-source dependency. Keep it isolated in `backend/llm/AgentSdkProvider` so it can be swapped out.
- Never copy or adapt code, prompts, text or assets from LearnHarness (github.com/amosblomqvist/learnharness, AGPL-3.0) or any other copyleft project. Do not read its source files for reference. Using its published ideas, as already described in `docs/design.md`, is fine.
- All prompts in `prompts/` are written from scratch for this project.
- No LICENSE file yet: the code is all rights reserved by the owner until they choose a license.

## Architecture rules

- Layers: `ui/` (render only) → `backend/api/` (IPC transport) → `backend/agents/`, `backend/core/` → `backend/store/`. Imports point inward. `core/` is pure (no IO).
- LLMs judge, code mechanizes. Fringe, scheduling, FSRS, merging, dedupe, tiers and score arithmetic are deterministic code with unit tests.
- One writer per store: only the merger writes the world layer (nodes, chains); only the evidence service writes evidence. NodeState is derived from evidence.
- Evidence is append-only.
- Every LLM call goes through `backend/llm/` with a role name. Agents end by calling a `submit_*` tool validated with zod; validation errors go back to the model (max 3 retries).
- Tests never hit the network or a real model: use `FakeProvider`. Live-model checks are separate scripts (`npm run live:<name>`) and are run deliberately.

## Model provider

- Default: the Claude Agent SDK, authenticated with the owner's existing Claude login on this machine (their subscription). Check the current Agent SDK documentation before implementing; do not rely on memory for its API.
- Alternative: `@anthropic-ai/sdk` with an API key from settings.
- Keep background concurrency low (default 3 parallel model calls) because usage counts against the owner's plan limits.

## Code style

- TypeScript strict, `noUncheckedIndexedAccess`. zod schemas shared between producer and consumer.
- Small modules named by responsibility. No dead code; delete superseded paths.
- UI copy: sentence case, plain words, no exclamation marks.

## Commands

Fill these in during M0:

- `npm run dev` — run the app in development
- `npm test` — unit and integration tests (no network)
- `npm run typecheck`, `npm run lint`
- `npm run build` — build the desktop app

## Cloud and local workflow
- Building happens in Claude Code cloud sessions on the GitHub repo. Any
  cloud session, whatever its prompt, reads docs/progress.md and continues
  with the next unfinished milestone, following the rules above. Push the
  branch after every milestone so no work is lost.
- Owner checkpoints come after M2, M4 and M6. At a checkpoint the cloud
  session pushes its branch, writes "CHECKPOINT M<n> READY" plus exact
  steps for the owner to try under "Next step" in docs/progress.md,
  commits, pushes, and stops.
- Anything that needs the owner's login or a decision: skip it, note it
  under "Open questions for the owner" in docs/progress.md, and continue
  with work that doesn't depend on it. Test the model connection with the
  fake provider; the owner does the live test locally.
- Local sessions on the owner's Mac start by running git fetch, checking
  out the newest claude/* branch (or main if none is newer) and reading
  docs/progress.md. If a checkpoint is ready: run npm install and npm run
  dev, open the app, walk the owner through what to try, write their
  feedback under "Owner feedback" in docs/progress.md, commit and push.
  Then start the next cloud session from this branch with
  claude --cloud "Continue the build", and tell the owner it is running.
- If no checkpoint is ready, report progress from docs/progress.md in two
  or three sentences.
