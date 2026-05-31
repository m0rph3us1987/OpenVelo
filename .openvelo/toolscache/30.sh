#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive
npm install --prefix /repo/components/orchestrator
npm install --prefix /repo/components/web-ui