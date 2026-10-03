#!/bin/zsh
set -e
cd "$(dirname "$0")/qwen-agent-app"
echo "Updating Qwen Agent…"
git pull --ff-only
npm install
npm start
