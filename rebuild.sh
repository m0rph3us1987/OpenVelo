#!/bin/bash
docker stop openvelo-web-ui && docker rm openvelo-web-ui
git pull
npm run docker-build-all-linux
docker compose up -d

