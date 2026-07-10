# Branch protection on main

This repository enforces changes to `main` through pull requests with a required **Merge Gate** status check. Release automation (`@semantic-release/git`) can still push `chore(release): X.Y.Z [skip ci]` commits after branch protection is applied.

## Prerequisites

- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated with a token that has **admin** access to the repository
- `jq` (for the release bypass ruleset script)
- The **Merge Gate** workflow (`.github/workflows/merge.yml`) must already exist on `main` before you require its check — it is present in this repository

## Apply configuration

Run from the repository root with admin credentials:

```sh
./scripts/configure-main-branch-protection.sh
./scripts/configure-release-bypass-ruleset.sh
```

Preview payloads without applying:

```sh
./scripts/configure-main-branch-protection.sh --dry-run
./scripts/configure-release-bypass-ruleset.sh --dry-run
```

### Merge order

1. Ensure **Merge Gate** is on `main` (already true for this repo).
2. Run `configure-main-branch-protection.sh` to require PRs, one approval, strict status checks, and **Merge Gate**.
3. Run `configure-release-bypass-ruleset.sh` so the release workflow can push version commits.

Re-running either script is idempotent.

## What gets configured

### Classic branch protection (`configure-main-branch-protection.sh`)

| Setting | Value | Acceptance criterion |
| --- | --- | --- |
| Required pull request reviews | 1 approval | Changes only via PR |
| `enforce_admins` | `true` | Admins cannot bypass |
| `required_status_checks.strict` | `true` | Branch must be up to date with `main` |
| Required check context | `Merge Gate` | Matches job name in `merge.yml` |

Direct pushes to `main` are blocked; all changes land through merged pull requests.

### Release automation bypass (`configure-release-bypass-ruleset.sh`)

Creates or updates a repository ruleset named **Release automation bypass** targeting `refs/heads/main` with an empty `rules` array and **GitHub Actions** on the bypass list.

| Actor | Details |
| --- | --- |
| Integration | GitHub Actions (`/apps/github-actions`, app id resolved at runtime — `15368` on github.com) |
| Workflow identity | `github-actions[bot]` |
| Token | `GITHUB_TOKEN` in the release workflow (W-000026) |

An active ruleset with GitHub Actions as a bypass actor allows the release workflow to push `chore(release): … [skip ci]` commits despite classic branch protection.

On personal repositories, GitHub may reject adding the GitHub Actions integration as a ruleset bypass actor (`Actor GitHub Actions integration must be part of the ruleset source or owner organization`). Use the PAT fallback below when that happens.

### If `GITHUB_TOKEN` cannot push

`GITHUB_TOKEN` from a workflow in the same repository can push to protected branches when GitHub Actions is on the ruleset bypass list. If pushes still fail after applying both scripts:

1. Confirm the ruleset is **Active** and lists **GitHub Actions** under bypass actors (Settings → Rules → Rulesets).
2. Confirm the release workflow `permissions` include `contents: write` (as defined in W-000026).
3. **Fallback:** use a machine-user PAT stored as `RELEASE_GIT_CREDENTIALS` (or similar) with bypass or admin-equivalent access, and configure `@semantic-release/git` to use that credential instead of `GITHUB_TOKEN`. Document the secret name in the release workflow when adopting this path.

## Verification

### 1. Direct pushes to `main` are blocked

```sh
git checkout main
git pull
echo "# probe" >> /tmp/bp-probe.md && git add /tmp/bp-probe.md  # use a throwaway branch instead
git checkout -b test/direct-push-blocked
# Attempt push to main should be rejected by GitHub (not by local hooks only)
git push origin HEAD:main
```

Expected: remote rejects the push (protected branch).

### 2. Merge Gate is required with strict updates

In **Settings → Branches → Branch protection rules** (or rulesets summary), confirm:

- **Require status checks to pass before merging** is enabled
- **Require branches to be up to date before merging** (strict) is enabled
- **Merge Gate** appears in the required checks list

Open a PR without a passing Merge Gate run; merge should be blocked until the check succeeds.

### 3. Admins are not exempt

With `enforce_admins: true`, even repository administrators cannot push directly to `main` or merge without satisfying reviews and checks. Verify as an admin: direct push fails (scenario 1) and the UI does not offer an admin bypass for reviews/checks.

### 4. Release automation still works

After W-000026 release workflow is on `main`, merge a `feat:` or `fix:` PR and confirm the release job can push `chore(release): X.Y.Z [skip ci]` to `main`. The commit should appear on `main` without manual intervention.

Dry-run the bypass ruleset script to confirm the GitHub Actions integration id:

```sh
./scripts/configure-release-bypass-ruleset.sh --dry-run | jq .
```

## Related files

- `.github/workflows/merge.yml` — defines the **Merge Gate** check
- `.releaserc.json` — `@semantic-release/git` release commit message with `[skip ci]`
- `scripts/configure-main-branch-protection.sh`
- `scripts/configure-release-bypass-ruleset.sh`
