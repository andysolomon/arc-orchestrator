// The trace schema physically lives inside the fable-orchestrator plugin so
// standalone plugin installs (which copy only plugins/fable-orchestrator) stay
// self-contained. Repo-internal consumers import it from orchestrator-core via
// this re-export.
export * from "../fable-orchestrator/lib/trace-schema";
