# Mermaid Diagrams

## Component Architecture

```mermaid
flowchart TB
    User([User goal]) --> Fable["Claude Fable 5<br/>high effort<br/>planning + judgment"]

    Fable -->|clear, routine implementation| Composer["composer-implement<br/>Cursor Composer 2.5<br/>write-capable"]
    Fable -->|difficult implementation or escalation| CodexImpl["codex-implement<br/>GPT-5.5<br/>Sol via sol-implement / workload_class<br/>workspace-write"]
    Fable -->|verbose investigation| Explore["codex-explore<br/>GPT-5.6 Luna<br/>read-only"]
    Fable -->|independent review| Check["codex-check<br/>GPT-5.5<br/>read-only"]

    Composer --> Normalize["Local result validation"]
    CodexImpl --> Schema["Codex JSON Schema"]
    Explore --> Schema
    Check --> Schema
    Schema --> Normalize

    Normalize --> Handoff["Shared handoff<br/>status • summary • changes<br/>verification • risks • next_actions"]
    Handoff -->|evidence| Fable
    Fable -->|accept, retry, or escalate| Result([Final user-facing decision])

    classDef planner fill:#ddd6fe,stroke:#6d28d9,stroke-width:3px;
    classDef composer fill:#fed7aa,stroke:#c2410c,stroke-width:2px;
    classDef codex fill:#dbeafe,stroke:#1e40af,stroke-width:2px;
    classDef evidence fill:#a7f3d0,stroke:#047857,stroke-width:2px;
    class Fable planner;
    class Composer composer;
    class CodexImpl,Explore,Check codex;
    class Handoff,Result evidence;
```

## Availability Fallback Chain

```mermaid
flowchart LR
    Task([Delegated task]) --> Codex["codex backend<br/>GPT-5.6 Luna / Terra / Sol"]
    Codex -->|"outage: usage limit · auth · missing binary"| Claude["claude backend<br/>Opus 4.8 via Claude CLI"]
    Claude -->|outage| Grok["composer backend<br/>Grok 4.5 via Cursor Agent"]
    Grok -->|"outage (MiniMax key configured)"| MiniMax["minimax backend<br/>MiniMax-M3 via Claude CLI against the<br/>Anthropic-compatible MiniMax endpoint"]
    MiniMax -->|"outage (Kimi key configured)"| Kimi["kimi backend<br/>kimi-k3[1m] via Claude CLI against the<br/>Anthropic-compatible Moonshot endpoint"]
    Grok -->|"outage (Kimi key only)"| Kimi
    Codex -->|success| Evidence["Structured evidence<br/>retried runs linked via fallback_of"]
    Claude -->|success| Evidence
    Grok -->|success| Evidence
    MiniMax -->|success| Evidence
    Kimi -->|success| Evidence
    MiniMax -->|outage| Fail(["Run fails; parent decides"])
    Kimi -->|outage| Fail

    classDef codex fill:#dbeafe,stroke:#1e40af,stroke-width:2px;
    classDef claude fill:#e9d5ff,stroke:#7c3aed,stroke-width:2px;
    classDef grok fill:#fed7aa,stroke:#c2410c,stroke-width:2px;
    classDef minimax fill:#fee2e2,stroke:#b91c1c,stroke-width:2px;
    classDef kimi fill:#fef3c7,stroke:#b45309,stroke-width:2px;
    classDef evidence fill:#a7f3d0,stroke:#047857,stroke-width:2px;
    class Codex codex;
    class Claude claude;
    class Grok grok;
    class MiniMax minimax;
    class Kimi kimi;
    class Evidence evidence;
```

The chain is opt-in for unattended runs via `--fallback claude` (or `ARC_ORCHESTRATOR_FALLBACK=claude`): each availability-classified failure retries exactly once on the next tier. The MiniMax tier joins the chain when a pay-as-you-go key is configured (`ARC_ORCHESTRATOR_MINIMAX_API_KEY` or `MINIMAX_API_KEY`); the Kimi tier follows when a Moonshot key is configured (`ARC_ORCHESTRATOR_KIMI_API_KEY`, `MOONSHOT_API_KEY`, or `KIMI_API_KEY`). API-key tiers survive subscription exhaustion of Codex, Claude, and Cursor. `--worker-model <model>` pins the requested backend's model over env and policy; fallback tiers keep their own defaults.

## Routing Decision

```mermaid
flowchart TD
    Start([New task]) --> Ambiguous{Does it still require<br/>architecture, taste, or user input?}
    Ambiguous -->|yes| Keep["Keep in Fable<br/>clarify and decide"]
    Ambiguous -->|no| ReadOnly{Is the task read-only?}

    ReadOnly -->|yes, investigation| Explore["codex-explore<br/>GPT-5.6 Luna"]
    ReadOnly -->|yes, post-implementation review| Check["codex-check<br/>GPT-5.5"]
    ReadOnly -->|no, code changes| Clear{Is the approach approved<br/>and verification straightforward?}

    Clear -->|yes| Composer["composer-implement<br/>Composer 2.5"]
    Clear -->|no, difficult reasoning| CodexImpl["codex-implement<br/>GPT-5.5<br/>Sol via sol-implement / workload_class"]

    Composer --> Inspect["Fable inspects diff + tests"]
    CodexImpl --> Inspect
    Explore --> Decide["Fable uses evidence<br/>to choose the design"]
    Check --> Decide

    Inspect --> Meets{Meets the bar?}
    Meets -->|yes| Decide
    Meets -->|no, prompt was vague| Retry["Retry Composer<br/>with narrower contract"]
    Meets -->|no, reasoning was insufficient| Escalate["Escalate to codex-implement"]
    Retry --> Inspect
    Escalate --> Inspect
    Decide --> Final([Fable reports final result])
```

## End-to-End Delegation Sequence

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Fable as Claude Fable 5
    participant Wrapper as Low-effort Sonnet wrapper
    participant Runner as arc-orchestrator
    participant Composer as Cursor Composer 2.5
    participant Codex as Codex GPT-5.5 (Sol via sol-implement)
    participant Repo as Target repository

    User->>Fable: Implement approved validation behavior
    Fable->>Fable: Clarify scope, invariants, verification, prohibitions
    Fable->>Wrapper: Spawn composer-implement with bounded contract
    Wrapper->>Runner: run --backend composer --mode implement
    Runner->>Composer: cursor-agent --print --force --output-format json
    Composer->>Repo: Read, edit, run focused tests
    Repo-->>Composer: Diff + test results
    Composer-->>Runner: JSON result envelope
    Runner->>Runner: Normalize and validate shared handoff
    Runner-->>Wrapper: Structured evidence
    Wrapper-->>Fable: Return evidence unchanged
    Fable->>Repo: Inspect consequential diff and verification

    alt Composer work meets the bar
        Fable-->>User: Final implementation summary
    else Concrete correctness gap remains
        Fable->>Wrapper: Spawn codex-implement with only confirmed deficiencies
        Wrapper->>Runner: run --backend codex --mode implement
        Runner->>Codex: codex exec --sandbox workspace-write --output-schema
        Codex->>Repo: Apply targeted correction + regression test
        Repo-->>Codex: Diff + test results
        Codex-->>Runner: Schema-constrained result
        Runner-->>Fable: Validated evidence
        opt Independent review is worth the cost
            Fable->>Runner: run --backend codex --mode review
            Runner->>Codex: codex exec --sandbox read-only
            Codex-->>Fable: Prioritized findings
        end
        Fable-->>User: Final reviewed result
    end
```
