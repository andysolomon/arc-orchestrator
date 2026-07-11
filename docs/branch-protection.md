# Branch protection on main

This repository enforces changes to `main` through pull requests with a required **Merge Gate** status check, configured as a **repository ruleset** with **GitHub Actions** on the bypass list. Release automation (`@semantic-release/git`) pushes `chore(release): X.Y.Z [skip ci]` version commits through that bypass; humans (including admins) stay gated.

## Why a ruleset instead of classic branch protection (W-000036)

Classic branch protection has no bypass-actor concept: with `enforce_admins: true` it blocks **every** actor, including the `GITHUB_TOKEN` the release workflow uses, so semantic-release's version-commit push fails with `GH006: Protected branch update failed`. Ruleset bypass actors only bypass *rulesets*, never classic protection — so the protection and the bypass must live in the same ruleset. The script below configures the ruleset and then removes any classic protection.

## Prerequisites

- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated with a token that has **admin** access to the repository
- `jq`
- The **Merge Gate** workflow (`.github/workflows/merge.yml`) must already exist on `main` before you require its check — it is present in this repository

## Apply configuration

Run from the repository root with admin credentials:

```sh
./scripts/configure-main-branch-protection.sh
```

Preview the ruleset payload without applying:

```sh
./scripts/configure-main-branch-protection.sh --dry-run
```

Re-running the script is idempotent: it updates the existing ruleset by name and skips classic-protection removal when none exists.

## What gets configured

A ruleset named **Main branch protection** targeting `refs/heads/main`, enforcement **active**:

| Rule | Parameters | Acceptance criterion |
| --- | --- | --- |
| `pull_request` | 0 approvals (PR still required) | Changes only via PR; solo maintainer and worker-authored PRs can merge once Merge Gate passes |
| `required_status_checks` | `Merge Gate`, `strict_required_status_checks_policy: true` | Branch must be up to date and Merge Gate green before merging |
| `non_fast_forward` | — | No force pushes to `main` |
| `deletion` | — | `main` cannot be deleted |

| Bypass actor | Details |
| --- | --- |
| Integration | GitHub Actions (`/apps/github-actions`, app id resolved at runtime — `15368` on github.com), `bypass_mode: always` |
| Workflow identity | `github-actions[bot]` |
| Token | `GITHUB_TOKEN` in the release workflow (W-000026) |

Rulesets apply to admins by default: humans get no bypass, so direct pushes to `main` are blocked for everyone except the GitHub Actions integration.

After the ruleset is active the script deletes any **classic** branch protection on `main` — leaving it in place would keep blocking the release bot regardless of the ruleset bypass.

### If `GITHUB_TOKEN` cannot push

`GITHUB_TOKEN` from a workflow in the same repository can push to `main` when GitHub Actions is on the ruleset bypass list. If pushes still fail:

1. Confirm the ruleset is **Active** and lists **GitHub Actions** under bypass actors (Settings → Rules → Rulesets).
2. Confirm **no classic branch protection** remains on `main` (Settings → Branches) — ruleset bypasses cannot cross into classic protection.
3. Confirm the release workflow `permissions` include `contents: write` (as defined in W-000026).
4. **Fallback:** use a machine-user PAT stored as `RELEASE_GIT_CREDENTIALS` (or similar) with bypass access, and configure `@semantic-release/git` to use that credential instead of `GITHUB_TOKEN`. Document the secret name in the release workflow when adopting this path.

## Verification

### 1. Direct pushes to `main` are blocked

```sh
git checkout -b test/direct-push-blocked
git commit --allow-empty -m "probe"
git push origin HEAD:main
```

Expected: remote rejects the push (ruleset violation), even for admins.

### 2. Merge Gate is required with strict updates

In **Settings → Rules → Rulesets → Main branch protection**, confirm:

- **Require a pull request before merging** is enabled
- **Require status checks to pass** lists **Merge Gate** with **Require branches to be up to date** enabled

Open a PR without a passing Merge Gate run; merge should be blocked until the check succeeds.

### 3. Release automation still works

Merge a `feat:` or `fix:` PR and confirm the `Release` workflow completes green: a version tag, a GitHub Release, and a `chore(release): X.Y.Z [skip ci]` commit on `main` without manual intervention.

Dry-run the script to inspect the payload and the GitHub Actions integration id:

```sh
./scripts/configure-main-branch-protection.sh --dry-run
```

## Related files

- `.github/workflows/merge.yml` — defines the **Merge Gate** check
- `.github/workflows/release.yml` — release workflow whose bot push relies on the bypass
- `.releaserc.json` — `@semantic-release/git` release commit message with `[skip ci]`
- `scripts/configure-main-branch-protection.sh`
