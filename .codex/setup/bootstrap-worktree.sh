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

install_package_deps() {
  local package_dir="$1"

  if [[ ! -f "$package_dir/package.json" ]]; then
    log "Skipping dependency install: $package_dir/package.json not found."
    return
  fi

  if [[ -d "$package_dir/node_modules" ]]; then
    log "Skipping dependency install: $package_dir/node_modules already exists."
    return
  fi

  if [[ ! -f "$package_dir/package-lock.json" ]]; then
    log "Skipping dependency install: $package_dir/package-lock.json not found."
    return
  fi

  log "Installing dependencies in $package_dir..."
  (
    cd "$package_dir"
    npm ci
  )
}

seed_server_env

install_package_deps "$current_root/poker-types"
install_package_deps "$current_root/poker-client"
install_package_deps "$current_root/poker-server"
