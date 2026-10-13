#!/bin/bash
# Film one run: fresh gateway timeline, record the game + log, run Claude headless on a prompt, stop when it reports.
# usage: tools/take.sh <prompt.md> <outDir>     -> <outDir>/raw.mp4, <outDir>/log.jsonl, <outDir>/transcript.jsonl
#   TAKE_FLAGS="--disallowedTools Bash" adds claude flags (e.g. to keep a run inside the game and its notes)
set -euo pipefail
cd "$(dirname "$0")/.."
prompt=$1 out=$2
mkdir -p "$out" logs
pkill -f "bun gateway/server.ts" || true
sleep 1
nohup bun gateway/server.ts > logs/gateway.log 2>&1 &
until curl -s -m 3 localhost:8888/state | grep -q gameState; do sleep 2; done
bun tools/record.ts "$out" > "$out/.record.log" 2>&1 &
rec=$!
sleep 3
python3 -c "import json,sys;print(json.dumps({'type':'user','message':{'role':'user','content':open(sys.argv[1]).read()}}))" "$prompt" > "$out/.in.jsonl"
# the transcript goes in runs/ so the gateway tails it (the viewer's Goal, words and steps come from it)
name=$(basename "$out")
claude -p --input-format stream-json --replay-user-messages --output-format stream-json --verbose \
  --mcp-config .mcp.json --strict-mcp-config --permission-mode bypassPermissions --no-session-persistence ${TAKE_FLAGS:-} \
  < "$out/.in.jsonl" > "runs/$name.jsonl" 2> "runs/$name.err" || true
sleep 5
kill -INT $rec
wait $rec || true
cp "runs/$name.jsonl" "$out/transcript.jsonl"
rm -f "$out/.in.jsonl" "$out/.record.log"
echo "done: $out"
