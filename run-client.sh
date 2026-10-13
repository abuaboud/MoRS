#!/bin/bash
# (Re)build and start the headless game client container; it connects to the gateway on :8888.
set -euo pipefail
cd "$(dirname "$0")"
./build.sh
docker build -q -t mors-client -f docker/Dockerfile . >/dev/null
docker rm -f mors >/dev/null 2>&1 || true
docker run -d --name mors -v mors-home:/root mors-client >/dev/null
echo "client container mors started"
