#!/usr/bin/env bash
# Run Codex non-interactively inside a task worktree.
#
#   codex.sh implement <worktree> <prompt-file> <out-file>   write code (no commits)
#   codex.sh review    <worktree> <prompt-file> <out-file>   review the branch against main; writes JSON matching review-schema.json
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
    # `codex exec review --base` rejects custom instructions, and the review needs the task's
    # acceptance criteria, so run a read-only exec that diffs against main itself.
    { echo "Review the changes on this branch: run \`git diff origin/main...HEAD\` and read the touched files."
      echo; cat "$prompt"; } |
      codex exec -C "$wt" -s read-only --output-schema "$here/review-schema.json" -o "$out" -
    ;;
  *)
    echo "unknown mode: $mode" >&2; exit 2
    ;;
esac
