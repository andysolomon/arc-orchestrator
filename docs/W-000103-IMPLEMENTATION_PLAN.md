# W-000103 — Automatic ARC Delegate Wrapper

## 1. Product goal and scope boundaries

Make normal Claude Code orchestration execute runner-routing-v3 instead of accidentally pinning implementation to `composer-implement`. Preserve explicit provider aliases, Eco mode, route ordering, and deployment authorization.

## 2. Current baseline

The runner supports automatic phase/workload selection, but the Agent-only Claude surface has no neutral wrapper. Its legacy `composer-implement` wrapper supplies `--backend composer`, which correctly bypasses the automatic stack.

## 3. Missing capabilities

- A neutral Agent/runtime capable of forwarding phase and workload metadata without provider pins.
- Surface guidance that consistently treats named workers as explicit overrides.
- Regression tests spanning Claude and generated harness guidance.

## 4. Milestones

### Phase 1 — Neutral wrapper

**Goal:** Expose automatic runner-routing-v3 through Claude's Agent tool.

**Deliverables:** `arc-delegate` agent and `delegate-runtime` skill.

**Dependencies:** Existing CLI phase/mode validation and automatic selector.

**Risks:** The parent must supply a valid phase and an Implement workload class.

**Acceptance criteria:**

- Wrapper invokes one run and omits `--backend`, `--route`, and model overrides.
- Deploy guidance retains the explicit authorization flag.

### Phase 2 — Surface alignment

**Goal:** Make automatic delegation the default on all normal surfaces.

**Deliverables:** Updated Claude skills and generated Pi/Cursor/Copilot guidance.

**Dependencies:** Phase 1.

**Risks:** Eco mode intentionally remains fixed and must not be changed.

**Acceptance criteria:**

- Normal Claude orchestration selects `arc-delegate`.
- `composer-implement` is documented only as an explicit pin outside Eco mode.
- Generated harness guidance leads with automatic phase/workload commands.

### Phase 3 — Verification and shipping

**Goal:** Prevent regression and publish a merge-ready fix.

**Deliverables:** Surface regression tests, green full validation, conventional commit, and PR linked to #255.

**Dependencies:** Phases 1–2.

**Risks:** Generated files may drift if source templates are not updated first.

**Acceptance criteria:**

- Focused and full suites pass.
- Generated surfaces are fresh.
- PR body closes #255.

## 5. Out of scope / deferred

- Changing runner candidate stacks or model rankings.
- Removing explicit aliases.
- Changing Cursor's model CLI semantics.
- Altering Eco-parent orchestration.

## 6. Immediate next steps

1. Add a failing regression assertion for the missing wrapper.
2. Implement the wrapper and update normal surface guidance.
3. Regenerate surfaces and run full validation.
4. Open a PR; do not merge or deploy without new authorization.

