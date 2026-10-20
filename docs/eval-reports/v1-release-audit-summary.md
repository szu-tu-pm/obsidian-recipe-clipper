# v1.0.0 release audit summary

Overall result: **NOT READY for Greg Szu-Tu's sign-off.**

Why:

1. The whole-repo Claude/Codex cross-review audit found **5 unresolved major findings** (Codex; the Claude audit found none): three code defects, one ADR that does not match the code, and the P3-5 mismatch below. The "zero unresolved blocker/major findings" criterion is **not met**. See "Cross-review audit".
2. Desktop compatibility is **INCOMPLETE**. `docs/eval-reports/desktop-compatibility.md` records "Not run" for all eight macOS and Windows rows. No Obsidian session has been run on any OS. Notion lists P3-5 as Done anyway. That mismatch is reported in Gaps below, not resolved here.
3. The committed performance report is stale (Gap 3).

Everything automated that this task could run passed on the measured commit. Numbers are in "Measured numbers".

## Measured on

- Commit: `78c890aa046cd3cc030650b0fa31ee94cd00cc55` (`main` at the merge of PR #22), on branch `claude/p3-4-release-audit`.
- `git status --short` printed nothing before any command was run, so the tree was clean when measured. `main.js` is gitignored, so building does not dirty it.
- Date 2026-10-20, macOS (Darwin 25.5.0), Vitest v5.0.5.
- `npm run eval` and `npm run eval:held-out` rewrite the committed reports under `docs/eval-reports/`. The only differences were the "Git commit" and "Working tree dirty" lines (4 lines changed in each of 4 files). I reverted all four files with `git checkout -- docs/eval-reports`. The committed reports are untouched.
- Not run: `npm run eval:live` (needs network and a live Ollama; brief excludes it).

## Gaps and blockers (read first)

| # | Gap | Severity | Owner |
| --- | --- | --- | --- |
| 1 | Five unresolved major audit findings (A1 to A5 in "Cross-review audit"): Ollama body reads are not abortable, Ollama requests can follow a redirect off loopback, `removeImage` has no path guard, ADR-001's import boundary is false, and the P3-5 mismatch (Gap 2). | Blocks the audit criterion | Follow-up tasks; Greg decides whether to waive or fix before tagging |
| 2 | Obsidian desktop round-trip never run on Windows 10, Windows 11, macOS 14/15/16 (Apple Silicon and Intel). `desktop-compatibility.md` says INCOMPLETE. The only automated check is `tests/unit/desktopCompatibility.test.ts`, which reads `manifest.json`. Notion marks P3-5 Done, which does not match the report. | Person gate, not done | Greg / Lin on real machines |
| 3 | `docs/eval-reports/performance-benchmark-report.md` was recorded at commit `3365c3c`, with aggregation rules `v1` and a 330.03 KiB bundle. Current `main` uses rules `v2` and builds to 369.1 KB. The benchmark test still runs inside `npm test`, but the committed report no longer describes this tree. The gates in it still pass on the recorded numbers; it just was not regenerated. | Minor, stale evidence | Whoever regenerates it (not in this task's scope) |
| 4 | Testing inside the Obsidian desktop app is not covered by any automated gate. Every automated test runs under Node or jsdom, not Electron. The benchmark report says the same. | Person gate | Greg |
| 5 | Greg Szu-Tu's merge sign-off and the v1.0.0 tag and release are not done (by design). | Person gate | Greg |
| 6 | I did not re-fetch each task's Deliverables and Acceptance Criteria from Notion. The matrix below shows merged PR, the evidence file that exists in the repo, and a green suite. It does not claim each Notion checkbox was compared line by line. | Limit of this audit | The cross-review audit should cover it |
| 7 | CI (`.github/workflows/ci.yml`) runs `npm run build` and `npm run test:coverage` only. It does not run `npm run eval` or `npm run eval:held-out`. The eval gates are enforced in CI only through `tests/evals/runner.test.ts` and `tests/evals/heldOut.test.ts`, which run inside Vitest. | Observation | None needed |

No open pull requests (`gh pr list --state open` returned `[]`).

## Task matrix

Status key: Verified = PR state MERGED (checked with `gh pr view`), evidence file exists in the repo, and `npm test` and `npm run test:coverage` are green on the measured commit. Gap = something named in Gaps above. "Gates" is the gate type the task title and brief imply; see Gap 6.

| Task | PR | Merged (UTC) / merge commit | Evidence in repo | Status |
| --- | --- | --- | --- | --- |
| P1-1 Scaffold, settings, CI harness | #2 | 2026-10-16T16:40:33Z / `874172b` | `.github/workflows/ci.yml`; `npm run build` passes; bundle-size script `scripts/check-bundle-size.mjs` | Verified |
| P1-2 React ItemView wrapper, typed service adapter | #1 | 2026-10-15T15:56:44Z / `0d121e6` | `src/wrapper/PluginServiceAdapter.ts`; `tests/integration/manualRecipeFlow.test.tsx` | Verified |
| P1-3 Schema v1, vault storage, indexer | #1 | same as above | `tests/integration/recipeVaultRoundTrip.test.ts`; `docs/adr/004-markdown-schema-v1.md` | Verified |
| P1-4 Stage 1 lexical ingredient parser | #1 | same as above | `tests/unit/stage1LexicalParser.test.ts` | Verified |
| P1-5 Collection view, form, ratings, gallery | #1 | same as above | `tests/unit/filterRecipes.test.ts`, `tests/unit/imageGalleryPicker.test.tsx`, `tests/integration/manualRecipeFlow.test.tsx` | Verified |
| P2-1 3-tier URL extraction | #4 | 2026-10-16T16:00:02Z / `2954fe5` | `tests/unit/extraction/urlExtraction.test.ts`, `extractionVariants.test.ts`, `untrustedHtml.test.ts`; `docs/adr/003-three-tier-url-extraction.md`; `docs/prompts/ollama-recipe-extraction.md` | Verified |
| P2-2 Review-before-save import, duplicate warning | #5 | 2026-10-16T16:36:53Z / `ee4f47a` | `tests/integration/urlImportReviewFlow.test.tsx` | Verified |
| P2-3 Rules-based ingredient normalization | #7 | 2026-10-17T00:09:12Z / `22785ce` | `tests/unit/aggregationRules.test.ts`; `docs/adr/002-local-ingredient-rules-engine.md` | Verified |
| P2-4 Shopping-list generator, pantry UI | #8 | 2026-10-17T21:02:14Z / `0e61fcc` | `tests/integration/shoppingListLifecycle.test.tsx` | Verified |
| P2-5 Eval harness and fixtures | #9 | 2026-10-18T21:50:10Z / `47edbaa` | `tests/evals/runner.ts`, `tests/evals/runner.test.ts`; `docs/eval-reports/phase2-baseline-report.md` (PASS, reproduced below) | Verified |
| P2-6 Async import session, progress, cancel | #6 | 2026-10-16T18:45:09Z / `80ba1d8` | `tests/unit/extraction/importSession.test.ts`, `abortBetweenTiers.test.ts`; `tests/integration/asyncImportSession.test.tsx` | Verified |
| P2-7 Web Clipper | #12 | 2026-10-19T17:27:58Z / `1aed64f` | `tests/integration/webClipperIntake.test.ts`, `webClipperReviewFlow.test.tsx`, `pluginClipWiring.test.ts` | Verified |
| P2-8 Local translation with review | #11 | 2026-10-18T21:50:45Z / `694d9c4` | `tests/unit/recipeTranslator.test.ts`, `translateRecipeModal.test.tsx`; `docs/prompts/ollama-recipe-translation.md` | Verified |
| P2-9 Parser fixes (fractions, fl oz, counts) | #14 | 2026-10-19T02:34:07Z / `3e4485c` | `tests/unit/stage1LexicalParser.test.ts`; eval category rows for unicode-fraction, fl-oz | Verified |
| P2-10 Ingredient disagreement review | #19 | 2026-10-20T12:25:12Z / `7fe2aa2` | `tests/unit/extraction/ingredientDisagreement.test.ts`, `tests/integration/ingredientDisagreementReview.test.tsx` | Verified |
| P2-11 List-file refresh | #17 | 2026-10-20T12:24:00Z / `987ca8c` | `tests/integration/shoppingListFolderRefresh.test.tsx` | Verified |
| P2-12 Ingredient parsing (package sizes, brackets, notes) | #18 | 2026-10-20T12:24:15Z / `1722ef5` | `tests/unit/stage1LexicalParserP2_12.test.ts` | Verified |
| P3-1 E2E workflow suite | #16 | 2026-10-20T12:23:38Z / `0e8957d` | `tests/integration/*` (10 files), `tests/regression/defectCorpus.test.tsx` | Verified |
| P3-2 Benchmark suite | #13 | 2026-10-19T02:33:38Z / `0ded744` | `tests/evals/performanceBenchmarks.test.ts`; `docs/eval-reports/performance-benchmark-report.md` | Gap (3): report stale; test passes |
| P3-3 Held-out eval, ADRs | #21 | 2026-10-20T17:30:05Z / `df94abd` | `tests/evals/heldOut.ts`, `heldOut.test.ts`, `tests/evals/held-out/`; `docs/eval-reports/held-out-v1-report.md` (PASS, reproduced below); ADRs 001-004 | Verified |
| P3-5 Desktop compatibility | #22 | 2026-10-20T17:47:21Z / `78c890a` | `tests/unit/desktopCompatibility.test.ts`; `docs/eval-reports/desktop-compatibility.md` says INCOMPLETE | Gap (2): manifest check done, OS round-trip not run |

Scope notes: P2-13 (paste import, Not Started) and P4-1/P4-2/P4-3 (Gmail, Phase 4) are outside v1.0.0 scope per the PRD excerpt, so they are not in the matrix. P3-4 is this task.

## Measured numbers

| Command | Result | Threshold |
| --- | --- | --- |
| `npm run build` (`tsc -noEmit`, esbuild production, bundle check) | exit 0. `main.js: 369.1 KB (limit 500 KB)` | below 500 KB (512,000 bytes, strict `<`) |
| `npm test` | 28 test files passed (28), 407 tests passed (407), about 11 s | all pass |
| `npm run test:coverage` | exit 0. 28 files, 407 tests passed | see next table |
| `npm run eval` | exit 0. Overall PASS | see gates table |
| `npm run eval:held-out` | exit 0. Overall PASS | see gates table |

Coverage (from the Vitest text table; thresholds from `vitest.config.ts`):

| Scope | Statements | Branches | Functions | Lines | Threshold |
| --- | ---: | ---: | ---: | ---: | ---: |
| All files | 85.92 | 81.76 | 86.47 | 85.92 | 80 each |
| `src/domain/aggregation` | 96.83 | 91.66 | 98.52 | 96.97 | 90 each |
| `src/domain/extraction` | 97.14 | 90.19 | 98.46 | 97.28 | 90 each |

Smallest margins: global branches 81.76 vs 80 (1.76 points), extraction branches 90.19 vs 90 (0.19 points). Coverage excludes four files, each for the stated reason that it needs the Obsidian runtime: `src/main.ts`, `src/settings.ts`, `src/wrapper/RecipeItemView.ts`, `src/wrapper/RecipeViewRoot.tsx`. I did not compute coverage with them included.

Eval exit gates (both runs, fixture corpus `phase2-v3` and `held-out-v1`, aggregation rules `v2`):

| Gate | Threshold | Phase 2 baseline | Held-out |
| --- | ---: | ---: | ---: |
| schemaValidity | 100.0% | 100.0% | 100.0% |
| hallucinatedFieldRate | 0.0% | 0.0% | 0.0% (0 of 159 fields) |
| tier1IngredientRecall | 98.0% | 100.0% (73/73) | 100.0% (60/60) |
| tier1QuantityUnitFidelity | 96.0% | 100.0% (73/73) | 100.0% (60/60) |
| tier2IngredientRecall | 90.0% | 100.0% (69/69) | 100.0% (60/60) |
| tier2QuantityUnitFidelity | 88.0% | 100.0% (69/69) | 100.0% (60/60) |
| falseMergeRate | 0.0% | 0.0% (0/50) | 0.0% |
| safeMergeRecall | 92.0% | 100.0% (50/50) | 100.0% |

Corpus floors (minimum 50 each): Phase 2 has 73 tier 1 ingredients, 69 tier 2, 50 safe pairs, 50 unsafe pairs. Held-out has 60, 60, 50, 50. Both "Known gaps" sections say "None." Phase 2 uses 13 fixtures (7 tier 1, 6 tier 2); held-out uses 6 (3 and 3). 100% on every gate means the margin over thresholds is the whole gap; the corpora are small, so this is evidence for the stated fixtures, not for arbitrary sites.

Release metadata:

| File | Value |
| --- | --- |
| `package.json` version | `0.1.0` |
| `package-lock.json` version | `0.1.0` (lockfileVersion 3) |
| `manifest.json` version | `0.1.0` |
| `versions.json` | `{"0.1.0": "1.7.7"}` |
| `manifest.json` `minAppVersion` | `1.7.7` |
| `manifest.json` `isDesktopOnly` | `true` |
| Git tags | none (`git tag` printed nothing) |

CI workflow (`.github/workflows/ci.yml`): triggers on push to `main` and on pull requests; `ubuntu-latest`, Node 20; steps `actions/checkout@v4`, `actions/setup-node@v4` (npm cache), `npm ci`, `npm run build`, `npm run test:coverage`. I did not check the latest GitHub Actions run results for the commit; I ran the same two commands locally.

## Cross-review audit

Both models audited the whole repository at `78c890a` in a read-only checkout, against `AGENTS.md`, the ADRs, the eval reports and the review rubric. Neither ran `eval:live`. Scratch mutations were made in disposable copies.

| Auditor | Verdict | Blocker | Major | Minor |
| --- | --- | --- | --- | --- |
| Codex | request_changes | 0 | 5 | 1 |
| Claude (fresh agent, no implementation context) | approve | 0 | 0 | 7 |

Both auditors reproduced the build, tests, coverage and both evals as passing, and both caught every scratch mutation they tried on the eval, aggregation, duplicate-URL and coverage gates (Codex 8 of 8; Claude 22 probes, with two equivalent mutants and two weak spots listed under minors). Codex classified its failures as (a) 5 defects in code outside this task, (b) 0 errors in this PR, (c) 1 person gate. The Claude audit found no failing gate.

The Claude audit missed A1 to A3. It confirmed that a non-loopback Ollama endpoint is rejected, but did not test redirects or stalled response bodies. The orchestrator read `requestWithTimeout` (`src/domain/extraction/ollamaExtractor.ts:181-203`) and `removeImage` (`src/domain/vault/attachmentManager.ts:105-109`) and confirmed A1 and A3 in the code. No source file in `src/` sets a `redirect` option, so `fetch` follows redirects by default (A2).

### Unresolved major findings (none fixed in this PR; this PR changes docs only)

| ID | Finding | Where | Class | Suggested fix |
| --- | --- | --- | --- | --- |
| A1 | The timeout and parent-abort listener are cleared once `fetch` resolves headers. A stalled body in `chat.json()` can hang forever and cannot be cancelled, against the prompt documents' 25-second abortable timeout. | `src/domain/extraction/ollamaExtractor.ts:198` | (a) | Keep the controller and timer alive through body read and JSON parse; cap response size; test stalled bodies for timeout and parent cancel. |
| A2 | Loopback is validated only before `fetch`. A loopback server can answer 307/308 with a remote origin and the POST body (recipe or page content) is forwarded, against the local-only guarantee. | `src/domain/extraction/ollamaExtractor.ts:198` | (a) | `redirect: "error"` or validate every hop; test that local-to-remote redirects never receive the body. |
| A3 | `removeImage` deletes `image.path` from recipe frontmatter without checking it lies in the managed attachment folder. A crafted or hand-edited recipe can delete an unrelated vault note. | `src/domain/vault/attachmentManager.ts:107` | (a) | Normalize and require the path to be under the attachment folder (ideally the recipe's own); reject traversal and absolute paths; test deletion of an unrelated note is refused. |
| A4 | ADR-001 says `src/domain` does not import `obsidian`, but `src/domain/vault/obsidianVault.ts` does (the Claude audit also reports this, as a minor). | `docs/adr/001-react-obsidian-wrapper.md:12` | (a) | Move the adapter out of `src/domain` or amend the ADR, then add an import-boundary test. |
| A5 | P3-5 is Done in Notion while `desktop-compatibility.md` says INCOMPLETE with no Obsidian round-trip on any OS (Gap 2). Both auditors flagged it; Claude rated it minor because the literal Phase 3 exit-gate text does not name it. | `docs/eval-reports/desktop-compatibility.md:3` | (c) | A person runs the round-trips, or Greg records an explicit waiver. Notion status was left unchanged. |

### Minor findings (disposition: reported, not fixed here)

- `desktop-compatibility.md` names no commit (Codex), and its round-trip steps omit URL import, Web Clipper and Ollama paths (Claude).
- `src/ui/importRecipePage.ts:29`: URL import and image download use global `fetch`, not Obsidian `requestUrl`, so recipe sites may fail CORS inside Obsidian. Unverified in the app. No timeout, no body-size cap, non-http(s) schemes pass `ensureHttpsUrl` (Claude).
- `performance-benchmark-report.md` is stale (Gap 3).
- No test ties `rulesVersion` to rule file contents, so a rule edit without a version bump passes CI (Claude). AGENTS.md requires the bump.
- The held-out corpus is small (3 fixtures per tier) and excludes Ollama; the model-tier hallucination gate rests on recorded phase 2 responses. Floors are met and probes were caught (Claude).
- Weak mutation spots: dropping the unicode-half map entry is caught only by `ingredientDisagreement` tests; lowering one exit-gate threshold is caught only by the "report matches a fresh run" test (Claude).
- Release mechanics: no release workflow, `main.js` is gitignored so assets are attached by hand, and the Obsidian tag has no `v` prefix (Claude; see Greg's steps).

### Follow-ups

A1 and A2 (Ollama transport hardening), A3 (attachment path guard) and A4 (ADR-001 boundary) are code or doc defects outside this task's deliverables. They should become follow-up tasks, which Greg can fix before tagging or accept for v1.0.0. A5 is a person decision.

## Greg Szu-Tu: release steps

All unchecked. I did none of these. Do them only after you have decided what to do about the five unresolved major findings in the audit section (fix A1 to A4 first, or waive them in writing) and about Gap 2 / A5.

- [ ] Read this summary and decide whether v1.0.0 may ship with desktop compatibility INCOMPLETE (Gap 2), or require the Obsidian round-trip first and update `docs/eval-reports/desktop-compatibility.md`.
- [ ] Merge the P3-4 PR once you approve it.
- [ ] On an up-to-date `main` with a clean tree, run `npm version 1.0.0`. This edits `package.json` and `package-lock.json`, then runs the `version` script (`version-bump.mjs`), which sets `manifest.json` `version` to `1.0.0` and adds `"1.0.0": "1.7.7"` to `versions.json`, stages both, and creates a commit and a git tag. Check the tag format: Obsidian release tags must exactly match `manifest.json` `version` with no leading `v`, so use `npm version 1.0.0 --no-git-tag-version` and tag `1.0.0` yourself if you want that, or accept npm's default `v1.0.0` and confirm it fits your release convention. The task text says "v1.0.0"; the Obsidian plugin guideline says no `v`. Decide before tagging.
- [ ] Run `npm ci`, `npm run build`, `npm run test:coverage` on the version-bumped commit. Confirm the bundle check prints under 500 KB.
- [ ] Push the commit and tag.
- [ ] Create the GitHub release for the tag and upload the three release assets: `main.js` (from `npm run build`; it is gitignored), `manifest.json`, and `styles.css`. The build copies `src/styles.css` to the root `styles.css` (`esbuild.config.mjs` line 49).
- [ ] Optionally regenerate `docs/eval-reports/performance-benchmark-report.md` on the release commit (Gap 3).
- [ ] Tick your own merge sign-off in Notion. Leave Lin's audit checkbox to the orchestrator.
