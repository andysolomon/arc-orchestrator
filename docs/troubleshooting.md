# Troubleshooting

Start with:

```sh
./plugins/arc-orchestrator/bin/arc-orchestrator doctor
```

Inside Claude Code:

```text
/arc-orchestrator:setup
```

## Cursor Agent Must Not Run With `sudo`

Running Cursor Agent with `sudo` can:

- start a privileged background worker;
- create root-owned files under `~/.cursor`;
- store authentication in the wrong user's keychain;
- prevent normal user processes from accessing project state.

Repair ownership:

```sh
sudo chown -R "$(id -un)":"$(id -gn)" "$HOME/.cursor"
```

Then authenticate without sudo:

```sh
cursor-agent login
cursor-agent status
```

Never paste a password or API key into Claude Code.

## macOS Keychain Errors

Common messages:

```text
Your macOS login keychain is locked
SecItemCopyMatching failed -50
```

First verify that Cursor works as your normal user:

```sh
cursor-agent status
```

If the login keychain password differs from the current Mac login password, follow Apple's Keychain Access recovery guidance. Resetting the default keychain deletes passwords stored only in that keychain, so do not reset it casually.

Cursor also supports `CURSOR_API_KEY` for automation that should not depend on interactive keychain access:

```sh
export CURSOR_API_KEY='<retrieve securely at runtime>'
cursor-agent status
```

Use a password manager or environment manager. Do not commit the key or place it in shell history.

## Cursor Works Interactively but Automation Fails

Interactive success does not prove that non-interactive execution can access the same keychain or project state.

Check:

```sh
cursor-agent status
cursor-agent models
./plugins/arc-orchestrator/bin/arc-orchestrator doctor --json
```

Also check for foreign-owned state:

```sh
find "$HOME/.cursor" -not -user "$USER" -ls
```

If files are listed, repair ownership before using Composer through the plugin.

## Codex Authentication

Check:

```sh
codex login status
```

Authenticate:

```sh
codex login
```

The plugin reuses the local Codex authentication and configuration. Do not provide API credentials in delegated task text.

## Composer Route Rejected

Error:

```text
the composer backend only supports implement
```

This is intentional. Cursor headless print mode is write-capable and does not provide the same read-only sandbox used by Codex. Use:

- `codex --mode analyze` for exploration;
- `codex --mode review` for review;
- `composer --mode implement` for bounded implementation.

## Worker Returned Malformed Output

The runner rejects output that does not contain:

- `status`;
- `summary`;
- `changes`;
- `verification`;
- `risks`;
- `next_actions`.

Retry once with a narrower task. If malformed output persists, use `codex-implement` or report the backend failure rather than treating the task as complete.

## Plugin Is Not Discovered

Validate:

```sh
claude plugin validate --strict .
claude plugin validate --strict ./plugins/arc-orchestrator
```

Load directly:

```sh
claude --plugin-dir ./plugins/arc-orchestrator
```

Inside Claude Code, check `/help` and `/agents` for the plugin skill and worker agents.

## Tests

```sh
bun test
```

Full validation:

```sh
bun run validate
```
