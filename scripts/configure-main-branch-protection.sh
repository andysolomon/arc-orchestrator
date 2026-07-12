#!/usr/bin/env bash
set -euo pipefail

RULESET_NAME="Main branch protection"
GITHUB_ACTIONS_APP_SLUG="github-actions"
GITHUB_ACTIONS_APP_ID_FALLBACK="15368"
DRY_RUN=false

usage() {
  cat <<'EOF'
Configure a repository ruleset on main requiring pull requests and the
Merge Gate status check, with bypass actors for release automation
(@semantic-release/git) to push chore(release) version commits:

- DeployKey (always): the effective bypass on user-owned repositories.
  The release workflow checks out with the RELEASE_DEPLOY_KEY secret so
  its push rides this bypass (see docs/branch-protection.md for the
  one-time key setup).
- GitHub Actions integration (best effort): user-owned repositories
  reject this actor via the API ("must be part of the ruleset source or
  owner organization"); when that happens the script retries with the
  DeployKey bypass only.

Replaces classic branch protection: after the ruleset is active, any classic
protection on main is removed (ruleset bypass actors cannot bypass classic
protection, so the two must not coexist).

Usage:
  configure-main-branch-protection.sh [--dry-run]

Requires repository admin access, an authenticated gh CLI session, and jq.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

resolve_repo() {
  local repo="" remote="" origin_url=""
  if command -v gh >/dev/null 2>&1; then
    repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)"
  fi
  if [[ -z "${repo}" ]]; then
    remote="$(git -C "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.." remote get-url origin 2>/dev/null || true)"
    origin_url="${remote%.git}"
    repo="${origin_url#git@github.com:}"
    repo="${repo#https://github.com/}"
  fi
  if [[ -z "${repo}" || "${repo}" == "${origin_url}" ]]; then
    repo="owner/repo"
  fi
  printf '%s' "${repo}"
}

resolve_github_actions_app_id() {
  if [[ "${DRY_RUN}" == "true" ]]; then
    printf '%s' "${GITHUB_ACTIONS_APP_ID_FALLBACK}"
    return
  fi

  local app_id=""
  app_id="$(gh api "/apps/${GITHUB_ACTIONS_APP_SLUG}" --jq .id)"
  if [[ -z "${app_id}" || "${app_id}" == "null" ]]; then
    echo "Error: could not resolve GitHub Actions app id from /apps/${GITHUB_ACTIONS_APP_SLUG}." >&2
    exit 1
  fi
  printf '%s' "${app_id}"
}

build_payload() {
  local github_actions_app_id="$1"
  local bypass_mode="${2:-full}"
  local bypass_actors
  if [[ "${bypass_mode}" == "deploy-key-only" ]]; then
    bypass_actors='[
      { "actor_id": null, "actor_type": "DeployKey", "bypass_mode": "always" }
    ]'
  else
    bypass_actors="$(jq -n --argjson actor_id "${github_actions_app_id}" '[
      { actor_id: null, actor_type: "DeployKey", bypass_mode: "always" },
      { actor_id: $actor_id, actor_type: "Integration", bypass_mode: "always" }
    ]')"
  fi
  jq -n \
    --arg name "${RULESET_NAME}" \
    --argjson bypass_actors "${bypass_actors}" \
    '{
      name: $name,
      target: "branch",
      enforcement: "active",
      conditions: {
        ref_name: {
          include: ["refs/heads/main"],
          exclude: []
        }
      },
      bypass_actors: $bypass_actors,
      rules: [
        { type: "deletion" },
        { type: "non_fast_forward" },
        {
          type: "pull_request",
          parameters: {
            required_approving_review_count: 0,
            dismiss_stale_reviews_on_push: false,
            require_code_owner_review: false,
            require_last_push_approval: false,
            required_review_thread_resolution: false
          }
        },
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: true,
            required_status_checks: [
              { context: "Merge Gate" }
            ]
          }
        }
      ]
    }'
}

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required but not installed." >&2
  exit 1
fi

GITHUB_ACTIONS_APP_ID="$(resolve_github_actions_app_id)"

if [[ "${DRY_RUN}" == "true" ]]; then
  REPO="$(resolve_repo)"
  PAYLOAD="$(build_payload "${GITHUB_ACTIONS_APP_ID}")"
  echo "Dry run: would create or update ruleset \"${RULESET_NAME}\" on ${REPO}"
  echo "Bypass actors: DeployKey (always) plus GitHub Actions (Integration app id ${GITHUB_ACTIONS_APP_ID}, best effort)"
  echo "${PAYLOAD}"
  echo "Dry run: on a user-owned repo the Integration actor is rejected; would retry with the DeployKey bypass only"
  echo "Dry run: would then remove classic branch protection from repos/${REPO}/branches/main/protection"
  exit 0
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh CLI is required but not installed." >&2
  exit 1
fi

REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
if [[ -z "${REPO}" ]]; then
  echo "Error: could not resolve repository from gh repo view." >&2
  exit 1
fi

IS_ADMIN="$(gh api "repos/${REPO}" --jq '.permissions.admin')"
if [[ "${IS_ADMIN}" != "true" ]]; then
  echo "Error: repository admin access is required to configure rulesets on ${REPO}." >&2
  echo "Hint: ensure your gh auth token has admin scope for this repository." >&2
  exit 1
fi

EXISTING_RULESET_ID="$(gh api "repos/${REPO}/rulesets" --paginate --jq \
  ".[] | select(.name == \"${RULESET_NAME}\") | .id" | head -n 1)"

apply_ruleset() {
  local payload="$1"
  if [[ -n "${EXISTING_RULESET_ID}" ]]; then
    gh api "repos/${REPO}/rulesets/${EXISTING_RULESET_ID}" \
      -X PUT \
      -H "Accept: application/vnd.github+json" \
      --input - <<<"${payload}" \
      --silent 2>&1
  else
    gh api "repos/${REPO}/rulesets" \
      -X POST \
      -H "Accept: application/vnd.github+json" \
      --input - <<<"${payload}" \
      --silent 2>&1
  fi
}

if [[ -n "${EXISTING_RULESET_ID}" ]]; then
  echo "Updating ruleset \"${RULESET_NAME}\" (id ${EXISTING_RULESET_ID}) on ${REPO} ..."
else
  echo "Creating ruleset \"${RULESET_NAME}\" on ${REPO} ..."
fi

APPLY_OUTPUT="$(apply_ruleset "$(build_payload "${GITHUB_ACTIONS_APP_ID}")")" && APPLY_STATUS=0 || APPLY_STATUS=$?
BYPASS_SUMMARY="DeployKey (always) and GitHub Actions (Integration app id ${GITHUB_ACTIONS_APP_ID})"
if [[ "${APPLY_STATUS}" -ne 0 ]]; then
  if grep -q "must be part of the ruleset source" <<<"${APPLY_OUTPUT}"; then
    echo "GitHub rejected the GitHub Actions integration as a bypass actor (user-owned repo)."
    echo "Retrying with the DeployKey bypass only; the release workflow pushes via RELEASE_DEPLOY_KEY."
    APPLY_OUTPUT="$(apply_ruleset "$(build_payload "${GITHUB_ACTIONS_APP_ID}" "deploy-key-only")")" || {
      echo "Error: ruleset update failed:" >&2
      echo "${APPLY_OUTPUT}" >&2
      exit 1
    }
    BYPASS_SUMMARY="DeployKey (always); release pushes ride the RELEASE_DEPLOY_KEY deploy key"
  else
    echo "Error: ruleset update failed:" >&2
    echo "${APPLY_OUTPUT}" >&2
    exit 1
  fi
fi

# Classic protection blocks every actor (no bypass concept), so it must go
# once the ruleset is active or the release bot still cannot push.
if gh api "repos/${REPO}/branches/main/protection" --silent >/dev/null 2>&1; then
  echo "Removing classic branch protection from ${REPO}@main ..."
  gh api "repos/${REPO}/branches/main/protection" \
    -X DELETE \
    -H "Accept: application/vnd.github+json" \
    --silent
else
  echo "No classic branch protection found on ${REPO}@main; nothing to remove."
fi

echo "Ruleset \"${RULESET_NAME}\" configured for ${REPO}@main."
echo "PRs + Merge Gate required for humans; bypass actors: ${BYPASS_SUMMARY}."
echo "One-time deploy key setup (if not done): see docs/branch-protection.md."
