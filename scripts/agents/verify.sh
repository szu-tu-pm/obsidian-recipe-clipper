#!/usr/bin/env bash
# The orchestrator's own check of a task worktree, independent of the implementer's report.
#
#   verify.sh <worktree> <log-file> [coverage] [eval]
#
# Prints one PASS/FAIL line per step plus the changed files, writes each step's output tail to <log-file>,
# and exits 1 if any step failed. `eval` may fail on purpose when a task records an honest gate miss;
# the orchestrator judges that from the log.
set -uo pipefail

wt=${1:?worktree}; log=${2:?log file}; shift 2
steps=("build|npm run build" "test|npm test")
for extra in "$@"; do
  case $extra in
    coverage) steps+=("coverage|npm run test:coverage") ;;
    eval) steps+=("eval|npm run eval") ;;
    *) echo "unknown step: $extra" >&2; exit 2 ;;
  esac
done

: > "$log"
failed=0
for step in "${steps[@]}"; do
  name=${step%%|*}; cmd=${step#*|}
  output=$(cd "$wt" && $cmd 2>&1); code=$?
  { echo "== $name: $cmd (exit $code)"; echo "$output" | tail -20; echo; } >> "$log"
  if [ "$code" -eq 0 ]; then echo "PASS $name"; else echo "FAIL $name (exit $code)"; failed=1; fi
done

echo "-- changed vs HEAD:"; git -C "$wt" status --short
exit $failed
