// The trace schema physically lives inside the arc-orchestrator plugin so
// standalone plugin installs (which copy only plugins/arc-orchestrator) stay
// self-contained. Repo-internal consumers import it from orchestrator-core via
// this re-export.
export * from "../arc-orchestrator/lib/trace-schema";
