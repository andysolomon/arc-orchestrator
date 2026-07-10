#!/usr/bin/env bash
set -euo pipefail

RULESET_NAME="Main branch protection"
GITHUB_ACTIONS_APP_SLUG="github-actions"
MERGE_GATE_INTEGRATION_ID="15368"
DRY_RUN=false

usage() {
  cat <<'EOF'
Configure main branch protection via a repository ruleset (PR + Merge Gate)
with a GitHub Actions bypass for semantic-release version commits.

Usage:
  configure-main-branch-protection.sh [--dry-run]

Requires repository admin access and an authenticated gh CLI session.
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
  # Anchor to the repository this script lives in, never the caller's cwd —
  # running from another checkout must not retarget that repo's protection.
  local repo="" remote="" origin_url=""
  remote="$(git -C "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.." remote get-url origin 2>/dev/null || true)"
  origin_url="${remote%.git}"
  repo="${origin_url#git@github.com:}"
  repo="${repo#https://github.com/}"
  if [[ -z "${repo}" || "${repo}" == "${origin_url}" ]]; then
    if command -v gh >/dev/null 2>&1; then
      repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)"
    fi
  fi
  if [[ -z "${repo}" ]]; then
    repo="owner/repo"
  fi
  printf '%s' "${repo}"
}

build_payload() {
  local actor_id="$1"
  jq -n \
    --arg name "${RULESET_NAME}" \
    --argjson actor_id "${actor_id}" \
    --argjson integration_id "${MERGE_GATE_INTEGRATION_ID}" \
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
      bypass_actors: [
        {
          actor_id: $actor_id,
          actor_type: "Integration",
          bypass_mode: "always"
        }
      ],
      rules: [
        {
          type: "pull_request",
          parameters: {
            required_approving_review_count: 0,
            dismiss_stale_reviews_on_push: false,
            require_code_owner_review: false,
            require_last_push_approval: false,
            required_review_thread_resolution: false,
            allowed_merge_methods: ["merge", "squash", "rebase"]
          }
        },
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: true,
            required_status_checks: [
              {
                context: "Merge Gate",
                integration_id: $integration_id
              }
            ]
          }
        },
        {
          type: "non_fast_forward"
        },
        {
          type: "deletion"
        }
      ]
    }'
}

if [[ "${DRY_RUN}" == "true" ]]; then
  if ! command -v jq >/dev/null 2>&1; then
    echo "Error: jq is required but not installed." >&2
    exit 1
  fi
  REPO="$(resolve_repo)"
  GITHUB_ACTIONS_APP_ID="15368"
  PAYLOAD="$(build_payload "${GITHUB_ACTIONS_APP_ID}")"
  echo "Dry run: would create or update ruleset \"${RULESET_NAME}\" on ${REPO}"
  echo "GitHub Actions actor: github-actions[bot] (Integration app id ${GITHUB_ACTIONS_APP_ID})"
  echo "Dry run: would remove classic branch protection from repos/${REPO}/branches/main/protection"
  echo "${PAYLOAD}"
  exit 0
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh CLI is required but not installed." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required but not installed." >&2
  exit 1
fi

REPO="$(resolve_repo)"
if [[ -z "${REPO}" || "${REPO}" == "owner/repo" ]]; then
  echo "Error: could not resolve repository from the script's origin remote or gh repo view." >&2
  exit 1
fi

GITHUB_ACTIONS_APP_ID="$(gh api "/apps/${GITHUB_ACTIONS_APP_SLUG}" --jq .id)"
if [[ -z "${GITHUB_ACTIONS_APP_ID}" || "${GITHUB_ACTIONS_APP_ID}" == "null" ]]; then
  echo "Error: could not resolve GitHub Actions app id from /apps/${GITHUB_ACTIONS_APP_SLUG}." >&2
  exit 1
fi

PAYLOAD="$(build_payload "${GITHUB_ACTIONS_APP_ID}")"

IS_ADMIN="$(gh api "repos/${REPO}" --jq '.permissions.admin')"
if [[ "${IS_ADMIN}" != "true" ]]; then
  echo "Error: repository admin access is required to configure rulesets on ${REPO}." >&2
  echo "Hint: ensure your gh auth token has admin scope for this repository." >&2
  exit 1
fi

EXISTING_RULESET_ID="$(gh api "repos/${REPO}/rulesets" --paginate --jq \
  ".[] | select(.name == \"${RULESET_NAME}\") | .id" | head -n 1)"

apply_ruleset() {
  local endpoint="$1" method="$2" response=""
  if ! response="$(gh api "${endpoint}" \
    -X "${method}" \
    -H "Accept: application/vnd.github+json" \
    --input - <<<"${PAYLOAD}" 2>&1)"; then
    echo "Error: ruleset ${method} ${endpoint} failed:" >&2
    echo "${response}" >&2
    exit 1
  fi
}

if [[ -n "${EXISTING_RULESET_ID}" ]]; then
  echo "Updating ruleset \"${RULESET_NAME}\" (id ${EXISTING_RULESET_ID}) on ${REPO} ..."
  apply_ruleset "repos/${REPO}/rulesets/${EXISTING_RULESET_ID}" PUT
else
  echo "Creating ruleset \"${RULESET_NAME}\" on ${REPO} ..."
  apply_ruleset "repos/${REPO}/rulesets" POST
fi

echo "Removing classic branch protection from ${REPO}@main (if present) ..."
if ! gh api "repos/${REPO}/branches/main/protection" -X DELETE --silent 2>/dev/null; then
  echo "Classic branch protection was not present (or already removed); continuing."
fi

echo "Ruleset \"${RULESET_NAME}\" configured on ${REPO}@main."
echo "  - Pull requests required (0 approvals); Merge Gate status check (strict)"
echo "  - Non-fast-forward and deletion protection enabled"
echo "  - GitHub Actions (github-actions[bot], app id ${GITHUB_ACTIONS_APP_ID}) bypasses rules for release commits"
echo "Direct human pushes to main remain blocked."
