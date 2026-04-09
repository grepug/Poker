#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BOOTSTRAP_SCRIPT="$REPO_ROOT/.codex/setup/bootstrap-worktree.sh"

if [[ ! -x "$BOOTSTRAP_SCRIPT" ]]; then
  echo "Bootstrap script is missing or not executable: $BOOTSTRAP_SCRIPT" >&2
  exit 1
fi

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/bootstrap-worktree-test.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

make_fake_git() {
  local fake_bin="$1"
  cat >"$fake_bin/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

case "${1:-} ${2:-} ${3:-}" in
  "rev-parse --show-toplevel ")
    printf '%s\n' "$FAKE_CURRENT_ROOT"
    ;;
  "rev-parse --path-format=absolute --git-common-dir")
    printf '%s\n' "$FAKE_GIT_COMMON_DIR"
    ;;
  *)
    echo "Unexpected fake git invocation: $*" >&2
    exit 1
    ;;
esac
EOF
  chmod +x "$fake_bin/git"
}

make_fake_corepack() {
  local fake_bin="$1"
  cat >"$fake_bin/corepack" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >>"$FAKE_COREPACK_LOG"

if [[ "${1:-}" == "pnpm" && "${2:-}" == "install" ]]; then
  mkdir -p "$FAKE_CURRENT_ROOT/node_modules"
fi
EOF
  chmod +x "$fake_bin/corepack"
}

seed_workspace() {
  local current_root="$1"
  local primary_root="$2"
  local fake_git_common_dir="$primary_root/.git"

  mkdir -p "$current_root/.codex/setup" "$current_root/poker-server" "$current_root/poker-client" "$current_root/poker-types"
  mkdir -p "$primary_root/poker-server" "$(dirname "$fake_git_common_dir")"

  cat >"$current_root/package.json" <<'EOF'
{
  "name": "poker-workspace",
  "private": true,
  "packageManager": "pnpm@10.30.1"
}
EOF

  cat >"$current_root/pnpm-workspace.yaml" <<'EOF'
packages:
  - poker-server
  - poker-client
  - poker-types
EOF

  cat >"$current_root/pnpm-lock.yaml" <<'EOF'
lockfileVersion: '9.0'
EOF

  cat >"$current_root/.env.example" <<'EOF'
TEST_SECRET=from-example
EOF

  cat >"$current_root/poker-server/package.json" <<'EOF'
{
  "name": "poker-server",
  "private": true
}
EOF

  cat >"$current_root/poker-client/package.json" <<'EOF'
{
  "name": "poker-client",
  "private": true
}
EOF

  cat >"$current_root/poker-types/package.json" <<'EOF'
{
  "name": "poker-types",
  "private": true
}
EOF

  cat >"$primary_root/.env" <<'EOF'
TEST_SECRET=from-primary-root
EOF
}

assert_contains() {
  local needle="$1"
  local haystack_file="$2"

  if ! grep -Fq "$needle" "$haystack_file"; then
    echo "Expected to find '$needle' in $haystack_file" >&2
    exit 1
  fi
}

run_bootstrap() {
  local current_root="$1"
  local primary_root="$2"
  local fake_bin="$3"
  local log_file="$4"

  export FAKE_CURRENT_ROOT="$current_root"
  export FAKE_GIT_COMMON_DIR="$primary_root/.git"
  export FAKE_COREPACK_LOG="$log_file"
  export PATH="$fake_bin:$PATH"
  export TMPDIR="$TMP_ROOT/tmp"

  mkdir -p "$TMPDIR"

  "$BOOTSTRAP_SCRIPT"
}

test_installs_workspace_when_missing() {
  local case_root="$TMP_ROOT/case-install"
  local current_root="$case_root/current"
  local primary_root="$case_root/primary"
  local fake_bin="$case_root/fake-bin"
  local log_file="$case_root/corepack.log"

  mkdir -p "$fake_bin"
  make_fake_git "$fake_bin"
  make_fake_corepack "$fake_bin"
  seed_workspace "$current_root" "$primary_root"

  run_bootstrap "$current_root" "$primary_root" "$fake_bin" "$log_file"

  assert_contains "pnpm install --frozen-lockfile" "$log_file"

  if [[ ! -d "$current_root/node_modules" ]]; then
    echo "Expected bootstrap to create $current_root/node_modules" >&2
    exit 1
  fi

  if [[ "$(cat "$current_root/.env")" != "TEST_SECRET=from-primary-root" ]]; then
    echo "Expected bootstrap to seed repo .env from the primary root" >&2
    exit 1
  fi
}

test_skips_install_when_workspace_is_ready() {
  local case_root="$TMP_ROOT/case-skip"
  local current_root="$case_root/current"
  local primary_root="$case_root/primary"
  local fake_bin="$case_root/fake-bin"
  local log_file="$case_root/corepack.log"

  mkdir -p "$fake_bin"
  make_fake_git "$fake_bin"
  make_fake_corepack "$fake_bin"
  seed_workspace "$current_root" "$primary_root"
  mkdir -p "$current_root/node_modules"

  run_bootstrap "$current_root" "$primary_root" "$fake_bin" "$log_file"

  if [[ -f "$log_file" && -s "$log_file" ]]; then
    echo "Expected bootstrap to skip install when root node_modules already exists" >&2
    exit 1
  fi
}

test_removes_legacy_package_node_modules_before_install() {
  local case_root="$TMP_ROOT/case-clean-legacy"
  local current_root="$case_root/current"
  local primary_root="$case_root/primary"
  local fake_bin="$case_root/fake-bin"
  local log_file="$case_root/corepack.log"

  mkdir -p "$fake_bin"
  make_fake_git "$fake_bin"
  make_fake_corepack "$fake_bin"
  seed_workspace "$current_root" "$primary_root"
  mkdir -p \
    "$current_root/poker-server/node_modules" \
    "$current_root/poker-client/node_modules" \
    "$current_root/poker-types/node_modules"
  touch \
    "$current_root/poker-server/node_modules/.legacy-marker" \
    "$current_root/poker-client/node_modules/.legacy-marker" \
    "$current_root/poker-types/node_modules/.legacy-marker"

  run_bootstrap "$current_root" "$primary_root" "$fake_bin" "$log_file"

  if [[ -d "$current_root/poker-server/node_modules" ]]; then
    echo "Expected bootstrap to remove legacy poker-server/node_modules before pnpm install" >&2
    exit 1
  fi

  if [[ -d "$current_root/poker-client/node_modules" ]]; then
    echo "Expected bootstrap to remove legacy poker-client/node_modules before pnpm install" >&2
    exit 1
  fi

  if [[ -d "$current_root/poker-types/node_modules" ]]; then
    echo "Expected bootstrap to remove legacy poker-types/node_modules before pnpm install" >&2
    exit 1
  fi

  assert_contains "pnpm install --frozen-lockfile" "$log_file"
}

test_installs_workspace_when_missing
test_skips_install_when_workspace_is_ready
test_removes_legacy_package_node_modules_before_install

echo "bootstrap-worktree tests passed"
