#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GITHUB_REPOSITORY:-}" ]]; then
  echo "GITHUB_REPOSITORY is required."
  exit 1
fi

if [[ -z "${BASE_SHA:-}" || -z "${HEAD_SHA:-}" ]]; then
  echo "BASE_SHA and HEAD_SHA are required."
  exit 1
fi

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "GITHUB_TOKEN is required."
  exit 1
fi

compare_url="https://api.github.com/repos/${GITHUB_REPOSITORY}/dependency-graph/compare/${BASE_SHA}...${HEAD_SHA}"
response_file="$(mktemp)"

status_code="$(
  curl --silent --show-error --location \
    --output "${response_file}" \
    --write-out "%{http_code}" \
    --header "Accept: application/vnd.github+json" \
    --header "Authorization: Bearer ${GITHUB_TOKEN}" \
    "${compare_url}"
)"

if [[ "${status_code}" -ge 400 ]]; then
  echo "Dependency review API failed with status ${status_code}."
  cat "${response_file}"
  exit 1
fi

if [[ "$(jq 'type' "${response_file}")" != "\"array\"" ]]; then
  echo "Unexpected dependency review payload:"
  cat "${response_file}"
  exit 1
fi

high_or_critical_count="$(
  jq '
    [
      .[] |
      (
        (.severity // empty),
        (.security_advisory.severity // empty),
        (.security_vulnerability.severity // empty),
        (.security_advisory.vulnerabilities[]?.severity // empty)
      ) |
      ascii_downcase |
      select(. == "high" or . == "critical")
    ] | length
  ' "${response_file}"
)"

if [[ "${high_or_critical_count}" -gt 0 ]]; then
  echo "Found ${high_or_critical_count} high/critical dependency alert(s) in this PR."
  jq '
    map(
      {
        severity: (.severity // .security_advisory.severity // .security_vulnerability.severity // "unknown"),
        package: (.package.name // .dependency.package.name // .security_vulnerability.package.name // "unknown"),
        advisory: (.security_advisory.ghsa_id // .advisory_ghsa_id // "n/a"),
        summary: (.security_advisory.summary // .summary // "n/a")
      }
    )
  ' "${response_file}"
  exit 1
fi

echo "Dependency review passed: no high/critical alerts introduced."
