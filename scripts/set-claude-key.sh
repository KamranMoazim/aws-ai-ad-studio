#!/usr/bin/env bash
set -euo pipefail

# Stores the Anthropic API key used when CLAUDE_PROVIDER=anthropic (SSM SecureString, no idle cost).
REGION="${AWS_REGION:-us-east-1}"
value="${ANTHROPIC_API_KEY:-}"
if [[ -z "$value" ]]; then
  if [[ ! -t 0 ]]; then
    echo "no terminal to prompt on and ANTHROPIC_API_KEY is not set"
    exit 1
  fi
  read -r -s -p "Anthropic API key (sk-ant-...): " value
  echo
fi
aws ssm put-parameter --region "$REGION" --name /adstudio/anthropic-api-key --type SecureString \
  --value "$value" --overwrite >/dev/null
echo "stored /adstudio/anthropic-api-key"
