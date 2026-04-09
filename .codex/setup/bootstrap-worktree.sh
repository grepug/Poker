#!/usr/bin/env bash

set -euo pipefail

safe_root_name() {
  basename "$(git rev-parse --show-toplevel)" | tr -cs 'A-Za-z0-9._-' '_'
}

timestamp() {
  date '+%Y-%m-%d %H:%M:%S %z'
}

log_file="${TMPDIR:-/tmp}/poker-codex-worktree-setup-$(safe_root_name).log"

log() {
  local message="$1"
  printf '[%s] %s\n' "$(timestamp)" "$message" | tee -a "$log_file"
}

on_exit() {
  local exit_code=$?
  log "Setup script exiting with code $exit_code"
}

trap on_exit EXIT

current_root="$(git rev-parse --show-toplevel)"
git_common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
primary_root="$(dirname "$git_common_dir")"

log "Setup script started"
log "current_root=$current_root"
log "primary_root=$primary_root"
log "log_file=$log_file"

seed_server_env() {
  local source_env="$primary_root/poker-server/.env"
  local example_env="$current_root/poker-server/.env.example"
  local dest_env="$current_root/poker-server/.env"

  if [[ -e "$dest_env" ]]; then
    log "Skipping poker-server/.env bootstrap: $dest_env already exists."
    return
  fi

  if [[ -f "$source_env" ]]; then
    cp "$source_env" "$dest_env"
    log "Copied $source_env to $dest_env."
    return
  fi

  if [[ -f "$example_env" ]]; then
    cp "$example_env" "$dest_env"
    log "Seeded $dest_env from $example_env."
    return
  fi

  log "Skipping poker-server/.env bootstrap: no source file found."
}

run_pnpm() {
  if command -v corepack >/dev/null 2>&1; then
    corepack pnpm "$@"
    return
  fi

  if command -v pnpm >/dev/null 2>&1; then
    pnpm "$@"
    return
  fi

  log "Unable to install workspace dependencies: neither corepack nor pnpm is available."
  exit 1
}

clean_legacy_package_node_modules() {
  local workspace_root="$1"
  local package_dir

  for package_dir in poker-types poker-client poker-server poker-registry; do
    local node_modules_dir="$workspace_root/$package_dir/node_modules"

    if [[ -d "$node_modules_dir" ]]; then
      log "Removing legacy package node_modules: $node_modules_dir"
      rm -rf "$node_modules_dir"
    fi
  done
}

install_workspace_deps() {
  local workspace_root="$1"

  if [[ ! -f "$workspace_root/package.json" ]]; then
    log "Skipping workspace install: $workspace_root/package.json not found."
    return
  fi

  if [[ ! -f "$workspace_root/pnpm-lock.yaml" ]]; then
    log "Skipping workspace install: $workspace_root/pnpm-lock.yaml not found."
    return
  fi

  if [[ ! -f "$workspace_root/pnpm-workspace.yaml" ]]; then
    log "Skipping workspace install: $workspace_root/pnpm-workspace.yaml not found."
    return
  fi

  if [[ -d "$workspace_root/node_modules" ]]; then
    log "Skipping workspace install: $workspace_root/node_modules already exists."
    return
  fi

  clean_legacy_package_node_modules "$workspace_root"

  log "Installing workspace dependencies in $workspace_root..."
  (
    cd "$workspace_root"
    run_pnpm install --frozen-lockfile
  )
}

seed_server_env

install_workspace_deps "$current_root"
