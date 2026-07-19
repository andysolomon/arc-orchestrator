# ARC Orchestrator Context

## Routing glossary

- **task_class** is free-form parent observability metadata. It does not select a model.
- **workload_class** is the finite implementation policy key: `default`, `light-work`, `medium-light-work`, `medium-work`, `medium-hard-work`, `hard-light-work`, or `hard-work`.
- **Availability-only fallback** advances only after a normalized availability failure. A completed result, quality concern, or validation failure never advances a stack.
- **Explicit route override** is a traced diagnostic/manual-recovery selection. It must not rewrite the configured fallback chain.
- **Read-only route** means analyze or review. Cursor workers run in plan mode; Claude workers receive the read-only tool allowlist.

The runner-routing-v2 policy uses one read-only chain for analyze and review:
Claude Code Fable → Codex Sol → OpenCode Kimi K3 → Cursor Fable → Cursor Grok
4.5 → MiniMax M3 → Cursor Composer. Implementation uses the separate
`workload_class` chains in the public routes contract.

Mechanical post-comment, commit-push, and merge worker routes do not exist.
Workers remain prohibited from shipping mutations; an authorized parent performs
its own git/GitHub action directly.
