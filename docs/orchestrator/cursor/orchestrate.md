# Cursor Orchestrate Prompts

Use these from Cursor chat with Fable selected as the parent model. With the cursor-orchestrator plugin installed, `/orchestrate <task>` wraps the same contract.

```text
/orchestrate <TASK>
```

Manual paste when the plugin is not installed:

```text
Use Fable as the parent orchestrator for <TASK>. First decide whether this should stay in the parent chat or be delegated. If delegated, produce a bounded worker contract with outcome, scope, invariants, verification, prohibitions, and a safe label. Prefer Composer 2.5 for clear mechanical implementation, GPT-5.6 Terra for hard Codex implement/review, GPT-5.6 Luna for repo exploration, GPT-5.6 Sol for bounded taste-sensitive Codex implementation/review against explicit criteria, and Opus 4.8 when the task needs open-ended high-taste critique or design direction before criteria are fixed. Do not commit, push, merge, deploy, edit secrets, or touch unrelated files unless I explicitly ask.
```

Verify backends before the first delegation in a new environment:

```sh
fable-orchestrator doctor --json
```
