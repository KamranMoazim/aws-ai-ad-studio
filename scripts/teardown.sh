#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
REGION="${AWS_REGION:-us-east-1}"

read -r -p "Delete the AdStudio stack and all its data in $REGION? Type yes: " answer
if [[ "$answer" != "yes" ]]; then
  echo "cancelled"
  exit 1
fi

npm --prefix infra run destroy

# CDK-managed custom resources can leave log groups behind after the stack is gone.
for prefix in /aws/lambda/AdStudioStack- AdStudioStack-; do
  for group in $(aws logs describe-log-groups --region "$REGION" --log-group-name-prefix "$prefix" \
    --query 'logGroups[].logGroupName' --output text); do
    aws logs delete-log-group --region "$REGION" --log-group-name "$group" && echo "deleted $group"
  done
done

rm -f infra/cdk-outputs.json client/public/config.json
echo "teardown complete"
