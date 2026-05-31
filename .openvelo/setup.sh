#!/bin/bash
set -e

export DEBIAN_FRONTEND=noninteractive

cd /repo/components/orchestrator
npm install

cd /repo/components/web-ui
npm install
