---
name: ship-task
description: Pick up ready tasks from the Notion "Recipe Project — Implementation Tasks" database, route each to Claude or Codex to implement, have the other model review it, open the PR, and merge once Greg Szu-Tu approves. Use when the user says "ship-task", "pick up the next task", "work the task list", or "merge approved tasks".
---

# ship-task

Claude orchestrates (it holds the Notion and GitHub access). Claude and Codex both implement and both review, but never their own work. The orchestrator owns all git, Notion and GitHub writes.

Arguments:
- none → pick up every ready task (confirm the plan first)
- `P2-5 P3-2` → pick up only those tasks
- `next` → pick up the single highest-priority ready task
- `merge` → run only the Merge phase over open task PRs
- append `implementer=claude|codex` to override routing for the named tasks

## Fixed facts

- Tasks data source: `collection://d93df7fb-c825-836e-ab1b-073879c029ad`
- Statuses: Not Started → In Progress → Ready for AI Review → Done; Blocked on failure.
- GitHub: repo `szu-tu-pm/obsidian-recipe-clipper`. User Lin is `moogiwara`; Greg Szu-Tu (merge sign-off) is `szu-tu-pm`. `main` has no branch protection, so this workflow enforces the sign-off itself.
- Worktrees: `../obsidian-recipe-clipper-wt/<task-id>`. Run artifacts (briefs, reviews): `../obsidian-recipe-clipper-wt/_runs/<task-id>/`.
- Scripts in `scripts/agents/`: `codex.sh` (implement and review), `verify.sh` (the orchestrator's checks), `review-rubric.md` (shared by implementers and reviewers), `review-schema.json` (verdict shape), `render-review.mjs` (verdict → PR comment).
- Run every `git`/`gh` command for a task inside its worktree (`git -C <worktree>`, or `cd <worktree> && …` in the same command). `_runs/` is not a git repo, and the shell's directory resets between calls.
- The shell is zsh, so unquoted `$var` does not word-split. Never loop with `set -- $t` or `for x in $list`. Write one explicit `git worktree add <path> -b <branch> origin/main` per task, and check `git worktree list` afterwards. A split failure once created a local branch named `origin/main`.
- Notion property names are used exactly as the schema shows them: `"PR Link"`, `"Status"` (no `userDefined:` prefix).

## 1. Pick

1. `git fetch origin` and confirm `gh auth status` and `codex --version` work.
2. Query every row:
   `SELECT "Task ID","Task","Status","Priority","Owner","Dependencies","PR Link",url FROM "collection://d93df7fb-c825-836e-ab1b-073879c029ad"`
3. A task is **ready** when Status is Not Started, Owner contains "Lin", and every task ID named in Dependencies is Done. ("None" means no dependencies; P3-4's dependency on a release counts as a task dependency.) Sort by Priority (P0 first), then Task ID.
4. Route each ready task with the table below, then show the user one table: task, implementer, reviewer, branch. Wait for a yes before claiming anything — claiming writes to a shared database.

### Routing

| Implementer | Pick when the task is mostly… | Examples |
|---|---|---|
| **Codex** | tightly specified, test-heavy, or mechanical: eval harnesses, fixture corpora, benchmarks, data rules, pure domain logic and state machines with numeric gates | P2-5, P3-2, P4-2 |
| **Claude** | React/Obsidian UI, flows spanning several modules, specs that need interpreting from the PRD, prompts, docs and ADRs, anything with human-in-the-loop review UX | P2-7, P2-8, P3-1, P3-3, P4-3 |

The reviewer is always the other model. If a task fits both, prefer the model with fewer tasks in this run so the two work in parallel. Tasks whose main gate is a person (P3-4 release sign-off, P3-5 OS runs, P4-1 OAuth client setup) still go through the pipeline, but tell the user up front which parts stay manual.

## 2. Claim and brief (per task)

1. Notion: set Status → In Progress; add a page comment "Picked up by <Claude|Codex>; review by <other>; branch <branch>."
2. Fetch the task page. Also fetch the PRD page (`PRD - Recipe Project`) when the task text refers to it.
3. `git worktree add ../obsidian-recipe-clipper-wt/<id> -b <implementer>/<id>-<slug> origin/main`, then `npm ci` in the worktree (Codex runs sandboxed without network, so install first).
4. Write `_runs/<id>/brief.md`: task title, Overview, Deliverables, every acceptance criterion as a checklist, Dependencies' relevant file paths, then:
   - Read AGENTS.md first and follow it. (If AGENTS.md is not yet on `origin/main`, paste its rules here.)
   - **How you will be reviewed**: the full text of `scripts/agents/review-rubric.md`. Self-check against it before finishing. For any task with tests, evals, gates or thresholds, say up front which categories the data must cover and that each gate needs a mutation test. The rubric is the bar from round 1; don't let the reviewer teach it one round at a time.
   - **External formats and APIs**: when the task targets a third-party tool, format or API (Obsidian Web Clipper templates, Ollama, Gmail, the Obsidian API), fetch its official docs yourself with WebFetch and paste the relevant passages verbatim, with their URLs. Codex has no network, and an implementer guessing a format writes fixtures that confirm its own guess (P2-7's template captured only the first ingredient). Tell the implementer that test emulations of the tool may implement only documented behavior.
   - **Scope conflicts**: if a criterion cannot be met without changing code outside this task's deliverables, do not work around it. Measure honestly, leave it failing, and put it first in your report.
   - Do not commit, push or open a PR.
   - Run `npm run build` and `npm test` (plus coverage/eval if the gates name them) and end with: files changed; each criterion with the test proving it; measured numbers vs thresholds; criteria left for a person; anything unclear.

## 3. Implement

Start every task's implementer in the same turn so they run in parallel.

- **Codex**: `scripts/agents/codex.sh implement <worktree> _runs/<id>/brief.md _runs/<id>/impl-1.md` with Bash `run_in_background: true`. Progress is in `_runs/<id>/impl-1.log`.
- **Claude**: an Agent (general-purpose, `run_in_background: true`) told to work only inside the worktree path, given the brief's full text.

## 4. Verify (orchestrator, never trust the implementer's report)

`scripts/agents/verify.sh <worktree> _runs/<id>/verify-<n>.log [coverage] [eval]`: one PASS/FAIL line per step, plus the changed files. Confirm the Deliverables' paths are there and nothing unrelated changed. A FAIL on `eval` is fine only when the implementer reported it as an honest gate miss. Otherwise send the log back to the same implementer once (Codex: new `implement` run with brief + log; Claude: SendMessage to the same agent). A second failure → step 7.

## 5. PR

1. Commit in the worktree using the AGENTS.md commit style, ending with the attribution line from the system prompt. Push with `-u`.
2. `gh pr create --draft` with the AGENTS.md PR body sections. Copy the task's acceptance criteria as checkboxes, tick only those the verify step proved, and leave the human gates unticked.
3. Notion: set PR Link; Status → Ready for AI Review. Status stays there through review rounds.

## 6. Cross-review (up to 2 rounds)

Write `_runs/<id>/review-prompt-<n>.md`: the task spec and acceptance criteria, the full text of `scripts/agents/review-rubric.md`, the output path `_runs/<id>/review-<n>.json`, and from round 2 on the previous findings plus the fix commit SHA. Add task-specific suspicions you noticed while verifying (e.g. "6 coverage exclusions — check each").

- **Codex reviews Claude's work**: `scripts/agents/codex.sh review <worktree> _runs/<id>/review-prompt-<n>.md _runs/<id>/review-<n>.json`.
- **Claude reviews Codex's work**: a fresh Agent (no implementation context), told to `git fetch` and read `git diff origin/main...HEAD` in the worktree, and to write its JSON to the output path itself.

After each review, run `git -C <worktree> status`. Reviewers' eval runs can rewrite committed reports, so restore anything they touched with `git -C <worktree> checkout -- <paths>` before the next step.

Post every round with `node scripts/agents/render-review.mjs _runs/<id>/review-<n>.json <n> <reviewer> "<next step>" | gh pr comment <pr> -F -` (run from the worktree). Never hand-retype a review.

Pass when there are no blocker or major findings and `unmet_criteria` is empty. Otherwise the implementer (not the reviewer) fixes, then Verify, push, and review again. Fix brief `_runs/<id>/fix-<n>.md` = the brief + guidance + findings JSON:
- Describe what the fix must cover or catch, never only a number to hit. "≥ 50 items" got 73 trivial lines; name the categories and ask for a per-category result.
- Turn each major into something the implementer must prove: reuse the reviewer's mutation or input, and require a test that fails on it.
- List every minor and ask for a one-line disposition of each.
- Keep the fix as narrow as the findings allow, and say which files may change.

Before another round, triage with the user instead of looping when:
- **The gate fails only on out-of-scope defects** (rubric class a): propose a follow-up task for those defects and accept this task with an honest failing baseline plus pinned per-category values.
- **Only small, mechanical findings remain**: propose one narrow final fix limited to those items.

After round 2 still fails → step 7. Only the user can authorize an extra round for a specific task; record that on the PR.

Reviews of user-authorized extra rounds are **verify-only**: the reviewer confirms each listed finding is fixed, with a test and a mutation, and checks the code the fix touched for regressions. It does not hunt for new edge cases elsewhere. A full review of a guard-style feature finds a smaller edge case every round (P2-8: word amounts, then pairs, then range endpoints). The extra rounds exist to close known findings, not to restart the search. Further edge cases go in the PR comment as minors or follow-ups.

The cross-review is Lin's audit (Lin does not use Antigravity). On pass: `gh pr ready <n>`, `gh pr edit <n> --add-reviewer szu-tu-pm`, tick the "**Lin**'s audit: the Claude/Codex cross-review passes…" box in the task page's acceptance checklist with a link to the passing PR comment, and add a Notion comment "AI cross-review passed (Lin's audit); awaiting Greg Szu-Tu sign-off." When a task goes Blocked, Lin takes over the audit by hand.

## 7. Blocked

Status → Blocked. Notion comment with the failing command output or the open findings, and the PR link. Leave the worktree for a person to pick up. Continue with the other tasks.

## 8. Merge (`ship-task merge`, or at the end of a run)

For each task with Status Ready for AI Review and a PR Link:

1. `gh pr view <n> --json state,isDraft,reviews,statusCheckRollup,mergeable`
2. Merge only when all hold: not draft; every check in statusCheckRollup is SUCCESS; mergeable is MERGEABLE; the latest review from `szu-tu-pm` is APPROVED and newer than the last commit. If any fails, report which and skip. Never merge without Greg's approval, even if asked to hurry.
3. `gh pr merge <n> --merge --delete-branch` (repo history uses merge commits).
4. Notion: Status → Done; tick the "**Greg Szu-Tu** approves and signs off the PR merge" box in the page's acceptance checklist and append the PR link to it.
5. `git worktree remove ../obsidian-recipe-clipper-wt/<id>`.
6. Re-run Pick: a merge can unblock new tasks. Offer them; do not start them unasked.

## Report

End with a table per task: implementer, reviewer, rounds, verify result, PR link, Notion status, and what is waiting on a person.
