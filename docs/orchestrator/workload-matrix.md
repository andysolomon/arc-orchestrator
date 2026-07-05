# Workload Matrix (Phase 6.4)

A representative-workload run of the four delegation routes, captured with the
`run` / `annotate` / `report` pipeline. This is a dated v1 snapshot, not a
final ranking: the Composer numbers are contaminated by a runner bug this run
surfaced (see Findings), so the CLAUDE.md usage-headroom rankings should not be
revised until the matrix is re-run after that fix.

- **Date:** 2026-07-05
- **Backends:** Codex (`gpt-5.4-mini` analyze, `gpt-5.5` implement/review) via ChatGPT auth; Cursor Composer 2.5.
- **Trace data:** recorded to a dedicated, disposable trace directory (not the user's default traces).

## Design

| Run | Route | Backend/Mode | Target | Task class |
| --- | --- | --- | --- | --- |
| E1 | exploration | codex / analyze | this repository (read-only) | exploration |
| R1 | review | codex / review | this repository (read-only) | review |
| I1 | implementation | composer + codex / implement | disposable repo, `slugify` + test | implementation |
| I2 | implementation | composer + codex / implement | disposable repo, `truncate` + test | implementation |

Read-only routes ran against the real orchestrator repository (safe under the
read-only sandbox and genuinely representative). Write routes ran the *same*
bounded task on both backends in isolated throwaway workspaces, so Composer and
Codex can be compared head-to-head on identical work. Each run carried an
explicit `--task-class` and `--route-rationale`; each result was judged by the
parent and recorded with `annotate`.

## Results

Per run (tokens = total; duration in ms):

| Run | Backend/Mode | Status | Outcome | Tokens | Duration | Notes |
| --- | --- | --- | --- | ---: | ---: | --- |
| E1 | codex / analyze | completed | accepted | 196,329 | 48,509 | Accurate, well-cited trace-flow map. |
| R1 | codex / review | completed | accepted | 105,677 | 60,101 | Found a real error-field redaction gap. |
| I1 | composer / implement | error | rejected | — | 29,493 | Code correct, 4 tests pass; envelope contract failed. |
| I1 | codex / implement | completed | accepted | 114,423 | 29,702 | Clean handoff, 5 tests pass. |
| I2 | composer / implement | error | rejected | — | 22,241 | Code correct, 4 tests pass; envelope contract failed. |
| I2 | codex / implement | completed | accepted | 75,911 | 22,813 | Clean handoff, 6 tests pass. |

By backend (`report --group-by backend`):

| Backend | Runs | Completion | Acceptance | Mean tokens | Mean duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| codex | 4 | 100% | 100% | 123,085 | 40,281 ms |
| composer | 2 | 0% | 0% | n/a | 25,867 ms |

## Findings

1. **Composer structured-handoff is broken through the runner (blocking).**
   Both Composer runs produced *correct* code with passing tests, yet both were
   rejected because the runner could not parse the handoff. Root cause,
   confirmed by capturing the raw envelope: Composer prepends a prose preamble
   to the JSON in its `result` field, e.g.
   `"Reviewing workspace artifacts to produce an accurate JSON summary.\n{\"status\":\"completed\",…}"`.
   `extractComposerResult` strips code fences and then `JSON.parse`s the whole
   string, which throws on `prose\n{json}`. **Fix:** extract the embedded JSON
   object from the result string (scan for the last balanced `{…}` that
   validates) instead of parsing the entire string. This is a runner defect, not
   a Composer capability limit.

2. **Codex is reliable but token-heavy on read-only routes.** 4/4 accepted.
   Read-only analysis and review are the expensive routes (196k tokens / 48s and
   106k / 60s); implementation was cheaper and faster (76k–114k, ~23–30s). This
   supports keeping exploration on the cheaper `gpt-5.4-mini` profile and
   reserving verbose read-only Codex work for cases that would otherwise consume
   substantial parent context.

3. **The review route found a real redaction gap.** R1 flagged that the
   `trace.error` field stores worker error text (Codex stderr / Cursor envelope)
   without redaction — the one place non-parent-authored text can enter a trace,
   and it can contain absolute paths or echoed task content. Worth fixing to
   uphold the documented redaction guarantee.

## Routing implications

- Do **not** revise the CLAUDE.md usage-headroom rankings from this run: the
  Composer data reflects the runner bug, not Composer's implementation quality.
- Until the envelope fix lands, Codex `implement` is the only reliable delegated
  implementer through the runner; the "Composer as default cheap implementer"
  policy is not realizable until then.
- Re-run I1/I2 on Composer after the fix to get an uncontaminated head-to-head,
  then reconsider the rankings with real token/latency/acceptance data.

## Composer re-run (post-fix, 2026-07-05)

After the `extractComposerResult` fix, the same I1/I2 tasks were re-run on
Composer in fresh disposable workspaces:

| Run | Status | Outcome | Tokens | Duration | Notes |
| --- | --- | --- | ---: | ---: | --- |
| I1 slugify | completed | accepted | 16,260 | 16,697 ms | Correct code, 4 passing tests, clean handoff. |
| I2 truncate | completed | accepted | 16,398 | 16,442 ms | Correct code, 4 passing tests, clean handoff. |

Uncontaminated head-to-head on identical implementation tasks:

| Backend | Acceptance | Mean tokens | Mean duration |
| --- | ---: | ---: | ---: |
| composer-2.5 | 2/2 | 16,329 | 16.6 s |
| gpt-5.5 (codex) | 2/2 | 95,167 | 26.3 s |

Composer delivered the same accepted quality at roughly **17% of the tokens**
and **63% of the wall time**. This validates the existing routing policy
(Composer as the default clear-spec implementer, GPT-5.5 as the escalation
path) and the CLAUDE.md usage-headroom ordering; no ranking changes are
warranted from this sample. Both tasks were deliberately easy and bounded —
quality separation between the backends would only show up on harder work,
which is what the escalation path is for.

## Follow-ups

- [x] Fix `extractComposerResult` to extract embedded JSON from a prose-prefixed result (done 2026-07-05; regression-tested and verified with a real Composer run).
- [x] Redact absolute paths / task-derived text from the `trace.error` field (done 2026-07-05; `<task>`/`<path>` placeholders in persisted summaries, full detail preserved on stderr).
- [x] Re-run the Composer half of the matrix and refresh this snapshot (done 2026-07-05; see the re-run section above).
