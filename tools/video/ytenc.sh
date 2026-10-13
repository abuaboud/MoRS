#!/bin/bash
# YouTube copy of a master: 720p HEVC, CLOSED GOP (open GOP makes YouTube replay/shuffle footage at its chunk joins),
# two-pass, sized to stay under the browser upload tool's 10 MB.   usage: tools/video/ytenc.sh master.mp4 out.mp4
set -euo pipefail
in=$1 out=$2; dir=$(mktemp -d)
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$in")
kbps=$(python3 -c "print(int(9.4 * 8000 / $dur - 96))")
for p in 1 2; do
  ffmpeg -nostdin -v error -y -i "$in" -vf scale=1280:720:flags=lanczos -c:v libx265 -b:v ${kbps}k \
    -x265-params "pass=$p:stats=$dir/x265.log:open-gop=0:keyint=60:min-keyint=60:scenecut=0:log-level=error" -tag:v hvc1 \
    $([ $p = 1 ] && echo "-an -f mp4 /dev/null" || echo "-c:a aac -b:a 96k -movflags +faststart $out")
done
echo "$out $(du -k "$out" | cut -f1) KB, ${kbps}k video"
