# Frontier

A local desktop app for learning anything, toward goals you set, at the edge of what you know. It teaches one reasoning step at a time, keeps a two-layer map of what is true and what you own, and maintains memory through goal-shaped practice instead of flashcards.

- Design: `docs/design.md`
- Build plan: `docs/build-plan.md`
- Progress: `docs/progress.md`
- Instructions for Claude Code: `CLAUDE.md`

## Running it

```
npm install
npm run dev        # open the app in development
npm test           # unit and integration tests, no network
npm run typecheck && npm run lint
npm run build      # unsigned desktop build in release/
npm run live:connection   # real-model checks, run deliberately: also live:ingest, live:session
```

## Getting started with Claude Code

1. Make sure Claude Code is installed and you are logged in with your Claude account (`claude` in a terminal).
2. Put this folder somewhere permanent, then in a terminal:

   ```
   cd path/to/frontier
   git init
   git add .
   git commit -m "Design and build plan"
   ```

3. Optional but recommended: create a private GitHub repository and push this folder to it.
4. Start Claude Code in this folder (`claude`) and give it the kickoff prompt below.

## Kickoff prompt

```
Read CLAUDE.md, docs/design.md, docs/build-plan.md and docs/progress.md.
Then build the MVP autonomously, milestone by milestone, starting with M0.
Follow the rules in CLAUDE.md. After each milestone run all checks, update
docs/progress.md and commit. Stop only for the reasons CLAUDE.md lists,
including the owner checkpoints after M2, M4 and M6.
```

All rights reserved until a license is chosen.
