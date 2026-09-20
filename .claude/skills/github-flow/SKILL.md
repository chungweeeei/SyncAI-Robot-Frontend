---
name: github-flow
description: >
  How work lands in this repo: branching, splitting a change into commits,
  opening and stacking PRs with gh, watching CI, and cleaning up branches.
  Use when committing, pushing, opening a PR, or debugging a failing check.
metadata:
  origin: project
---

# Landing Work in This Repo

CLAUDE.md states the rules (branch prefixes, Conventional Commits, PRs target
`dev`). This is the procedure, plus the things that are only learned by
getting them wrong. Every gotcha below cost real time in this repo.

## Topology

```
main   release branch, always deployable — also the DEFAULT branch
 └─ dev   integration branch; day-to-day work merges here
     └─ <type>/<kebab-description>   cut from dev, PR back into dev
```

`main` being the **default** branch matters for more than PR targets — see
"The review workflow only runs from the default branch" below.

## Before you commit

Run the gates first. A push that fails CI costs a round trip that `npx tsc
--noEmit && npm run lint && npm test` would have caught in a minute:

```bash
npx tsc --noEmit && npm run lint && npm test && npm run build
npm run test:e2e   # slower; before pushing, not on every commit
```

## Splitting a change into commits

"One logical change per commit" is the rule. For a large refactor it collides
with "each commit should build", because the same file often carries two
concerns. Resolve it like this:

1. **Order the commits bottom-up**: `lib/` → `hooks/` → `components/` → `app/`,
   with config and tooling first. The diff then reads in dependency order.
2. **Assign each file to its dominant concern.** Git commits whole files;
   splitting a file across commits means per-hunk staging, which is not worth
   it across dozens of files.
3. **When a concern rides along in another commit, say so in the body.** A
   copy rewrite folded into a feature commit is fine; a copy rewrite folded in
   *silently* is not.
4. **If the intermediate commits do not individually build, say that in the
   PR**, and make sure the final state does. A refactor developed as a whole
   lands as a whole.

Commit subjects are imperative, no trailing period, scope in parens:
`feat(dashboard): stream pointcloud into three.js buffers`.

## Opening a PR

Use `--body-file`, never `--body` with a long inline string — a heredoc keeps
backticks, `$`, and newlines intact:

```bash
cat > /tmp/pr.md <<'EOF'
## What this fixes
...
EOF
gh pr create --base dev --head <branch> --title "<type>(<scope>): <subject>" --body-file /tmp/pr.md
```

Write the body for a reviewer who was not there: what was broken, what the fix
is, and what you could not verify. Note anything that would surprise them —
non-building intermediate commits, a concern folded into another commit, a
platform you did not test on.

### Stacked PRs

A branch cut from another unmerged branch produces a PR that shows **both**
sets of commits until the lower one merges. That is normal, not a mistake.
Say so in the body ("Stacked on #1 — review that first") and merge bottom-up;
the upper PR recomputes its diff automatically.

## Watching CI

```bash
gh pr checks <n>                     # current state
gh run view --job <id> --log-failed  # just the failure
gh run rerun <run-id> --failed       # re-run only failed jobs
```

For a long run, poll in a Monitor rather than sleeping: emit a line per check
that leaves `pending`, and exit when none are pending.

When a job fails, **read the log before changing anything**. Two of the three
CI failures in this repo's history were environment, not code.

## Cleaning up

Verify the work is actually on `dev` before deleting anything:

```bash
git fetch --prune origin
git merge-base --is-ancestor <branch> origin/dev && echo "safe to delete"
git push origin --delete <branch>
git branch -d <branch>     # -d, never -D: git re-checks the merge for you
```

`git branch -D` on an unmerged branch loses the commits. There is no reason to
reach for it here.

---

## Gotchas

### `pull_request` workflows come from the PR's head branch

Not from the merge result. A branch cut from an old base does **not** run
workflows added to `dev` since — its PR silently runs fewer checks. If a PR
shows fewer checks than expected, the branch is stale: rebase onto `dev`.

### The review workflow only runs from the default branch

`anthropics/claude-code-action` refuses to run unless
`.github/workflows/claude-review.yml` exists **with identical content on the
default branch**, which is `main`. This blocks the pwn-request attack where a
PR edits the workflow and runs arbitrary code with the repo's credentials.

Two consequences:

- A PR that *introduces or edits* a review workflow can never exercise it.
  The job reports `Exiting due to workflow validation skip` and passes. This
  is expected; do not debug it.
- **The workflow currently lives on `dev` but not on `main`, so reviews do not
  run yet.** They start once a `dev` → `main` release PR lands it there.

### Never push one ref onto another branch's name

`git push origin <branch>:dev` lands code on the integration branch with no
review, and is blocked here. Open a PR. To create a branch at another branch's
commit, do it in the GitHub UI or push it under its own name.

### Interactive commands hang

`claude setup-token`, `gh secret set` (without `--body`), `gh auth login` and
`git rebase -i` all wait on input that this harness cannot provide; they hit
the timeout and get backgrounded. Run them in a real terminal, or with the `!`
prefix — and never pass a credential as a command argument, where it lands in
the shell history and in this session's transcript.

### `gh` fails on App-scoped endpoints

`gh api /user/installations` returns 403 with a normal user token — it needs a
GitHub App token. To check whether an App is installed, look in the repo's
Settings → GitHub Apps, or just run the workflow and read the error.

## Checklist

- [ ] Branched from `dev` with a `<type>/<kebab>` name
- [ ] Gates pass locally before pushing
- [ ] Commits are Conventional, imperative, one concern each where feasible
- [ ] PR targets `dev`, body written for someone who was not there
- [ ] Stacking, non-building intermediates and untested platforms called out
- [ ] CI green before merge
- [ ] After merge: verified with `--is-ancestor`, deleted with `-d`
