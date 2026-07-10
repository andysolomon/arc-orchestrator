#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false

usage() {
  cat <<'EOF'
Configure classic branch protection on main requiring PR review and Merge Gate.

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
  echo "Error: repository admin access is required to configure branch protection on ${REPO}." >&2
  echo "Hint: ensure your gh auth token has admin scope for this repository." >&2
  exit 1
fi

PAYLOAD="$(cat <<EOF
{
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1
  },
  "enforce_admins": true,
  "restrictions": null,
  "required_status_checks": {
    "strict": true,
    "contexts": ["Merge Gate"]
  }
}
EOF
)"

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "Dry run: would apply branch protection to repos/${REPO}/branches/main/protection"
  echo "${PAYLOAD}"
  exit 0
fi

echo "Applying branch protection to ${REPO}@main ..."
gh api "repos/${REPO}/branches/main/protection" \
  -X PUT \
  -H "Accept: application/vnd.github+json" \
  -f "required_pull_request_reviews[dismiss_stale_reviews]=false" \
  -f "required_pull_request_reviews[require_code_owner_reviews]=false" \
  -F "required_pull_request_reviews[required_approving_review_count]=1" \
  -F "enforce_admins=true" \
  -f "restrictions=null" \
  -f "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=Merge Gate" \
  --silent

echo "Branch protection configured for ${REPO}@main."
