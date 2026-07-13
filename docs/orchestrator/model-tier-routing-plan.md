# Model-Tier Routing Planning Contract

**Status:** Approved implementation plan only. This document specifies a target architecture and safe migration sequence. It does not authorize or implement runtime behavior, schema, route, default, configuration, test, provider, permission, sandbox, or delegation changes.

## Contract boundaries and evidence

This contract separates three kinds of statements:

- **Current behavior** describes the repository at the time of planning and is preserved until a later implementation PR deliberately migrates it.
- **Approved target behavior** is normative for those later PRs but is not active because this Markdown file exists.
- **Gated or unresolved facts** must not be represented as runnable or inferred from product labels.

The four supplied screenshots are product-intent artifacts captured **2026-07-11**. They establish categorical price bands, relative layout, and the proposed inventory: blue means premium/super expensive, red means `$$$`, dark green means `$$`, light green means `$`, and black or unfilled means very cheap. Horizontal placement communicates relative desirability and vertical stacks communicate intended fallback order.

The screenshots do **not** establish numeric prices, provider model IDs, runtime support, adapter compatibility, account or regional availability, or current availability. Numeric pricing, its authoritative source, and its refresh cadence remain unresolved. Screenshot entries approved for registry consideration start as `planned` unless independently promoted through the evidence gates in this contract; screenshot presence alone does not require registration.

The inventory shown in those artifacts, preserving the displayed preference order within each tier, is:

| Screenshot tier | Displayed models |
| --- | --- |
| Premier | Fable, Sol |
| Smart | GPT 5.5, Opus 4.8, Terra, Grok 4.5, GLM 5.2, Luna |
| Mechanical | Composer 2.5, Sonnet 5, Haiku 4.5, Qwen 3 235B, MiniMax M3, Kimi 2.6, 5.4 nano, 5.4 mini, Deepseek v4 Flash, Deepseek v4 Pro |

Tier and price band are independent evidence dimensions. The names above are screenshot labels, not stable IDs or claims of support. Although GLM 5.2 appears in the screenshot, it is explicitly excluded from this routing plan: it requires a Z.AI provider integration that does not exist, and this plan will not register, select, probe, or fall back to GLM.

## Current behavior to migrate deliberately

The executable runner currently exposes seven backend-by-mode routes:

1. `codex/analyze` (`codex-explore`)
2. `codex/implement` (`codex-implement`)
3. `codex/review` (`codex-check`)
4. `composer/implement` (`composer-implement`)
5. `claude/analyze` (`opus-explore`)
6. `claude/implement` (`opus-implement`)
7. `claude/review` (`opus-check`)

`opus-review` is an eighth **public skill and taste-review surface**, not an eighth executable runner route. It ultimately uses a compatible read-only review execution path while preserving distinct taste-oriented intent and output expectations.

Today, route resolution and defaults are encoded around backend and mode: Composer 2.5 is the normal implementation default, Codex routes use the current Luna/Terra/Sol task rules, and Opus availability fallback is parent-driven or explicitly requested. Environment model overrides currently have broad precedence. These are compatibility facts to migrate deliberately. The target policy keeps Composer 2.5 as the normal implementation default, replaces Terra with parent-selected GPT-5.5 for tough tasks, and removes automatic Sol selection.

## Approved roles and implementation policy

The approved normal implementation default is `cursor/composer-2.5`. Additional automatic implementation fallback candidates remain unresolved and cannot be inferred from screenshot position. GLM is not a candidate: Z.AI is not an integrated provider, and no GLM registry entry, probe, adapter, or fallback path is authorized by this plan.

Tough bounded implementation tasks use `codex/GPT-5.5` only when the parent selects that path initially. Workers must not classify their own task as tough, escalate themselves to GPT-5.5, or reinterpret fallback as a quality escalation.

Fable is parent/orchestrator only and is never a worker candidate. Sol is primarily parent/orchestrator. Sol may be a worker only when the parent explicitly authorizes it for an extremely difficult bounded task. Sol is never an automatic fallback, and no generic model, route, environment, CLI, board, or policy override may bypass the Fable/Sol role guardrail.

## Public aliases and canonical capability routes

Stable public route names remain compatibility aliases. New policy and traces use canonical intent/capability route IDs; there is no public route per model. A capability route fixes mode, the sandbox/permission envelope, and the validated structured-result/output contract. Candidate selection supplies the backend, provider, and model only after satisfying that fixed contract.

| Stable public alias or surface | Canonical capability route | Fixed contract |
| --- | --- | --- |
| `codex-explore`, `opus-explore` | `explore.read-only.v1` | analyze mode; read-only; exploration result v1 |
| `composer-implement`, `codex-implement`, `opus-implement` | `implement.workspace-write.v1` | implement mode; workspace-write; implementation result v1 |
| `codex-check`, `opus-check` | `check.read-only.v1` | review mode; read-only; correctness review result v1 |
| `opus-review` public skill/surface | `taste-review.read-only.v1` | review mode; read-only; taste review result v1 |

Alias resolution must be deterministic and versioned. An alias supplies intent, not a hard-coded model. Existing commands remain accepted during migration, while traces record both the requested alias and canonical capability route. Backend×mode and display text must never be treated as sufficient capability identity.

The normal implementation policy applies to `implement.workspace-write.v1`. Candidate stacks for explore and both review capabilities remain unresolved and must not be guessed from screenshot position alone.

## Registry identity and evidence model

The registry is normalized data shared by route resolution, selection, traces, and board adapters. Each entry must keep these identities and claims separate:

| Field | Required meaning |
| --- | --- |
| `stableId` | Immutable internal ID such as `composer-2.5`; never a provider alias. |
| `family` / `version` | Model family and released/versioned variant. |
| `publisher` | Organization that publishes the model. |
| `servingProvider` | Organization or product serving this invocation. |
| `providerModelId` | Exact model identifier accepted by that provider and account. |
| `transportBackend` | Runner transport/runtime, such as Cursor or Codex. |
| `adapterId` / `adapterVersion` | Executable integration and its contract version. |
| `endpoint` / `region` | Endpoint and regional scope when applicable. |
| `authAccountScope` | Credential/account/tenant scope used for evidence and availability. |
| `runnerSupport` | Supported backend×mode combinations, independently verified. |
| `routeEligibility` | Canonical capability routes for which the entry is eligible. |
| `sandboxPermissionSupport` | Verified sandbox and permission envelopes. |
| `outputContracts` | Validated structured-result/output contract versions. |
| `maturity` | `planned`, `experimental`, `available`, `deprecated`, or `disabled`. |
| `provenance` | Evidence sources, capture time, verification result, and approver. |
| `priceBand` | Screenshot categorical band, separate from numeric price. |
| `numericPricing` / `pricingFreshness` | Optional sourced units, retrieval time, expiry, and source version. |

Aliases and display names are additional presentation fields and cannot collapse any identity fields above. Validation rejects duplicate stable IDs, ambiguous aliases, unknown route/output versions, unsupported sandbox claims, fallback cycles, and runnable maturity without adapter, account-scoped availability, route, sandbox, output, cancellation, and error-normalization evidence. Unverified screenshot inventory stays `planned` and route-ineligible.

## Deterministic selection precedence

For one dispatch, selection proceeds in this exact order:

1. **Validate capability and safety contract.** Resolve the requested public alias to its canonical capability route and fix mode, sandbox, permission, and output contract. Enforce Fable/Sol role restrictions.
2. **Apply an explicit permissive override.** Validate a caller-authorized model/backend override against the fixed capability contract and role restrictions. An invalid or ineligible override fails visibly; it does not broaden authority.
3. **Apply candidate ordering and policy.** If no validated override selects a candidate, load the versioned ordered candidate stack, maturity policy, and price policy.
4. **Classify availability or attempt failure.** Skip non-runnable candidates with a recorded classification; attempt each runnable candidate at most once.
5. **Perform bounded fallback.** Advance only for a retryable classification, under the state machine below, and stop on success, terminal failure, budget exhaustion, or stack exhaustion.

Explicit permissive overrides may bypass candidate ordering, maturity policy, and price policy. They may never bypass the canonical route's sandbox, permissions, or output contract, nor the Fable/Sol role restrictions. Selection is deterministic for the same requested route, override, policy version, registry version, availability evidence, and root budget state.

## Automatic fallback state machine

Automatic fallback is availability/failure recovery, not a quality escalation:

```text
resolve contract -> build validated stack -> candidate[0]
  -> attempt once
     -> success: select and stop
     -> terminal: record and stop
     -> retryable: record fallback and advance once
  -> candidate[n], until success or stack exhausted
```

One dispatch gets one traversal of one candidate stack and at most one attempt per candidate. The selector must not restart the stack, nest another fallback traversal, retry the same candidate, or silently schedule a higher-quality run.

Retryable classifications are exactly:

- `rate_limit`
- `quota_exhausted`
- `provider_outage`
- `timeout`
- `missing_binary`
- `transient_network_or_adapter`

Terminal classifications are exactly:

- `policy_denial`
- `sandbox_incompatible`
- `invalid_configuration`
- `deterministic_validation_error`

Unknown/unclassified failures are terminal until deliberately classified. Authentication/account errors that are not demonstrated transient are `invalid_configuration`. A completed but low-quality result is not a fallback condition; the parent may explicitly schedule a separate route if policy and remaining root budgets allow.

Cross-provider, cross-backend, and cross-price-band fallback is allowed only when the destination adapter independently satisfies an equal-or-stricter permission/sandbox envelope and the same validated output contract. Every transition is visible in the result and trace. Crossing such a boundary does not imply or authorize quality escalation.

## Trace and observability contract

The versioned selection trace must record, for every dispatch and candidate attempt:

- requested public route/surface and canonical capability route;
- requested model, candidate model, attempted model, and selected model as distinct fields;
- serving provider, provider model ID where safe, transport backend, and adapter/version;
- candidate index, attempt index, stack size, and traversal ID;
- normalized failure classification, sanitized failure detail, fallback source/destination/reason, and terminal reason;
- whether an override was requested/applied and whether a parent explicitly escalated or authorized Sol;
- root run ID, parent run ID, run/attempt ID, task ID, lineage depth, and scheduler ID;
- worktree/checkout identity using a non-sensitive bounded identifier;
- policy version and registry version; and
- allocated, consumed, and remaining **token, wall-time, call, cost, and concurrency** budgets at root and dispatch scope.

Fields must make one-pass accounting auditable: attempt indexes are monotonic within one traversal, and consumed amounts never reset on fallback or delegation. Traces and metrics must redact prompts, credentials, secrets, raw provider errors, file contents, and absolute paths. User/model/provider strings must be normalized or mapped to bounded-cardinality IDs before becoming labels; high-cardinality details belong only in access-controlled structured events with retention limits.

## Arc-board contract migration

Arc-board integration must migrate to the named, versioned `orchestrator-routing-trace/v2` contract. The trace adapter and board must dual-read old records and v2 records during rollout. Writers emit v2 only after compatibility tests pass.

If the external arc-board schema is closed/strict, new routing, attempt, lineage, and budget data must travel in an optional versioned extension object where permitted or in a separately joined sidecar keyed by run ID. Do not add undeclared properties to a strict record. Board ingestion and display must never infer route or model identity from display text or `backend × mode`.

The migration PR must include old/new fixtures, a strict-schema compatibility test, an independently reversible adapter change, and a rollback switch to the old reader/view. Rollback must leave v2 events intact for later replay and must not rewrite historical records.

## Depth-two delegation contract

Deeper delegation is operationally separate from the initial registry and selector rollout. Root runs have depth `0`; the initial maximum depth is `2`. Only the parent scheduler dispatches workers at every depth. A child may return a structured delegation recommendation, but it may not directly spawn a grandchild.

The dispatch request must carry explicit delegation flags and preferred capability/candidate paths. A normalized `rate_limit` may cause the parent scheduler to dispatch an alternate provider according to the validated fallback stack; the child does not initiate the switch. Explicit parent authorization is still required for tough-task GPT-5.5 and any Sol worker use.

All descendants inherit the root's **remaining**, not original, token, time, call, cost, and concurrency budgets. The scheduler atomically reserves and reconciles allocations and enforces:

- maximum depth, fan-out, and global/root concurrency;
- direct and indirect cycle detection using bounded non-sensitive task identities;
- ancestor and active-task checks before dispatch;
- cancellation propagation from root to every queued/running descendant;
- no new dispatch after root cancellation or budget exhaustion; and
- worktree ownership/conflict rules, including serialization of overlapping writes and isolated worktrees for concurrent writers.

Children may receive narrower sandbox/permissions than their parent, never broader ones. Increasing depth beyond `2`, enabling child-controlled spawning, or changing initial fan-out semantics requires a separate contract revision.

## Safe implementation PR sequence

Each PR is independently reviewable and reversible; no phase is authorized by this document alone.

1. **Contract:** land this planning contract and define typed canonical route, registry, failure, trace, and board-extension schemas without activating selection changes.
2. **Registry/selector shadow mode:** populate only approved provider/model inventory and aliases, resolve both current and proposed selections without changing execution, and compare explanations and contract eligibility. Exclude GLM.
3. **Selection/fallback engine:** activate canonical route selection and the bounded one-pass state machine behind staged flags; Composer 2.5 remains the normal implementation default, and no additional implementation fallback is activated until its provider adapter passes the full contract gate.
4. **Trace/board migration:** emit `orchestrator-routing-trace/v2`, dual-read old/new data, introduce the optional extension/sidecar, validate strict schemas, and retain rollback.
5. **Depth-two delegation:** separately enable parent-scheduled depth `2` with inherited root budgets, cycle, fan-out, concurrency, cancellation, and worktree enforcement.
6. **Staged rollout:** progress from local fixtures to shadow, opt-in, limited cohort, and default only after telemetry and rollback gates pass; synchronize supported skills/docs/surfaces in the activating PRs.

## Required verification matrix

- **Route and alias tests:** all stable public aliases resolve to the expected canonical route; all seven runner backend×mode combinations remain distinguishable; `opus-review` remains the distinct taste-review public surface and is not counted as an executable runner route.
- **Normal implementation tests:** Composer 2.5 is the default implementation candidate; GLM is absent from registry, selection, probes, and fallback; any future candidate requires provider/account/sandbox/output/cancellation/error evidence before activation.
- **Role and override tests:** explicit overrides obey precedence; ordering/maturity/price may be bypassed only when authorized; sandbox, permissions, output contracts, Fable parent-only, and Sol explicit-parent authorization cannot be bypassed; no automatic Sol path exists.
- **Failure-classification tests:** every retryable and terminal class above, plus unknown failure, authentication/configuration failure, stack exhaustion, and completed-but-low-quality output.
- **One-pass fallback tests:** one attempt per candidate, one traversal, monotonic candidate/attempt indexes, no nested/restarted stack, and correct consumed/remaining budget accounting.
- **Cross-boundary tests:** cross-provider/backend/price fallback succeeds only with equal-or-stricter sandbox/permissions and the identical validated output contract; incompatible destinations are terminal.
- **Trace tests:** required identity, selection, fallback, escalation, lineage, version, worktree, and all allocated/consumed/remaining budget fields; redaction and bounded cardinality; old and v2 fixture parsing.
- **Board tests:** named-contract dual-read, rollback, stable-ID joins, optional extension/sidecar behavior, and compatibility with a closed strict schema.
- **Delegation tests:** root depth `0`, maximum depth `2`, parent-only dispatch, structured child recommendations, inherited remaining root budgets, fan-out/concurrency limits, direct and indirect cycles, cancellation propagation, post-cancel rejection, rate-limit alternate-provider dispatch, and worktree conflicts/isolation.
- **Rollout tests:** shadow mode cannot change execution; each flag rolls back independently; planned inventory cannot become runnable through screenshot evidence alone.

## Genuinely unresolved decisions

Only these decisions remain open:

1. Numeric model pricing, its authoritative source, and refresh cadence.
2. Ordered fallback candidates after Composer 2.5 and candidate stacks for explore, correctness review, and taste review.
3. Initial numeric root token/time/call/cost budgets and concurrency limit.

## Non-goals

This planning-only edit does not change or authorize changes to runtime behavior, current schemas, public routes, defaults, tests, configuration, dependencies, permissions, sandboxes, traces, trackers, adapters, providers, worktrees, external systems, or deployed surfaces. It does not make planned inventory runnable, assign numeric prices, enable automatic quality escalation, permit worker self-routing, or enable deeper delegation. Those changes require the sequenced implementation PRs and their stated evidence gates.
