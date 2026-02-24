#!/bin/bash
# Development server launcher — loads secrets from macOS Keychain.
# To store the key: security add-generic-password -a "$USER" -s "anthropic-poker-assistant" -w "sk-ant-..."
# To update the key: security add-generic-password -a "$USER" -s "anthropic-poker-assistant" -w "sk-ant-..." -U

set -e

ANTHROPIC_API_KEY=$(security find-generic-password -a "$USER" -s "anthropic-poker-assistant" -w 2>/dev/null)

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "Error: ANTHROPIC_API_KEY not found in Keychain."
  echo "Run: security add-generic-password -a \"\$USER\" -s \"anthropic-poker-assistant\" -w \"sk-ant-...\""
  exit 1
fi

export ANTHROPIC_API_KEY
exec bun run next dev -p 3006
