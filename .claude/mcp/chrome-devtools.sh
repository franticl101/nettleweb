#!/usr/bin/env bash
# Launches the Chrome DevTools MCP server for this project (registered in .mcp.json).
#
# On a desktop it starts your installed Chrome as usual. In a container with no display, such as
# a Claude Code cloud session, it runs Chrome headless with a throwaway profile, uses the
# preinstalled Chromium when there is no Chrome, and turns Chrome's sandbox off when running as
# root (Chrome refuses to start as root otherwise).
set -euo pipefail

version=1.12.0 # keep in step with the chrome-devtools skills in .claude/skills

args=()
if [[ $(uname) == Linux && -z ${DISPLAY:-} && -z ${WAYLAND_DISPLAY:-} ]]; then
  args+=(--headless --isolated)
  if [[ ! -x /opt/google/chrome/chrome && -x /opt/pw-browsers/chromium ]]; then
    args+=(--executablePath=/opt/pw-browsers/chromium)
  fi
fi
if [[ $(id -u) == 0 ]]; then
  args+=(--chromeArg=--no-sandbox)
fi

exec npx -y "chrome-devtools-mcp@$version" ${args[@]+"${args[@]}"} "$@"
