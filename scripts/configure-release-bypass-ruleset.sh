#!/usr/bin/env bash
set -euo pipefail

RULESET_NAME="Release automation bypass"
GITHUB_ACTIONS_APP_SLUG="github-actions"
DRY_RUN=false

usage() {
  cat <<'EOF'
Create or update a repository ruleset that lets GitHub Actions bypass push
restrictions on main (for semantic-release chore(release) commits).

Usage:
  configure-release-bypass-ruleset.sh [--dry-run]

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

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh CLI is required but not installed." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required but not installed." >&2
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

GITHUB_ACTIONS_APP_ID="$(gh api "/apps/${GITHUB_ACTIONS_APP_SLUG}" --jq .id)"
if [[ -z "${GITHUB_ACTIONS_APP_ID}" || "${GITHUB_ACTIONS_APP_ID}" == "null" ]]; then
  echo "Error: could not resolve GitHub Actions app id from /apps/${GITHUB_ACTIONS_APP_SLUG}." >&2
  exit 1
fi

PAYLOAD="$(jq -n \
  --arg name "${RULESET_NAME}" \
  --argjson actor_id "${GITHUB_ACTIONS_APP_ID}" \
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
    rules: []
  }')"

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "Dry run: would create or update ruleset \"${RULESET_NAME}\" on ${REPO}"
  echo "GitHub Actions actor: github-actions[bot] (Integration app id ${GITHUB_ACTIONS_APP_ID})"
  echo "${PAYLOAD}"
  exit 0
fi

EXISTING_RULESET_ID="$(gh api "repos/${REPO}/rulesets" --paginate --jq \
  ".[] | select(.name == \"${RULESET_NAME}\") | .id" | head -n 1)"

if [[ -n "${EXISTING_RULESET_ID}" ]]; then
  echo "Updating ruleset \"${RULESET_NAME}\" (id ${EXISTING_RULESET_ID}) on ${REPO} ..."
  gh api "repos/${REPO}/rulesets/${EXISTING_RULESET_ID}" \
    -X PUT \
    -H "Accept: application/vnd.github+json" \
    --input - <<<"${PAYLOAD}" \
    --silent
else
  echo "Creating ruleset \"${RULESET_NAME}\" on ${REPO} ..."
  gh api "repos/${REPO}/rulesets" \
    -X POST \
    -H "Accept: application/vnd.github+json" \
    --input - <<<"${PAYLOAD}" \
    --silent
fi

echo "Ruleset configured. GitHub Actions (github-actions[bot], app id ${GITHUB_ACTIONS_APP_ID}) can bypass branch protection on main."
