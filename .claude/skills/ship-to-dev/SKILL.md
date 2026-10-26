---
name: ship-to-dev
description: >
  Ship the work on the current branch end to end: run the gates, commit,
  push, open a PR to dev, watch CI, merge it, and delete the branch locally
  and on the remote. User invoked (/ship-to-dev); invoking it is the
  go-ahead to merge into dev.
metadata:
  origin: project
---

# Ship to dev

The loop this repo's day-to-day work runs: a change on a branch ends up
merged into `dev`, with its branch gone. `github-flow` is the reference for
each git step (and its gotchas); this skill is the order they are run in.

**Invoking it is the authorization to merge into `dev`.** Nothing else in
it asks. It still *stops and reports* rather than pushing through on any of
the stop conditions below — a red gate, a red check, a branch that is not
an ancestor of `origin/dev` — because those are the cases where merging
would land something nobody looked at.

## 0. Where you start

- On a `<type>/<kebab>` branch cut from `dev` (CLAUDE.md's prefixes). On
  `dev` itself with uncommitted work: cut the branch first, named for the
  change. Never on `main`.
- `git status` shows only this change. Anything unrelated is the user's;
  leave it out of the commits and say so.

## 1. Gates

```bash
npx tsc --noEmit && npm run lint && npm test
```

Then the e2e specs the change touches (the whole suite for a broad change).
**Check port 3001 first** — playwright reuses whatever listens there (a
`next dev` or a container), which would test that build instead of this one:

```bash
lsof -iTCP:3001 -sTCP:LISTEN
```

If it is taken, run against 3011 with a config in the scratchpad that
spreads the repo's and moves the server (absolute import paths, since the
scratchpad has no `node_modules`):

```ts
import base from "<repo>/playwright.config";
import { defineConfig } from "<repo>/node_modules/@playwright/test";
export default defineConfig({
  ...base,
  testDir: "<repo>/e2e",
  use: { ...base.use, baseURL: "http://127.0.0.1:3011" },
  webServer: {
    command: "npm run build && npx next start -p 3011",
    cwd: "<repo>",
    url: "http://127.0.0.1:3011",
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
```

A failure in a test the change does not touch is not automatically a flake:
re-run it alone (`--repeat-each=3`), and if it still fails, `git stash -u`,
run it on clean `dev`, `git stash pop`. Only "fails on dev too" or "passes
alone" may be reported as unrelated — with that evidence in the PR body.

**Stop** on a failure the change caused.

## 2. Commits

Conventional Commits, one concern each, bottom-up (`lib/` → `hooks/` →
`components/` → docs), as `github-flow` describes. The body says *why*.
End every message with the attribution line the session gives.

A change that alters what CLAUDE.md describes updates CLAUDE.md in its own
`docs:` commit.

## 3. Push and PR

```bash
git push -u origin <branch>
gh pr create --base dev --head <branch> --title "<first commit's subject>" --body-file <scratchpad>/pr.md
```

The body, for a reviewer who was not there: **Why**, **What**, **Tests**
(what ran, what passed, any unrelated failure and the evidence it is
unrelated), and **Not verified** (by hand, on a phone, on the robot) when
true. End it with the session's PR attribution line.

## 4. CI

```bash
gh pr checks <n> --watch --interval 30 >/dev/null 2>&1; gh pr checks <n>
```

Run it in the background and wait for the notification; do not poll.

- **All pass:** go on.
- **Any fail:** read the log first (`gh run view --job <id> --log-failed`).
  Two of this repo's early CI failures were environment, not code. Fix
  and push if it is the change; **stop and report** otherwise.
- `review` passing in ~10 s means it was *skipped*: the review workflow
  only runs once it is on `main` (see github-flow). Say so in the report —
  the PR had no automated review.

## 5. Merge and clean up

```bash
gh pr merge <n> --merge
git switch dev && git pull --ff-only origin dev
git fetch --prune origin
git merge-base --is-ancestor <branch> origin/dev   # stop if this fails
git push origin --delete <branch>                  # skip if already gone
git branch -d <branch>                             # -d, never -D
```

`--merge`, matching the merge commits `dev` already has.

## 6. Report

Short, to the operator: the PR link and that it merged (with the merge
commit), the branch deleted locally and on the remote, anything that was
skipped or could not be verified, and that `review` was skipped if it was.
