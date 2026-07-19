# 0004: Runner routing v2

Status: accepted

`runner-routing-v2` separates free-form `task_class` metadata from the validated
`workload_class` used by implementation selection. Analyze and review share a
single availability-only read-only chain. Implementation has exact, ordered
workload stacks, with no fallback for `default` or `light-work`.

Kimi K3 is served through the OpenCode adapter with provider model identifier
`moonshotai/kimi-k3`. Cursor Fable and Cursor Grok use Cursor plan mode for
read-only dispatches. MiniMax M3 remains a terminal runnable candidate.

The legacy mechanical worker routes and their broker are removed. Shipping
authority belongs to the parent when explicitly authorized; ordinary workers
remain prohibited from git/GitHub mutations.

Optional CLI compatibility marker: `--routing-policy runner-routing-v2` lets
clients such as ARC Pi fail closed against pre-v2 runners (which reject the
unknown flag). Target runners accept the exact value only for automatic
delegation (no `--backend` / `--route`, not Composer economy). The marker is
optional for existing automatic callers and does not change selection behavior.
