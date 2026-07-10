# Branch protection on main

This repository enforces changes to `main` through pull requests with a required **Merge Gate** status check. Release automation (`@semantic-release/git`) can still push `chore(release): X.Y.Z [skip ci]` commits after branch protection is applied.

## Why a ruleset instead of classic protection

Classic branch protection (`enforce_admins: true`, required PRs, required status checks) blocks **every** actor from pushing directly to `main`, including `GITHUB_TOKEN` from GitHub Actions. When semantic-release runs `@semantic-release/git`, it pushes a version commit straight to `main`; the release workflow fails with **GH006** (protected branch hook declined).

A separate ruleset with GitHub Actions on the bypass list does **not** help while classic protection remains active — ruleset bypass actors only apply to rules enforced by that ruleset, not to classic branch protection rules.

This repository therefore uses a single repository **ruleset** named **Main branch protection** that both enforces PR + Merge Gate requirements and grants the GitHub Actions integration a bypass for release commits.

## Prerequisites

- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated with a token that has **admin** access to the repository
- `jq` (used to build the ruleset JSON payload)
- The **Merge Gate** workflow (`.github/workflows/merge.yml`) must already exist on `main` before you require its check — it is present in this repository

## Apply configuration

Run from the repository root with admin credentials:

```sh
./scripts/configure-main-branch-protection.sh
```

Preview the payload without applying:

```sh
./scripts/configure-main-branch-protection.sh --dry-run
```

### Merge order

1. Ensure **Merge Gate** is on `main` (already true for this repo).
2. Run `configure-main-branch-protection.sh` to create or update the ruleset and remove any legacy classic protection on `main`.

Re-running the script is idempotent.

## What gets configured

### Repository ruleset (`configure-main-branch-protection.sh`)

The script creates or updates a ruleset named **Main branch protection** targeting `refs/heads/main`, then deletes classic branch protection on `main` if it still exists.

| Rule / setting | Value | Acceptance criterion |
| --- | --- | --- |
| Pull request | 0 approvals required (PR still required) | Changes only via PR; solo maintainer and worker-authored PRs can merge once Merge Gate passes |
| Required status checks (strict) | **Merge Gate** | Branch must be up to date with `main`; matches job name in `merge.yml` |
| Non-fast-forward | enabled | No force-pushes that rewrite history |
| Deletion | enabled | Branch cannot be deleted |
| Bypass actor | GitHub Actions (`/apps/github-actions`, Integration) | Release workflow can push `chore(release): … [skip ci]` commits |

| Actor | Details |
| --- | --- |
| Integration | GitHub Actions (`/apps/github-actions`, app id resolved at runtime — `15368` on github.com) |
| Workflow identity | `github-actions[bot]` |
| Token | `GITHUB_TOKEN` in the release workflow (W-000026) |

Direct human pushes to `main` remain blocked. All normal changes land through merged pull requests.

### User-owned repositories: bypass actor must be added in the UI

On user-owned (non-organization) repositories, the rulesets API rejects the
built-in GitHub Actions app as a bypass actor with `Actor GitHub Actions
integration must be part of the ruleset source or owner organization`. The
script detects this, applies the ruleset **without** bypass actors, and prints
an `ACTION REQUIRED` notice: open **Settings → Rules → Rulesets → Main branch
protection** and add **GitHub Actions** to the Bypass list (bypass mode
"always"). Releases stay blocked until that one-time step is done; human
gating is unaffected either way.

### If `GITHUB_TOKEN` cannot push

`GITHUB_TOKEN` from a workflow in the same repository can push to protected branches when GitHub Actions is on the ruleset bypass list. If pushes still fail after applying the script:

1. Confirm the ruleset **Main branch protection** is **Active** and lists **GitHub Actions** under bypass actors (Settings → Rules → Rulesets).
2. Confirm classic branch protection is **not** still enabled on `main` (Settings → Branches).
3. Confirm the release workflow `permissions` include `contents: write` (as defined in W-000026).
4. **Fallback:** use a machine-user PAT stored as `RELEASE_GIT_CREDENTIALS` (or similar) with bypass or admin-equivalent access, and configure `@semantic-release/git` to use that credential instead of `GITHUB_TOKEN`. Document the secret name in the release workflow when adopting this path.

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

In **Settings → Rules → Rulesets** (ruleset **Main branch protection**), confirm:

- **Require pull request** is enabled (0 approvals)
- **Require status checks to pass** is enabled with **strict** policy
- **Merge Gate** appears in the required checks list

Open a PR without a passing Merge Gate run; merge should be blocked until the check succeeds.

### 3. Humans cannot bypass via direct push

The ruleset applies to all users including repository administrators. Verify as an admin: direct push fails (scenario 1). Merges still require Merge Gate to pass.

### 4. Release automation still works

After W-000026 release workflow is on `main`, merge a `feat:` or `fix:` PR and confirm the release job can push `chore(release): X.Y.Z [skip ci]` to `main`. The commit should appear on `main` without manual intervention.

Dry-run the script to confirm the ruleset payload and GitHub Actions integration id:

```sh
./scripts/configure-main-branch-protection.sh --dry-run | jq .
```

## Related files

- `.github/workflows/merge.yml` — defines the **Merge Gate** check
- `.releaserc.json` — `@semantic-release/git` release commit message with `[skip ci]`
- `scripts/configure-main-branch-protection.sh`
