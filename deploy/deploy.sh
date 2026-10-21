#!/usr/bin/env bash
# Build the site from the external vault and upload it to the server.
#
#   cp deploy/deploy.env.example deploy/deploy.env   # once, then edit
#   npm run deploy
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f deploy/deploy.env ]]; then
  # shellcheck disable=SC1091
  source deploy/deploy.env
fi
: "${DEPLOY_TARGET:?set DEPLOY_TARGET (e.g. user@host:/var/www/dw2) in deploy/deploy.env}"

npm run build
rsync -az --delete --human-readable dist/ "${DEPLOY_TARGET%/}/"
echo "Deployed to ${DEPLOY_TARGET}"
