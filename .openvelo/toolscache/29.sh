#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive
npm install -g tsx
cd /repo/components/orchestrator && npm install
cd /repo/components/web-ui && npm install