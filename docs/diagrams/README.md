# ARC Orchestrator Diagrams

## Living Cross-Harness Orchestration Map

The [living cross-harness orchestration map](harness-overview.mermaid.md) is the canonical reference for how Claude Code, Cursor, Pi, and Copilot delegate work through the shared `fable-orchestrator` runner. It includes a [cross-harness overview](#cross-harness-overview) flowchart plus per-harness views for [Fable (Claude Code)](#fable-claude-code), [Cursor](#cursor), [Pi](#pi), and [Copilot](#copilot). `test/diagram-parity.test.ts` guards the parity-anchor table against drift from `plugins/orchestrator-core/feature-matrix.ts`.

## System Architecture

The fan-out shows that Fable selects exactly one specialized worker. The convergence shows that every backend must return the same compact evidence contract before Fable makes a final decision.

[Open the editable Excalidraw source](arc-orchestrator-architecture.excalidraw)

![ARC Orchestrator system architecture](arc-orchestrator-architecture.png)

## Delegation Examples

Three concrete examples show:

1. read-only exploration before architecture;
2. routine implementation through Composer 2.5;
3. targeted escalation to GPT-5.6 Terra (or Sol for taste-sensitive Codex work) with optional independent checking.

[Open the editable Excalidraw source](model-delegation-examples.excalidraw)

![ARC Orchestrator model delegation examples](model-delegation-examples.png)

## Mermaid

See `mermaid.md` for:

- component architecture;
- the availability fallback chain (codex → claude → minimax);
- routing decisions;
- the complete implementation and escalation sequence.
