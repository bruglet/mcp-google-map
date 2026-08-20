#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
quadlet_dir="${HOME}/.config/containers/systemd"
config_dir="${HOME}/.config/mcp-google-map"
state_dir="${HOME}/.local/state/mcp-google-map"
env_file="${config_dir}/env"

mkdir -p "${quadlet_dir}" "${config_dir}" "${state_dir}"
chmod 700 "${config_dir}" "${state_dir}"

if [[ ! -f "${env_file}" ]]; then
  install -m 600 "${project_root}/deploy/mcp-google-map.env.example" "${env_file}"
  echo "Populate ${env_file} before starting the service." >&2
  exit 1
fi

chmod 600 "${env_file}"
if grep -Eq 'replace-(with|me)|your-team' "${env_file}"; then
  echo "Refusing to start with placeholder values in ${env_file}." >&2
  exit 1
fi

# With rootless keep-id, map the image’s stable application UID only inside
# this state directory. No unrelated host path is recursively changed.
podman unshare chown -R 10001:10001 "${state_dir}"

install -m 644 "${project_root}/deploy/mcp-google-map.container" "${quadlet_dir}/mcp-google-map.container"
systemctl --user daemon-reload
systemctl --user enable --now mcp-google-map.service
systemctl --user status --no-pager mcp-google-map.service
