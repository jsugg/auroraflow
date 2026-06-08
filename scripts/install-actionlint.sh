#!/usr/bin/env bash
set -euo pipefail

ACTIONLINT_VERSION="1.7.11"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${REPO_ROOT}/.tools/bin"
INSTALL_PATH="${INSTALL_DIR}/actionlint"
BASE_URL="https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}"

log() {
  printf '%s\n' "$*"
}

fail() {
  printf 'install-actionlint: %s\n' "$*" >&2
  exit 1
}

checksum_file() {
  local file_path="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${file_path}" | awk '{ print $1 }'
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${file_path}" | awk '{ print $1 }'
    return
  fi

  fail "sha256sum or shasum is required to verify actionlint"
}

if [[ -x "${INSTALL_PATH}" ]] && "${INSTALL_PATH}" -version 2>/dev/null | grep -Fq "${ACTIONLINT_VERSION}"; then
  log "actionlint ${ACTIONLINT_VERSION} already installed at ${INSTALL_PATH}"
  exit 0
fi

command -v curl >/dev/null 2>&1 || fail "curl is required to download actionlint"
command -v tar >/dev/null 2>&1 || fail "tar is required to unpack actionlint"

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"

case "${os}" in
  linux | darwin) ;;
  *) fail "unsupported OS '${os}'; install actionlint ${ACTIONLINT_VERSION} manually" ;;
esac

case "${arch}" in
  x86_64 | amd64) arch="amd64" ;;
  arm64 | aarch64) arch="arm64" ;;
  *) fail "unsupported architecture '${arch}'; install actionlint ${ACTIONLINT_VERSION} manually" ;;
esac

asset="actionlint_${ACTIONLINT_VERSION}_${os}_${arch}.tar.gz"
case "${asset}" in
  actionlint_1.7.11_darwin_amd64.tar.gz) expected_sha256="17ffc17fed8f0258ef6ad4aed932d3272464c7ef7d64e1cb0d65aa97c9752107" ;;
  actionlint_1.7.11_darwin_arm64.tar.gz) expected_sha256="a21ba7366d8329e7223faee0ed69eb13da27fe8acabb356bb7eb0b7f1e1cb6d8" ;;
  actionlint_1.7.11_linux_amd64.tar.gz) expected_sha256="900919a84f2229bac68ca9cd4103ea297abc35e9689ebb842c6e34a3d1b01b0a" ;;
  actionlint_1.7.11_linux_arm64.tar.gz) expected_sha256="21bc0dfb57a913fe175298c2a9e906ee630f747cb66d0a934d0d4b69f4ee1235" ;;
  *) fail "missing pinned checksum for ${asset}" ;;
esac

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

archive_path="${tmp_dir}/${asset}"
curl --fail --location --silent --show-error --output "${archive_path}" "${BASE_URL}/${asset}"

actual_sha256="$(checksum_file "${archive_path}")"
if [[ "${actual_sha256}" != "${expected_sha256}" ]]; then
  fail "checksum mismatch for ${asset}: expected ${expected_sha256}, got ${actual_sha256}"
fi

tar -xzf "${archive_path}" -C "${tmp_dir}" actionlint
mkdir -p "${INSTALL_DIR}"
install -m 0755 "${tmp_dir}/actionlint" "${INSTALL_PATH}"
"${INSTALL_PATH}" -version
log "Installed actionlint ${ACTIONLINT_VERSION} at ${INSTALL_PATH}"
