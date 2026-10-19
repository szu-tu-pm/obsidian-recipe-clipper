#!/usr/bin/env bash
# Run Codex non-interactively inside a task worktree.
#
#   codex.sh implement <worktree> <prompt-file> <out-file>   write code (no commits)
#   codex.sh review    <worktree> <prompt-file> <out-file>   review the branch against origin/main; writes JSON matching review-schema.json
#
# The orchestrator owns git: Codex never commits, pushes or opens PRs.
set -euo pipefail

mode=${1:?mode}; wt=${2:?worktree}; prompt=${3:?prompt file}; out=${4:?out file}
here=$(cd "$(dirname "$0")" && pwd)

case $mode in
  implement)
    codex exec -C "$wt" -s workspace-write -o "$out" - < "$prompt"
    ;;
  review)
    # Review in a disposable copy of HEAD so Codex can run Vitest (it writes caches) and try mutations
    # without touching the task worktree. node_modules is a copy-on-write clone, not a symlink, so writes stay inside the copy.
    tree="$(cd "$(dirname "$out")" && pwd)/review-tree"
    git -C "$wt" worktree remove --force "$tree" 2>/dev/null || true
    git -C "$wt" worktree add --detach "$tree" HEAD >/dev/null
    cp -cR "$wt/node_modules" "$tree/node_modules" 2>/dev/null || cp -R "$wt/node_modules" "$tree/node_modules"
    trap 'git -C "$wt" worktree remove --force "$tree" >/dev/null 2>&1 || true' EXIT
    # `codex exec review --base` rejects custom instructions, and the review needs the task's
    # acceptance criteria, so run an exec that diffs against origin/main itself.
    { echo "You are in a disposable copy of the branch; edit files freely to try mutations, they are thrown away."
      echo "Review the changes on this branch: run \`git diff origin/main...HEAD\` and read the touched files."
      echo; cat "$prompt"; } |
      codex exec -C "$tree" -s workspace-write --output-schema "$here/review-schema.json" -o "$out" -
    ;;
  *)
    echo "unknown mode: $mode" >&2; exit 2
    ;;
esac
